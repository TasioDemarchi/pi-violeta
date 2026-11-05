/** Contract task state (T2 spike, estado-de-tareas). Pure transforms over the
 * contract markdown: the `## Tasks` section is the single source of truth (D2),
 * the harness writes an `— estado:` field on a task row, and the Todo panel is
 * derived from that same file, so there is no second copy of the state to keep
 * in sync. This module is the thinnest version of the reader (T3) and the
 * single-writer (T4); both replace it once the loop is proven. */

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
	const lines = md.split("\n");
	const start = lines.findIndex((line) => line.trim() === "## Tasks");
	if (start === -1) return [];
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) => /^## /.test(line));
	return (end === -1 ? rest : rest.slice(0, end))
		.filter((line) => TASK_ROW.test(line))
		.map((line) => ({ id: Number(TASK_ROW.exec(line)![1]), line }));
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

/** The panel's view of the contract: `commit:` with content other than `-`
 * means done (S2), `estado: en curso` means in progress, everything else
 * pending. The title is the row text before its first field. */
export function todoFromContract(md: string): TodoTask[] {
	return parseContractTasks(md).map((row) => {
		const title = row.line
			.replace(/^T\d+\.\s*/, "")
			.replace(/\s+—.*$/, "")
			.trim();
		const commit = / — commit: (.*?)(?: —|$)/.exec(row.line)?.[1]?.trim() ?? "";
		let status: TodoStatus = "pending";
		if (commit !== "" && commit !== "-") status = "done";
		else if (/ — estado: en curso$/.test(row.line)) status = "in_progress";
		return { id: row.id, title, status };
	});
}
