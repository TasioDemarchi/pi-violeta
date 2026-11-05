/** The guarded executor of a contract task's `Check` (S6, estado-de-tareas).
 *
 * S5 runs the task's `Check` when a worker reports it finished; S6 says that
 * run is not outside the guard: a `Check` the guard calls destructive is asked
 * about FIRST, and unattended mode runs none of them.
 *
 * Nothing is re-implemented here. The classification is `guardDecision`
 * (./command-guard.ts) — the one recognizer in the repo — so a `Check` and a
 * `bash` call can never disagree about what "destructive" means. This module
 * then applies the OTHER half of the guard too: `bashPathTargets` plus
 * `authorizePaths` (./outside.ts, the module `violeta-guard.ts` itself uses)
 * with its grants, its dialog and its refusals. A `Check` that touches
 * `~/dev/other-repo` or `~/.ssh` needs the same grant a `bash` call needs; that
 * hole was the reason this module exists at all.
 *
 * The whole decision, in order:
 *
 *   unattended → refuse before classifying: S6's rule is about the verification,
 *                not about destructiveness ("no se ejecuta ninguno")
 *   deny     → catastrophic target: refuse with the guard's deny text
 *   block    → no owner to ask (no UI, or a `VIOLETA_AGENTS_CHILD=1` child):
 *              refuse with the guard's block text
 *   confirm  → `ctx.ui.select` with the guard's title, body and Spanish options
 *              (only "Sí" approves; No, cancel and undefined decline) → run
 *              when approved, refuse with the guard's own decline text when not
 *   allow    → but a command that runs an INLINE PAYLOAD (`node -e`,
 *              `python -c`, `perl -e`, `sh -c`, `bash -c`, `eval`,
 *              `curl … | sh`) is not "obviously safe": the recognizer cannot
 *              read code it was handed as an argument, so it is confirmed with
 *              the guard's dialog too, even though nothing in it is
 *              destructive. A `Check` is model-written text the harness
 *              executes by itself, and "no recognizer matched" is not consent.
 *   then     → outside-project paths need a grant, exactly as for `bash`:
 *              refused here when the owner declines or there is nobody to ask
 *
 * A refusal is not a failure: no process started, so the executor answers
 * `refused` (verify.ts) and the row stays `por verificar` with the motive on
 * D8's line, instead of `fallada` with output of a command that never ran.
 *
 * The Check runs from a `tool_result` handler, i.e. in the parent's process, so
 * `VIOLETA_AGENTS_CHILD` is not set there and the guard does ask: the variable
 * is read by `canAsk` (./outside.ts), which is the rule `violeta-guard.ts`
 * reads, and that is the point of sharing it rather than copying a `hasUI`
 * test of our own.
 *
 * The grant store here is this module's own. The guard extension's store is
 * not reachable from here (extensions load as separate module instances), so a
 * grant the owner gave to `bash` does not cover a `Check` and vice versa: each
 * asks once per directory per session. Sharing one store would mean handing it
 * through `guardedCheckExecutor`, i.e. changing its caller in
 * `extensions/violeta-task-state.ts`. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runCheckCommand, type CheckExecutor, type CheckResult } from "../contract/verify.ts";
import { guard as t, guardReasons } from "../i18n.ts";
import { getShared, setShared } from "../shared-hub.ts";
import { guardDecision, runsInlinePayload } from "./command-guard.ts";
import { OutsideGrants } from "./grants.ts";
import { authorizePaths, canAsk, home, unattended } from "./outside.ts";
import { bashPathTargets } from "./paths.ts";

/** The only parts of an `ExtensionContext` the guarded Check reads, so a test
 * can hand over exactly those and nothing else. `sessionManager` is optional:
 * when it is there the grants are dropped on a session change, exactly as the
 * guard drops its own. */
export type GuardedCheckContext = Pick<ExtensionContext, "hasUI" | "ui"> & {
	sessionManager?: { getSessionId(): string };
};

/** Refused: nothing started, so this is not a failed Check (verify.ts). */
const refused = (reason: string): CheckResult => ({ ok: false, output: "", refused: reason });

/** Ask the guard's question with the guard's options; only "Sí" approves. While
 * it waits, the shared hub tells the notify extension (if loaded) to ping the
 * owner; this module never depends on it being there. */
async function ask(ctx: GuardedCheckContext, title: string, body: string): Promise<boolean> {
	setShared({ notifyNeedsAnswer: true });
	try {
		return (await ctx.ui.select(`${title}\n${body}`, [t.yes, t.no])) === t.yes;
	} finally {
		setShared({ notifyNeedsAnswer: false });
	}
}

/** The grants a `Check` earned: one store for this module's instance. */
const grants = new OutsideGrants();

/** An executor that asks the guard before it runs a `Check` (S6). `run` is the
 * plain executor the approved command finally goes through. */
export function guardedCheckExecutor(ctx: GuardedCheckContext, run: CheckExecutor = runCheckCommand): CheckExecutor {
	return async (command, cwd) => {
		// S6: unattended runs no Check at all, destructive or not. Asked before
		// classification because the rule is not about destructiveness.
		if (unattended()) return refused(t.checkUnattended);
		const sessionId = ctx.sessionManager?.getSessionId?.();
		if (sessionId !== undefined && sessionId !== "") grants.sync(sessionId);

		const decision = guardDecision(command, canAsk(ctx));
		if (decision.action === "deny") return refused(decision.reason);
		if (decision.action === "block") return refused(t.blocked(decision.reasons));
		if (decision.action === "confirm") {
			const body = t.destructiveBody(command, decision.reasons);
			if (!(await ask(ctx, t.destructiveTitle, body))) return refused(t.declined(command));
		}
		// An inline payload is code no recognizer can read. If it was already
		// confirmed as destructive, that dialog was the question; otherwise this
		// is where it gets asked, before anything runs.
		if (decision.action === "allow" && runsInlinePayload(command)) {
			const body = t.destructiveBody(command, [guardReasons.inlinePayload]);
			if (!(await ask(ctx, t.inlineTitle, body))) return refused(t.declined(command));
		}

		// FIX 3: the other half of the guard. Rooted at the directory the Check
		// runs in, which is the project the guard would see for a `bash` call.
		const pathCtx = { cwd, hasUI: ctx.hasUI, ui: ctx.ui };
		const denied = await authorizePaths(pathCtx, grants, bashPathTargets(command, cwd, home()), "bash");
		if (denied.block) return refused(denied.reason ?? "");

		return run(command, cwd);
	};
}
