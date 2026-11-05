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
 *   `subagent_run` tool_result  `mode: background` → nothing: no result yet (D9)
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
 * The active contract is `ACTIVE_CONTRACT` (src/todo/source.ts), the same path
 * the Todo panel reads. The panel is not told about the write: it re-reads the
 * file on its own tick, because the file is the single source of truth (D2) and
 * there is no second copy to notify.
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
 * Running the Check is `runCheckCommand` (src/contract/verify.ts), the single
 * place this feature spawns a process. Event handlers only get an
 * `ExtensionContext`, which has no `executeTool()` — that lives on
 * `ExtensionToolContext`, available inside a tool's `execute()`, not here — so
 * the Check cannot go through the bash tool from a `tool_result` handler today.
 * It is a value, not a call site, on purpose: T8 (S6, "the verification goes
 * through the guard") replaces that executor with one that asks the guard first
 * and refuses in unattended mode, and `verifyDispatch` takes it as a parameter
 * so it can be handed over without touching this file's wiring.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTaskCheckOutput, setTaskStatus } from "../src/contract/state.ts";
import { runCheckCommand, verifyTask, type CheckExecutor } from "../src/contract/verify.ts";
import { ACTIVE_CONTRACT } from "../src/todo/source.ts";

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

/** Read the active contract, and write the result back only when a byte
 * changed. A missing contract, a broken file or a failed write never reach the
 * tool call: the model's work is not worth losing over the harness's bookkeeping. */
function editContract(cwd: string, edit: (md: string) => string): void {
	try {
		const file = resolve(cwd, ACTIVE_CONTRACT);
		if (!existsSync(file)) return;
		const md = readFileSync(file, "utf8");
		const next = edit(md);
		if (next !== md) writeFileSync(file, next);
	} catch {
		/* a broken write must never break the tool call */
	}
}

/** Run the task's Check and record the real outcome on the row (S5). `run` is
 * the executor seam T8 replaces; the default is the shell. */
export async function verifyDispatch(cwd: string, taskId: number | undefined, run: CheckExecutor = runCheckCommand): Promise<void> {
	if (taskId === undefined) return;
	try {
		const file = resolve(cwd, ACTIVE_CONTRACT);
		if (!existsSync(file)) return;
		const md = readFileSync(file, "utf8");
		const outcome = await verifyTask(md, taskId, cwd, run);
		// A green or manual row carries no output line, so a Check that now
		// passes removes the one a previous failure left behind (D8).
		const next = setTaskCheckOutput(
			setTaskStatus(md, taskId, outcome.status),
			taskId,
			outcome.status === "fallada" ? outcome.output : undefined,
		);
		if (next !== md) writeFileSync(file, next);
	} catch {
		/* a broken Check must never break the tool call */
	}
}

export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner load this package too: no state
	// writes there (same guard as the agents and todo extensions).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	pi.on("tool_call", (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		const taskId = dispatchTaskId(event.input);
		editContract(ctx.cwd, (md) => setTaskStatus(md, taskId ?? 0, taskId === undefined ? undefined : IN_PROGRESS));
	});

	pi.on("tool_result", async (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		const taskId = dispatchTaskId(event.input);
		if (event.isError) {
			// The dispatch itself failed: there is no delivery to verify.
			editContract(ctx.cwd, (md) => setTaskStatus(md, taskId ?? 0, taskId === undefined ? undefined : FAILED));
			return;
		}
		// D9: in background the row stays `en curso`; T7 verifies when the work
		// actually ends, not when the tool call returns.
		if (isBackground(event.input)) return;
		await verifyDispatch(ctx.cwd, taskId);
	});
}
