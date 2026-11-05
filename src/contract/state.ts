/** Contract task state (T2 spike, estado-de-tareas). The `## Tasks` section is
 * the single source of truth (D2), the harness writes an `— estado:` field on a
 * task row, and the Todo panel is derived from that same file, so there is no
 * second copy of the state to keep in sync.
 *
 * The reading half now delegates to `./tasks.ts` (T3, S2): one definition of
 * what a task row is, what its title is and what makes it done. This module
 * keeps only what the spike added — the harness-owned `estado:` field and the
 * panel projection. T4 replaces the writer, T5 the projection, T6 the wiring. */

import { readContractTasks } from "./tasks.ts";
import { find, sections } from "./lint.ts";
import type { TodoStatus, TodoTask } from "../todo/store.ts";

const TASK_ROW = /^T(\d+)\. /;
/** Field the harness owns while a task is in flight. `commit:` — the done
 * marker (S2) — is the model's field and is never touched here. */
const STATUS_FIELD = " — estado:";

export interface ContractTaskRow {
	id: number;
	/** The raw markdown line, verbatim. */
	line: string;
}

/** The `## Tasks` rows, in order; a contract without the section yields an
 * empty list instead of throwing. */
export function parseContractTasks(md: string): ContractTaskRow[] {
	const section = find(sections(md), "tasks", "tareas");
	if (!section) return [];
	const rows: ContractTaskRow[] = [];
	for (const { text } of section.lines) {
		const match = TASK_ROW.exec(text);
		if (match) rows.push({ id: Number(match[1]), line: text });
	}
	return rows;
}

/** Write (status given) or clear (status undefined) the harness field on task
 * `taskId`. Unknown id and contracts without `## Tasks` return the text
 * unchanged; everything else on the row is preserved byte for byte. */
export function setTaskStatus(md: string, taskId: number, status: string | undefined): string {
	const lines = md.split("\n");
	const index = lines.findIndex((line) => {
		const match = TASK_ROW.exec(line);
		return match !== null && Number(match[1]) === taskId;
	});
	if (index === -1) return md;
	const stripped = lines[index].replace(/ — estado: [^—]*/g, "");
	lines[index] = status === undefined ? stripped : `${stripped}${STATUS_FIELD} ${status}`;
	return lines.join("\n");
}

/** The panel's view of the contract: `done` comes from `commit:` (S2, via the
 * T3 reader), `estado: en curso` means in progress, everything else pending. */
export function todoFromContract(md: string): TodoTask[] {
	const rows = new Map(parseContractTasks(md).map((row) => [row.id, row.line]));
	return readContractTasks(md).map((task) => {
		let status: TodoStatus = "pending";
		if (task.done) status = "done";
		else if (/ — estado: en curso$/.test(rows.get(task.id) ?? "")) status = "in_progress";
		return { id: task.id, title: task.title, status };
	});
}
