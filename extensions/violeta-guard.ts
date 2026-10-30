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
 * ASSUMPTION (reported): "repos externos" means any directory outside the
 * project root; violeta has no foreign-repo subagent launch to grant for.
 */

import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SHELL_COMMAND_TOOLS, guardDecision } from "../src/guard/command-guard.ts";
import { OutsideGrants } from "../src/guard/grants.ts";
import { allowedLocation, bashPathTargets, resolvePath, targetDir, toolCallPaths } from "../src/guard/paths.ts";
import { guard as t } from "../src/i18n.ts";

// Shell tools (bash, bash_background, monitor) get the destructive-command
// check and the outside-project path grant; the file tools only the grant.
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
	const canAsk = (): boolean => process.env.VIOLETA_AGENTS_CHILD !== "1";

	/** Ask once per target directory per session; without a UI it blocks. */
	async function authorizeOutside(ctx: ExtensionContext, resolved: string): Promise<{ block?: boolean; reason?: string }> {
		const dir = targetDir(resolved, (path) => {
			try {
				return statSync(path).isDirectory();
			} catch {
				return existsSync(path);
			}
		});
		if (grants.has(dir)) return {};
		if (!ctx.hasUI || !canAsk()) {
			return {
				block: true,
				reason: t.outsideNeedsGrant(dir, ctx.cwd),
			};
		}
		// select instead of confirm so the OPTIONS are Spanish; only "Sí" approves.
		const approved = (await ctx.ui.select(`${t.outsideTitle}\n${t.outsideBody(dir)}`, [t.yes, t.no])) === t.yes;
		if (!approved) {
			return { block: true, reason: t.outsideDeclined(dir, ctx.cwd) };
		}
		grants.grant(dir);
		return {};
	}

	async function authorizePaths(ctx: ExtensionContext, paths: string[]): Promise<{ block?: boolean; reason?: string }> {
		const dir = agentDir();
		for (const path of paths) {
			const resolved = resolvePath(path, ctx.cwd, home());
			if (allowedLocation(resolved, ctx.cwd, dir)) continue;
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
				return { block: true, reason: t.blocked(decision.reasons) };
			}
			if (decision.action === "confirm") {
				// select instead of confirm so the OPTIONS are Spanish; only "Sí" approves.
				const approved = (await ctx.ui.select(`${t.destructiveTitle}\n${t.destructiveBody(command, decision.reasons)}`, [t.yes, t.no])) === t.yes;
				if (!approved) {
					return { block: true, reason: t.declined(command) };
				}
			}
			const denied = await authorizePaths(ctx, bashPathTargets(command, ctx.cwd, home()));
			if (denied.block) return denied;
			return;
		}

		const denied = await authorizePaths(ctx, toolCallPaths(event.toolName, event.input as Record<string, unknown>));
		if (denied.block) return denied;
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
