/** T2 spike (estado-de-tareas): the thinnest event → file → panel loop. When a
 * `subagent_run` dispatch starts, the harness writes `estado: en curso` on the
 * task's row of the active contract and re-derives the Todo panel from that
 * same file; when the call settles it writes `estado: fin` (or `fallada`), so
 * the row reads as it did before the dispatch. No verification, no guard, no
 * persistence — those are T7, T8 and T9.
 *
 * Spike crutch, to be removed by T6: the task id is read from the dispatch's
 * `label` text. The contract (D4) requires the id to travel as dispatch data.
 * The contract path is also hardcoded for now; T9 owns "which contract is
 * active". */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTaskStatus, todoFromContract } from "../src/contract/state.ts";
import { setShared } from "../src/shared-hub.ts";

const CONTRACT = "tasks/estado-de-tareas.md";

export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner load this package too: no state
	// writes there (same guard as the agents and todo extensions).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	function taskIdOf(input: unknown): number | undefined {
		const label = (input as { label?: unknown } | undefined)?.label;
		const match = /T(\d+)/.exec(typeof label === "string" ? label : "");
		return match ? Number(match[1]) : undefined;
	}

	function publish(cwd: string): void {
		// The panel is a view: re-read the file the write just landed in.
		try {
			const file = resolve(cwd, CONTRACT);
			if (!existsSync(file)) return;
			setShared({ todoState: { tasks: todoFromContract(readFileSync(file, "utf8")), nextId: 1 } });
		} catch {
			/* a broken publish must never break the tool call */
		}
	}

	function mark(cwd: string, taskId: number | undefined, status: string | undefined): void {
		if (taskId === undefined) return;
		try {
			const file = resolve(cwd, CONTRACT);
			if (!existsSync(file)) return;
			const md = readFileSync(file, "utf8");
			const next = setTaskStatus(md, taskId, status);
			if (next !== md) writeFileSync(file, next);
			publish(cwd);
		} catch {
			/* a broken write must never break the tool call */
		}
	}

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName === "subagent_run") mark(ctx.cwd, taskIdOf(event.input), "en curso");
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName === "subagent_run") mark(ctx.cwd, taskIdOf(event.input), event.isError ? "fallada" : undefined);
	});
}
