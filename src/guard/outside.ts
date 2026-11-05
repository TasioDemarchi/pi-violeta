/**
 * The outside-project half of the guard: which paths need a grant, the grant
 * dialog, and the refusal texts.
 *
 * Extracted from `extensions/violeta-guard.ts` (S6, estado-de-tareas) so the
 * harness's `Check` executor (./check-executor.ts) applies the SAME rule a
 * `bash` call gets instead of a lookalike. Nothing here is new policy: it is
 * the code that lived in the extension, with the grant store passed in instead
 * of closed over, because the extension and the executor each own one.
 *
 * The rule, unchanged: paths inside the project root (`ctx.cwd`), inside the
 * violeta agent dir (`PI_CODING_AGENT_DIR`) and inside scratch space
 * (`isScratch`, the system temp root) are free. Anything else asks once per
 * target directory per session; with no UI, or a `VIOLETA_AGENTS_CHILD=1` child,
 * it blocks instead of asking; in unattended mode only the read tools pass
 * outside, everything else is refused.
 */

import { existsSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { guard as t } from "../i18n.ts";
import { getShared, setShared } from "../shared-hub.ts";
import type { OutsideGrants } from "./grants.ts";
import { allowedLocation, grantScope, isScratch, resolvePath, targetDir } from "./paths.ts";

/** The parts of an `ExtensionContext` a grant needs, so a test can hand over
 * exactly those and nothing else. */
export type OutsideContext = Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;

/** Outside the project these may read in unattended mode; nothing else may. */
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

/** The violeta agent dir, when the session has one. Inside it is always allowed. */
export const agentDir = (): string | undefined => {
	const dir = process.env.PI_CODING_AGENT_DIR;
	return dir && dir.trim() !== "" ? dir : undefined;
};

/** `$HOME`, with the process's home as the fallback. */
export const home = (): string => (process.env.HOME && process.env.HOME.trim() !== "" ? process.env.HOME : homedir());

/** Unattended mode: nothing is asked, so nothing may wait for an answer. */
export const unattended = (): boolean => getShared().unattended === true;

/** The guard's "can I ask?" rule, verbatim: a UI, not a subagent child, and not
 * unattended (a child has no owner behind it, and in unattended mode the owner
 * said not to ask). */
export const canAsk = (ctx: Pick<OutsideContext, "hasUI">): boolean =>
	ctx.hasUI && process.env.VIOLETA_AGENTS_CHILD !== "1" && !unattended();

/** A refusal from the outside-project half, or nothing when the path is fine. */
export interface OutsideDenial {
	block?: boolean;
	reason?: string;
}

/** Ask once per target directory per session; without a UI it blocks. */
export async function authorizeOutside(ctx: OutsideContext, grants: OutsideGrants, resolved: string): Promise<OutsideDenial> {
	// Scratch space is free: the temp root is the one place outside the
	// project where the answer is always yes, and the harness writes there
	// itself on every voice line and every subagent.
	if (isScratch(resolved, tmpdir())) return {};
	// Temp paths collapse to the temp root: `mktemp -d` names a different
	// directory every run, so granting each one asks again forever.
	const dir = grantScope(
		targetDir(resolved, (path) => {
			try {
				return statSync(path).isDirectory();
			} catch {
				return existsSync(path);
			}
		}),
		tmpdir(),
	);
	if (grants.has(dir)) return {};
	if (!canAsk(ctx)) {
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

/** Every path a tool call would touch, resolved and granted (or refused). */
export async function authorizePaths(
	ctx: OutsideContext,
	grants: OutsideGrants,
	paths: readonly string[],
	toolName: string,
): Promise<OutsideDenial> {
	const dir = agentDir();
	for (const path of paths) {
		const resolved = resolvePath(path, ctx.cwd, home());
		if (allowedLocation(resolved, ctx.cwd, dir)) continue;
		if (unattended()) {
			if (READ_TOOLS.has(toolName)) continue;
			return { block: true, reason: t.unattendedOutsideWrite(resolved, ctx.cwd) };
		}
		const denied = await authorizeOutside(ctx, grants, resolved);
		if (denied.block) return denied;
	}
	return {};
}
