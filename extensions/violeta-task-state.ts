/**
 * violeta-task-state — the harness-side writer of a contract task's `estado:`
 * field (S4/S5, estado-de-tareas). It is the event half of "the harness records
 * on its own": the model decides what to dispatch, this file decides what that
 * dispatch means for the task row.
 *
 * The loop it closes:
 *
 *   `subagent_run` tool_call  with `contractTask: N` → `estado: en curso`
 *   `subagent_run` tool_result  isError          → `estado: fallada`
 *   `subagent_run` tool_result  no error         → the task's `Check` is run
 *                                                   (S5, src/contract/verify.ts):
 *                                                   passes → `verificada`
 *                                                   fails  → `fallada` + clipped
 *                                                            output (D8)
 *                                                   manual / absent → `por verificar`
 *   `subagent_run` tool_result  `mode: background` → nothing: no result yet (D9);
 *                                                   the row is closed when the
 *                                                   child settles (below)
 *   anything else                                 → the file is not touched
 *
 * "The model says it is done" is worth exactly the Check, and this file never
 * decides otherwise (D3): a worker that reports success and fails its own Check
 * leaves a red row with the real output, it does not leave a green one.
 *
 * The task id travels as DISPATCH DATA (`contractTask` on the call, D4). It is
 * never read out of `label`, `task` or any other prose: a dispatch whose label
 * happens to say "T1" writes nothing, and the only thing that writes is the
 * parameter. The spike read it from `label`; T6 removed that crutch.
 *
 * Writing goes through `setTaskStatus` and `setTaskCheckOutput`
 * (src/contract/state.ts), the one writer of the row and of the one line under
 * it, so `commit:` and every other byte the model owns survive untouched (S7).
 * Both writes here are also careful about WHEN they read: read, transform,
 * write — and never a snapshot held across an `await`. A Check can run for ten
 * minutes and the guard's dialog can sit waiting for the owner, so
 * `verifyDispatch` re-reads the file after the Check and applies the transforms
 * to THAT text; the model's edits made in the window survive (S7) instead of
 * being overwritten by the text that was true before the wait. The write itself
 * goes through a temp file and `renameSync` in the same directory, so a reader
 * (the panel's tick, another check) never catches half a contract.
 * The active contract is the session's answer (src/contract/active.ts): what
 * `contract_check` adopted after a clean lint, or the `tasks/<name>.md`
 * the Todo panel reads. The panel is not told about the write: it re-reads the
 * file on its own tick, because the file is the single source of truth (D2) and
 * there is no second copy to notify.
 *
 * A background dispatch is the one case where the `tool_result` is not the end
 * of the work (D9): the tool returns the runner's task id while the child keeps
 * running. This file writes nothing on that event, and it is not told when the
 * child ends either — so D9's "the row stays `en curso`" needed a second half,
 * or the row would have stayed `en curso` forever and only the model's own
 * `commit:` would have closed it (skipping D3/S5 entirely). The half lives here:
 * `armBackgroundVerification` is called from `subagent_run`'s `execute` — the
 * parent's process, which does have a real context, and which is the only place
 * that knows the `contractTask` of this dispatch (D4: it travels as data, never
 * as a guess) — and the runner's `onSettled` calls
 * `settleBackgroundVerification`, which runs the same Check through the same
 * guard. A dispatch with no `contractTask` arms nothing.
 *
 * Two guards worth naming:
 *
 *   - calls made by another tool (`parentToolCallId`, e.g. a codemode script or
 *     a nested `executeTool`) are ignored: only a first-level dispatch is the
 *     model assigning work, and a nested call would otherwise clear the state
 *     of the dispatch that is still running.
 *   - children spawned by the subagent runner load this package too, so the
 *     extension installs nothing when `VIOLETA_AGENTS_CHILD=1` (same guard as
 *     the agents and todo extensions).
 *
 * Running the Check is `guardedCheckExecutor` (src/guard/check-executor.ts), the
 * single place this feature spawns a process: S6 puts the guard in front of it,
 * so a destructive `Check` asks the owner first (same dialog, same `Sí`), a
 * declined one never runs, and unattended mode runs none of them. The decision
 * is the guard's own `guardDecision` — no regex is copied here — and the refusal
 * comes back as `refused` on the result, which the writer turns into
 * `por verificar` plus the motive on D8's line.
 *
 * Event handlers only get an `ExtensionContext`, which has no `executeTool()` —
 * that lives on `ExtensionToolContext`, available inside a tool's `execute()`,
 * not here — so the Check cannot go through the bash tool from a `tool_result`
 * handler. It runs in this (the parent's) process, which is why
 * `VIOLETA_AGENTS_CHILD` is not set here and the guard does raise its dialog.
 * `verifyDispatch` takes the executor as a parameter so it can be handed over
 * without changing anything else in this file's wiring — and for the same
 * reason, so can the background path: `armBackgroundVerification` builds it
 * from the context the dispatch ran in.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setTaskCheckOutput, setTaskStatus } from "../src/contract/state.ts";
import { runCheckCommand, verifyTask, type CheckExecutor } from "../src/contract/verify.ts";
import { guardedCheckExecutor } from "../src/guard/check-executor.ts";
import { activeContractFrom } from "../src/contract/active.ts";

/** The tool whose dispatch carries a contract task. */
const DISPATCH_TOOL = "subagent_run";
/** The value a failed dispatch leaves on the row. */
const FAILED = "fallada";
const IN_PROGRESS = "en curso";

/** The task id of a dispatch, or undefined when the dispatch carries none. The
 * parameter is declared as `Type.Integer` on `subagent_run`, and anything that
 * is not a positive integer is treated as "no task" rather than coerced: a
 * typo must not land on somebody else's row. */
export function dispatchTaskId(input: unknown): number | undefined {
	const value = (input as { contractTask?: unknown } | undefined)?.contractTask;
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** True for a call another tool issued. Only first-level dispatches count. */
function isNested(event: unknown): boolean {
	const parent = (event as { parentToolCallId?: unknown } | undefined)?.parentToolCallId;
	return typeof parent === "string" && parent !== "";
}

/** D9: a background dispatch returns immediately, so its `tool_result` is not
 * the end of the work. */
function isBackground(input: unknown): boolean {
	return (input as { mode?: unknown } | undefined)?.mode === "background";
}

/** Write `text` to `file` through a sibling temp file and `renameSync`, so a
 * reader sees the contract before or after the write, never half of it. The
 * temp file has to be in the same directory: `rename(2)` is atomic within a
 * filesystem, and this file lives in the project the owner is working in. */
function writeAtomic(file: string, text: string): void {
	const tmp = `${file}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
	try {
		writeFileSync(tmp, text);
		renameSync(tmp, file);
	} catch (error) {
		try {
			rmSync(tmp, { force: true });
		} catch {
			/* nothing to clean up */
		}
		throw error;
	}
}

/** Read the active contract, and write the result back only when a byte
 * changed. A missing contract, a broken file or a failed write never reach the
 * tool call: the model's work is not worth losing over the harness's bookkeeping.
 * The read and the write are one turn of the event loop apart at most, and the
 * write is atomic, so nothing the model wrote gets clobbered here. */
function editContract(cwd: string, path: string, edit: (md: string) => string): void {
	try {
		const file = resolve(cwd, path);
		if (!existsSync(file)) return;
		const md = readFileSync(file, "utf8");
		const next = edit(md);
		if (next !== md) writeAtomic(file, next);
	} catch {
		/* a broken write must never break the tool call */
	}
}

/** Run the task's Check and record the real outcome on the row (S5). `run` is
 * the executor; the default is the shell, and the extension hands over the
 * guarded one (S6). A refused Check carries its motive, which goes on the D8
 * line under a `por verificar` row; a failed one carries its output.
 *
 * The Check is read from the text the dispatch saw, but the row is written onto
 * a FRESH read taken after the await: the Check can take ten minutes and the
 * guard can wait for the owner, and everything the model wrote in that window
 * has to survive (S7). Applying the pure transforms to the fresh text is what
 * makes that possible — they edit one line and one note, never the file. */
export async function verifyDispatch(cwd: string, path: string, taskId: number | undefined, run: CheckExecutor = runCheckCommand): Promise<void> {
	if (taskId === undefined) return;
	try {
		const file = resolve(cwd, path);
		if (!existsSync(file)) return;
		const outcome = await verifyTask(readFileSync(file, "utf8"), taskId, cwd, run);
		const fresh = readFileSync(file, "utf8");
		// A green or manual row carries no note, so a Check that now passes
		// removes the one a previous failure (or refusal) left behind (D8).
		const next = setTaskCheckOutput(
			setTaskStatus(fresh, taskId, outcome.status),
			taskId,
			outcome.output,
			outcome.status === "fallada" ? "failed" : "notRun",
		);
		if (next !== fresh) writeAtomic(file, next);
	} catch {
		/* a broken Check must never break the tool call */
	}
}

/** The context a background verification is built from: where the project is,
 * which contract the session adopted, and who the guard may ask (S6). An
 * `ExtensionToolContext` satisfies it, and so does a test's fake. */
export interface BackgroundVerificationContext extends Pick<ExtensionContext, "cwd" | "hasUI" | "ui"> {
	sessionManager?: unknown;
}

/** Verifications a background dispatch still owes, keyed by the runner's task
 * id (D9). It is filled by `subagent_run` and emptied by the runner's
 * `onSettled`, which is why it is keyed by the thing both of them know. */
const owedVerifications = new Map<string, () => Promise<void>>();

/** Remember the verification `runnerTaskId` owes: called by `violeta-agents`
 * when the dispatch carried a `contractTask`, because a background
 * `tool_result` arrives before the work is done (D9) and this process will not
 * hear about it again until the runner settles the task. No `contractTask`, no
 * entry: nothing is deduced from the label or the prompt (D4). */
export function armBackgroundVerification(runnerTaskId: string, contractTask: number | undefined, ctx: BackgroundVerificationContext): void {
	if (contractTask === undefined) return;
	owedVerifications.set(runnerTaskId, () => verifyDispatch(ctx.cwd, activeContractFrom(ctx.sessionManager), contractTask, guardedCheckExecutor(ctx)));
}

/** Run the verification a settled background task owes, and forget it. Called
 * by the runner's `onSettled` through `violeta-agents`: this is what stops a
 * background row from staying `en curso` forever, and it is the same Check, the
 * same guard and the same writer as the foreground path (S5/S6/D3). */
export async function settleBackgroundVerification(runnerTaskId: string): Promise<void> {
	const verify = owedVerifications.get(runnerTaskId);
	if (!verify) return;
	owedVerifications.delete(runnerTaskId);
	try {
		await verify();
	} catch {
		/* a broken Check must never break the runner's settlement */
	}
}


export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner load this package too: no state
	// writes there (same guard as the agents and todo extensions).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	pi.on("tool_call", (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		const taskId = dispatchTaskId(event.input);
		const path = activeContractFrom((ctx as { sessionManager?: unknown } | undefined)?.sessionManager);
		editContract(ctx.cwd, path, (md) => setTaskStatus(md, taskId ?? 0, taskId === undefined ? undefined : IN_PROGRESS));
	});

	pi.on("tool_result", async (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		const taskId = dispatchTaskId(event.input);
		const path = activeContractFrom((ctx as { sessionManager?: unknown } | undefined)?.sessionManager);
		if (event.isError) {
			// The dispatch itself failed: there is no delivery to verify.
			editContract(ctx.cwd, path, (md) => setTaskStatus(md, taskId ?? 0, taskId === undefined ? undefined : FAILED));
			return;
		}
		// D9: in background the row stays `en curso`; verification happens when the
		// work actually ends, not when the tool call returns. That end is not this
		// event: `subagent_run` armed the verification and the runner's `onSettled`
		// settles it (armBackgroundVerification / settleBackgroundVerification).
		if (isBackground(event.input)) return;
		// S6: the Check goes through the guard, and unattended mode runs none.
		await verifyDispatch(ctx.cwd, path, taskId, guardedCheckExecutor(ctx));
	});
}
