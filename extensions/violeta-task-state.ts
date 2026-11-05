/**
 * violeta-task-state — the harness-side writer of a contract task's `estado:`
 * field (S4, estado-de-tareas). It is the event half of "the harness records
 * on its own": the model decides what to dispatch, this file decides what that
 * dispatch means for the task row.
 *
 * The loop it closes:
 *
 *   `subagent_run` tool_call  with `contractTask: N` → `estado: en curso`
 *   `subagent_run` tool_result       no isError      → the field is cleared
 *   `subagent_run` tool_result       isError         → `estado: fallada`
 *   anything else                                    → the file is not touched
 *
 * The task id travels as DISPATCH DATA (`contractTask` on the call, D4). It is
 * never read out of `label`, `task` or any other prose: a dispatch whose label
 * happens to say "T1" writes nothing, and the only thing that writes is the
 * parameter. The spike read it from `label`; T6 removed that crutch.
 *
 * Writing goes through `setTaskStatus` (src/contract/state.ts), the one writer
 * of that field, so `commit:` and every other byte the model owns survive
 * untouched (S7). The active contract is `ACTIVE_CONTRACT`
 * (src/todo/source.ts), the same path the Todo panel reads. The panel is not
 * told about the write: it re-reads the file on its own tick, because the file
 * is the single source of truth (D2) and there is no second copy to notify.
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
 * Verification (T7), the guard on that verification (T8) and persisting which
 * contract is active (T9) are not here.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTaskStatus } from "../src/contract/state.ts";
import { ACTIVE_CONTRACT } from "../src/todo/source.ts";

/** The tool whose dispatch carries a contract task. */
const DISPATCH_TOOL = "subagent_run";
/** The two values this file writes; `undefined` means "clear the field". */
const IN_PROGRESS = "en curso";
const FAILED = "fallada";

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

export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner load this package too: no state
	// writes there (same guard as the agents and todo extensions).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	function mark(cwd: string, taskId: number | undefined, status: string | undefined): void {
		if (taskId === undefined) return;
		try {
			const file = resolve(cwd, ACTIVE_CONTRACT);
			if (!existsSync(file)) return;
			const md = readFileSync(file, "utf8");
			const next = setTaskStatus(md, taskId, status);
			// The panel is not told: it re-reads this file on its own tick (S3).
			if (next !== md) writeFileSync(file, next);
		} catch {
			/* a broken write must never break the tool call */
		}
	}

	pi.on("tool_call", (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		mark(ctx.cwd, dispatchTaskId(event.input), IN_PROGRESS);
	});

	pi.on("tool_result", (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		mark(ctx.cwd, dispatchTaskId(event.input), event.isError ? FAILED : undefined);
	});
}
