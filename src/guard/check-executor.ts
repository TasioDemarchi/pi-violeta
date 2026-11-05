/** The guarded executor of a contract task's `Check` (S6, estado-de-tareas).
 *
 * S5 runs the task's `Check` when a worker reports it finished; S6 says that
 * run is not outside the guard: a `Check` the guard calls destructive is asked
 * about FIRST, and unattended mode runs none of them.
 *
 * Nothing is re-implemented here. The classification is `guardDecision`
 * (./command-guard.ts) — the one recognizer in the repo — so a `Check` and a
 * `bash` call can never disagree about what "destructive" means. What this
 * module adds is the other half of the guard's own decision, and it keeps the
 * guard's texts and the guard's rule for who may be asked:
 *
 *   allow    → run the command (`runCheckCommand`, the shell, as before)
 *   confirm  → `ctx.ui.select` with the guard's title, body and Spanish options
 *              (only "Sí" approves; No, cancel and undefined decline) → run
 *              when approved, refuse with the guard's own decline text when not
 *   block    → no owner to ask (no UI, or a `VIOLETA_AGENTS_CHILD=1` child):
 *              refuse with the guard's block text
 *   deny     → catastrophic target: refuse with the guard's deny text
 *   unattended → refuse before classifying: S6's rule is about the verification,
 *              not about destructiveness ("no se ejecuta ninguno")
 *
 * A refusal is not a failure: no process started, so the executor answers
 * `refused` (verify.ts) and the row stays `por verificar` with the motive on
 * D8's line, instead of `fallada` with output of a command that never ran.
 *
 * The Check runs from a `tool_result` handler, i.e. in the parent's process, so
 * `VIOLETA_AGENTS_CHILD` is not set there and the guard does ask: the variable
 * is read exactly where `violeta-guard.ts` reads it, and that is the point of
 * sharing the rule rather than copying a `hasUI` test of our own. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runCheckCommand, type CheckExecutor } from "../contract/verify.ts";
import { guard as t } from "../i18n.ts";
import { getShared, setShared } from "../shared-hub.ts";
import { guardDecision } from "./command-guard.ts";

/** The only parts of an `ExtensionContext` the guarded dialog reads, so a test
 * can hand over exactly those and nothing else. */
export type GuardedCheckContext = Pick<ExtensionContext, "hasUI" | "ui">;

/** The guard's own "can I ask?" rule, verbatim: a UI, and not a subagent child
 * (a child has no owner behind it, so it is blocked instead of asked). */
const canAsk = (ctx: GuardedCheckContext): boolean => ctx.hasUI && process.env.VIOLETA_AGENTS_CHILD !== "1";

/** An executor that asks the guard before it runs a `Check` (S6). `run` is the
 * plain executor the approved command finally goes through. */
export function guardedCheckExecutor(ctx: GuardedCheckContext, run: CheckExecutor = runCheckCommand): CheckExecutor {
	return async (command, cwd) => {
		// S6: unattended runs no Check at all, destructive or not. Asked before
		// classification because the rule is not about destructiveness.
		if (getShared().unattended === true) return { ok: false, output: "", refused: t.checkUnattended };

		const decision = guardDecision(command, canAsk(ctx));
		if (decision.action === "deny") return { ok: false, output: "", refused: decision.reason };
		if (decision.action === "block") return { ok: false, output: "", refused: t.blocked(decision.reasons) };
		if (decision.action === "confirm") {
			// The same dialog the guard raises for `bash`: same title, same body,
			// same Spanish options, and only "Sí" approves. While it waits, the
			// shared hub tells the notify extension (if loaded) to ping the owner;
			// this module never depends on it being there.
			const body = t.destructiveBody(command, decision.reasons);
			setShared({ notifyNeedsAnswer: true });
			let approved: boolean;
			try {
				approved = (await ctx.ui.select(`${t.destructiveTitle}\n${body}`, [t.yes, t.no])) === t.yes;
			} finally {
				setShared({ notifyNeedsAnswer: false });
			}
			if (!approved) return { ok: false, output: "", refused: t.declined(command) };
		}
		return run(command, cwd);
	};
}
