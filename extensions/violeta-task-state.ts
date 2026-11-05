/** T2 spike (estado-de-tareas), reduced by T5: the harness-side writer of the
 * `estado:` field. When a `subagent_run` dispatch starts, it writes
 * `estado: en curso` on the task's row of the active contract; when the call
 * settles it writes `estado: fin` (or `fallada`), so the row reads as it did
 * before the dispatch. No verification, no guard, no persistence — those are
 * T7, T8 and T9.
 *
 * It no longer publishes the panel: the Todo panel is derived in ONE place now
 * (S3), by violeta-todo through `src/todo/source.ts`, which re-reads this file
 * on its own tick. This module only writes; the file is the handoff between
 * the two, which is the whole point of D2.
 *
 * Spike crutch, to be removed by T6: the task id is read from the dispatch's
 * `label` text. The contract (D4) requires the id to travel as dispatch data. */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setTaskStatus } from "../src/contract/state.ts";
import { ACTIVE_CONTRACT } from "../src/todo/source.ts";

export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner load this package too: no state
	// writes there (same guard as the agents and todo extensions).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	function taskIdOf(input: unknown): number | undefined {
		const label = (input as { label?: unknown } | undefined)?.label;
		const match = /T(\d+)/.exec(typeof label === "string" ? label : "");
		return match ? Number(match[1]) : undefined;
	}

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
		if (event.toolName === "subagent_run") mark(ctx.cwd, taskIdOf(event.input), "en curso");
	});

	pi.on("tool_result", (event, ctx) => {
		if (event.toolName === "subagent_run") mark(ctx.cwd, taskIdOf(event.input), event.isError ? "fallada" : undefined);
	});
}
