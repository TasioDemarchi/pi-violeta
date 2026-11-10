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

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SHELL_COMMAND_TOOLS, guardDecision } from "../src/guard/command-guard.ts";
import { OutsideGrants } from "../src/guard/grants.ts";
import { authorizePaths, canAsk, home, unattended } from "../src/guard/outside.ts";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { bashPathTargets, resolvePath, toolCallPaths } from "../src/guard/paths.ts";
import { activeContractFrom } from "../src/contract/active.ts";
import { decide } from "../src/authority/decide.ts";
import { PROJECT_SCRATCH } from "../src/authority/rules.ts";
import { readPaths, writePaths } from "../src/authority/request.ts";
import { type Explanation, explainedBody, parseExplanation } from "../src/guard/explain.ts";
import { blocksText } from "../src/btw/request.ts";
import { setShared } from "../src/shared-hub.ts";
import { guard as t } from "../src/i18n.ts";

// Shell tools (bash, bash_background, monitor) get the destructive-command
// check and the outside-project path grant; the file tools only the grant.
// The grant policy itself lives in src/guard/outside.ts, because the harness's
// `Check` executor has to apply the very same rule (S6, estado-de-tareas).

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

/** The harness's own authority: who may write what, decided by `src/authority`.
 *
 * It runs before the grant dialog because it is the more specific question —
 * a grant is about reaching OUTSIDE the project, this is about what the session
 * may touch INSIDE it — and because a refusal here must never open a dialog:
 * the exit is a line the model writes in the contract, not an answer the owner
 * has to give at the keyboard (D5, tasks/authority.md).
 *
 * Everything that judges is pure and lives in `src/authority`; this function is
 * only the wiring: resolve the paths, read the active contract off disk, ask,
 * and translate the answer. A contract that cannot be read is no contract, and
 * the request goes on to the permission path of always. */
function authorityRefusal(
	toolName: string,
	input: Record<string, unknown>,
	ctx: ExtensionContext,
): { block: true; reason: string } | undefined {
	const root = ctx.cwd;
	// What this call would WRITE: an argument for the file tools, a parsed
	// command for the shell. And what it would READ, which only the rules that
	// scope reading look at. A call that does neither never reaches a rule.
	const paths = writePaths(toolName, input, root, home());
	const reads = readPaths(toolName, input, root, home());
	// Everything the call MENTIONS, for the deny-lists: a secret is a secret
	// whether it is opened or overwritten, and a shell command names its files
	// inside the command instead of in an argument.
	const command = SHELL_COMMAND_TOOLS.has(toolName) && typeof input?.command === "string" ? input.command : undefined;
	const touches = command
		? bashPathTargets(command, root, home())
		: toolCallPaths(toolName, input).map((path) => resolvePath(path, root, home()));
	if (paths.length === 0 && reads.length === 0 && touches.length === 0 && command === undefined) return undefined;

	const contractPath = resolve(root, activeContractFrom(ctx.sessionManager));
	let contract: { path: string; text: string } | undefined;
	try {
		contract = { path: contractPath, text: readFileSync(contractPath, "utf8") };
	} catch {
		contract = undefined;
	}

	// Who is asking: the runner puts the agent's own name in the child's
	// environment, so a rule can bind `scout` without asking the model.
	const agent = process.env.VIOLETA_AGENT_NAME;
	const decision = decide({
		tool: toolName,
		caller: process.env.VIOLETA_AGENTS_CHILD === "1" ? "subagent" : "session",
		paths,
		reads,
		touches,
		...(command !== undefined ? { command } : {}),
		root,
		scratch: join(root, PROJECT_SCRATCH),
		...(agent ? { agent } : {}),
		...(contract ? { contract } : {}),
	});
	if (decision.allowed) return undefined;
	const scratch = join(root, PROJECT_SCRATCH);
	const reasons: Record<string, () => string> = {
		"agent.no-secrets": () => t.agentNoSecrets(decision.path),
		"agent.no-delivery": () => t.agentNoDelivery(decision.path),
		"agent.read-only": () => t.agentReadOnly(agent ?? "", decision.path),
		"agent.scratch-only": () => t.agentScratchOnly(decision.path, scratch),
		"critic.contract-only": () => t.criticContractOnly(decision.path),
		"jarvis.tests-readonly": () => t.testsLocked(decision.path),
		"jarvis.bash-write": () => t.bashLocked(decision.path, contractPath),
		"jarvis.write-lock": () => t.writeLocked(decision.path, contractPath),
	};
	return { block: true, reason: reasons[decision.rule]!() };
}

export default function (pi: ExtensionAPI) {
	// NOTE: unlike violeta-agents, this deliberately does NOT return early for
	// VIOLETA_AGENTS_CHILD=1: children keep the guard, and being non-interactive
	// they are blocked on a match instead of prompting.
	const grants = new OutsideGrants();

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
	pi.on("tool_call", async (event, ctx) => {
		if (!GRANTABLE_TOOLS.has(event.toolName)) return;

		const refused = authorityRefusal(event.toolName, event.input as Record<string, unknown>, ctx);
		if (refused) return refused;

		grants.sync(ctx.sessionManager.getSessionId());

		if (SHELL_COMMAND_TOOLS.has(event.toolName)) {
			const command = event.input.command;
			const decision = guardDecision(command, canAsk(ctx));
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
			const denied = await authorizePaths(ctx, grants, bashPathTargets(command, ctx.cwd, home()), event.toolName);
			if (denied.block) return denied;
			return;
		}

		const denied = await authorizePaths(ctx, grants, toolCallPaths(event.toolName, event.input as Record<string, unknown>), event.toolName);
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
