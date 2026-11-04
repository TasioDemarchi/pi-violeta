/**
 * violeta-guard — destructive-command guard plus outside-project grants.
 *
 * Intercepts every `tool_call`:
 * - shell tools (`bash`, `bash_background`, `monitor` — anything whose input
 *   runs a command): recognizable destructive forms ask for confirmation
 *   (exact command + reason); catastrophic targets are hard-denied with no
 *   prompt; no UI (including VIOLETA_AGENTS_CHILD=1 children) blocks instead
 *   of asking. Literal path arguments that resolve outside the project root
 *   need a grant.
 * - `read/write/edit/grep/find/ls`: paths outside the project root need a grant.
 *
 * Grants are per session, per target directory, in memory only, never
 * persisted, and dropped when the session changes. Paths inside the project
 * root (ctx.cwd) and the violeta agent dir (PI_CODING_AGENT_DIR) are always
 * allowed. `/grants` lists current grants; `/grants revoke` clears them.
 *
 * Unattended mode (`/unattended on`, or VIOLETA_UNATTENDED=1 at launch): nothing
 * is ever asked. Destructive commands are refused with a message telling the
 * model to skip them and continue; outside the project only the read tools
 * (`read/grep/find/ls`) pass, always; writes, edits and shell commands that
 * touch outside paths are refused. Catastrophic targets stay hard-denied. It is
 * never persisted: a forgotten setting must not outlive its session.
 *
 * ASSUMPTION (reported): "repos externos" means any directory outside the
 * project root; violeta has no foreign-repo subagent launch to grant for.
 */

import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SHELL_COMMAND_TOOLS, guardDecision } from "../src/guard/command-guard.ts";
import { OutsideGrants } from "../src/guard/grants.ts";
import { allowedLocation, bashPathTargets, isScratch, resolvePath, targetDir, grantScope, toolCallPaths } from "../src/guard/paths.ts";
import { type Explanation, explainedBody, parseExplanation } from "../src/guard/explain.ts";
import { blocksText } from "../src/btw/request.ts";
import { getShared, setShared } from "../src/shared-hub.ts";
import { guard as t } from "../src/i18n.ts";

// Shell tools (bash, bash_background, monitor) get the destructive-command
// check and the outside-project path grant; the file tools only the grant.
// Outside the project these may read in unattended mode; nothing else may.
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

/** The free NaN model that reads the command for the dialog. Picked by
 * measuring all six: gemma4, qwen3.6 and deepseek-v4-flash spend their whole
 * budget reasoning and answer nothing at all, qwen3.8-flash took 11s, and this
 * one answers in about a second with its reasoning off. */
const EXPLAIN_MODEL = "mimo-v2.6-flash";
/** How long the dialog waits for it. Measured between 0.8s and 7.9s on the
 * same command, so the ceiling is generous; past it the owner gets the command
 * itself, which is what he got before this existed.
 *
 * VIOLETA_TEST_EXPLAIN_MS is a validation-only hook (same technique as
 * VIOLETA_TEST_CTX_PERCENT in the UI extension) so a hung service can be
 * proved harmless without a nine-second test. Unset in every real session. */
const explainTimeoutMs = (): number => {
	const raw = Number.parseInt(process.env.VIOLETA_TEST_EXPLAIN_MS ?? "", 10);
	return Number.isFinite(raw) && raw > 0 ? raw : 9000;
};
const GRANTABLE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls", ...SHELL_COMMAND_TOOLS]);

export default function (pi: ExtensionAPI) {
	// NOTE: unlike violeta-agents, this deliberately does NOT return early for
	// VIOLETA_AGENTS_CHILD=1: children keep the guard, and being non-interactive
	// they are blocked on a match instead of prompting.
	const grants = new OutsideGrants();

	const agentDir = (): string | undefined => {
		const dir = process.env.PI_CODING_AGENT_DIR;
		return dir && dir.trim() !== "" ? dir : undefined;
	};
	const home = (): string => process.env.HOME && process.env.HOME.trim() !== "" ? process.env.HOME : homedir();
	const unattended = (): boolean => getShared().unattended === true;
	const canAsk = (): boolean => process.env.VIOLETA_AGENTS_CHILD !== "1" && !unattended();

	/** The command in words, or nothing. Never throws and never waits forever:
	 * every failure (no NaN auth, a slow model, an answer in the wrong shape)
	 * ends as undefined, and the dialog falls back to showing the command. */
	async function explainCommand(ctx: ExtensionContext, command: string): Promise<Explanation | undefined> {
		// A nicety must never break the guard: a context with no model registry
		// (a child, a test, a future Pi) simply gets the command, as before.
		const model = ctx.modelRegistry?.getAvailable?.().find((m) => m.provider === "nan" && m.id === EXPLAIN_MODEL);
		if (!model) return undefined;
		// Said before the wait, not after: nine silent seconds before a dialog
		// look like a hung harness.
		ctx.ui.notify(t.explainWorking, "info");
		const answer = await new Promise<string | undefined>((resolve) => {
			// Not unref'd on purpose: it lives nine seconds at most and is
			// cleared the moment the model answers, and an unref'd timer lets
			// the process fall out from under a pending explanation.
			const timer = setTimeout(() => resolve(undefined), explainTimeoutMs());
			// Reasoning off is what makes it answer in a second instead of ten.
			ctx.modelRegistry
				.complete(model, { messages: [{ role: "user", content: t.explainPrompt(command), timestamp: Date.now() }] }, { reasoning: "off" })
				.then(
					(reply) => {
						clearTimeout(timer);
						resolve(reply?.errorMessage ? undefined : blocksText(reply?.content));
					},
					() => {
						clearTimeout(timer);
						resolve(undefined);
					},
				);
		});
		return answer === undefined ? undefined : parseExplanation(answer);
	}

	/** Ask once per target directory per session; without a UI it blocks. */
	async function authorizeOutside(ctx: ExtensionContext, resolved: string): Promise<{ block?: boolean; reason?: string }> {
		// Scratch space is free: the temp root is the one place outside the
		// project where the answer is always yes, and the harness writes there
		// itself on every voice line and every subagent.
		if (isScratch(resolved, tmpdir())) return {};
		// Temp paths collapse to the temp root: `mktemp -d` names a different
		// directory every run, so granting each one asks again forever.
		const dir = grantScope(targetDir(resolved, (path) => {
			try {
				return statSync(path).isDirectory();
			} catch {
				return existsSync(path);
			}
		}), tmpdir());
		if (grants.has(dir)) return {};
		if (!ctx.hasUI || !canAsk()) {
			return {
				block: true,
				reason: t.outsideNeedsGrant(dir, ctx.cwd),
			};
		}
		// select instead of confirm so the OPTIONS are Spanish; only "Sí" approves.
		// While the dialog waits, the shared hub tells the notify extension (if
		// loaded) to ping the user; the guard never depends on it being there.
		setShared({ notifyNeedsAnswer: true });
		let approved: boolean;
		try {
			approved = (await ctx.ui.select(`${t.outsideTitle}\n${t.outsideBody(dir)}`, [t.yes, t.no])) === t.yes;
		} finally {
			setShared({ notifyNeedsAnswer: false });
		}
		if (!approved) {
			return { block: true, reason: t.outsideDeclined(dir, ctx.cwd) };
		}
		grants.grant(dir);
		return {};
	}

	async function authorizePaths(ctx: ExtensionContext, paths: string[], toolName: string): Promise<{ block?: boolean; reason?: string }> {
		const dir = agentDir();
		for (const path of paths) {
			const resolved = resolvePath(path, ctx.cwd, home());
			if (allowedLocation(resolved, ctx.cwd, dir)) continue;
			if (unattended()) {
				if (READ_TOOLS.has(toolName)) continue;
				return { block: true, reason: t.unattendedOutsideWrite(resolved, ctx.cwd) };
			}
			const denied = await authorizeOutside(ctx, resolved);
			if (denied.block) return denied;
		}
		return {};
	}

	pi.on("tool_call", async (event, ctx) => {
		if (!GRANTABLE_TOOLS.has(event.toolName)) return;
		grants.sync(ctx.sessionManager.getSessionId());

		if (SHELL_COMMAND_TOOLS.has(event.toolName)) {
			const command = event.input.command;
			const decision = guardDecision(command, ctx.hasUI && canAsk());
			if (decision.action === "deny") {
				return { block: true, reason: decision.reason };
			}
			if (decision.action === "block") {
				return { block: true, reason: unattended() ? t.unattendedBlocked(decision.reasons) : t.blocked(decision.reasons) };
			}
			if (decision.action === "confirm") {
				// select instead of confirm so the OPTIONS are Spanish; only "Sí" approves.
				// While the dialog waits, the shared hub tells the notify extension
				// (if loaded) to ping the user; the guard never depends on it.
				// The command in words, when a model could read it; the command
				// itself when it could not.
				const explanation = await explainCommand(ctx, command);
				const body = explanation ? explainedBody(explanation, command, decision.reasons) : t.destructiveBody(command, decision.reasons);
				setShared({ notifyNeedsAnswer: true });
				let approved: boolean;
				try {
					approved = (await ctx.ui.select(`${t.destructiveTitle}\n${body}`, [t.yes, t.no])) === t.yes;
				} finally {
					setShared({ notifyNeedsAnswer: false });
				}
				if (!approved) {
					return { block: true, reason: t.declined(command) };
				}
			}
			const denied = await authorizePaths(ctx, bashPathTargets(command, ctx.cwd, home()), event.toolName);
			if (denied.block) return denied;
			return;
		}

		const denied = await authorizePaths(ctx, toolCallPaths(event.toolName, event.input as Record<string, unknown>), event.toolName);
		if (denied.block) return denied;
	});

	// Off unless asked for, and re-read from the environment on every start.
	pi.on("session_start", async () => {
		setShared({ unattended: process.env.VIOLETA_UNATTENDED === "1" });
	});

	pi.registerCommand("unattended", {
		description: t.unattendedDescription,
		handler: async (args: string, ctx: ExtensionContext) => {
			const arg = args.trim().toLowerCase();
			if (arg && arg !== "on" && arg !== "off") {
				ctx.ui.notify(t.unattendedUsage, "warning");
				return;
			}
			const next = arg === "on" ? true : arg === "off" ? false : !unattended();
			setShared({ unattended: next });
			ctx.ui.notify(next ? t.unattendedOn : t.unattendedOff, next ? "warning" : "info");
		},
	});

	pi.registerCommand("grants", {
		description: t.grantsDescription,
		handler: async (args: string, ctx: ExtensionContext) => {
			if (args.trim().toLowerCase() === "revoke") {
				const cleared = grants.clear();
				ctx.ui.notify(cleared > 0 ? t.grantsRevoked(cleared) : t.grantsNothingToRevoke, "info");
				return;
			}
			grants.sync(ctx.sessionManager.getSessionId());
			const list = grants.list();
			ctx.ui.notify(
				list.length > 0 ? t.grantsList(list) : t.grantsEmpty,
				"info",
			);
		},
	});
}
