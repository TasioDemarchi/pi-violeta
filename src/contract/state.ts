/** Contract task state (estado-de-tareas). The `## Tasks` section is the single
 * source of truth (D2), the harness writes an `— estado:` field on a task row,
 * and the Todo panel is derived from that same file, so there is no second copy
 * of the state to keep in sync.
 *
 * Reading delegates to `./tasks.ts` (T3, S2): one definition of what a task row
 * is, what its title is and what makes it done. This module owns only the
 * harness field and the panel projection: T4 wrote the writer, T5 the
 * projection, T6 the wiring.
 *
 * One writer per field (S7). The field split is:
 *
 *   `— estado:`  the harness, and only the harness. `setTaskStatus` writes it
 *                when a task is dispatched (`en curso`), and `verify` replaces
 *                it with the real outcome: `verificada` when the task's Check
 *                passed, `fallada` when it failed, `por verificar` when the
 *                Check is `manual:` or missing (S5, D7).
 *   everything   the model: its title, its own prose and `commit:` — the done
 *   else         marker (S2/D3). This module never reads a row back from memory
 *                and rewrites it, so a model edit (`commit: -` → `commit: 9f8e7d6`)
 *                survives both the next harness write and the harness clear.
 *
 * Concretely, `setTaskStatus` is surgical: it edits one physical line, strips
 * only the `— estado:` field from it, and puts the new value where the old one
 * was (or at the end if there was none). Every other byte of the file — the
 * other rows, the model's continuation lines under the task, the whitespace —
 * comes out exactly as it went in, and `setTaskStatus(..., undefined)` on a
 * freshly written row gives back the original text. The row must live in the
 * `## Tasks` section: a `T1.` in `## Log` is prose, and an unknown id or a
 * contract without the section returns the text unchanged.
 *
 * `setTaskCheckOutput` owns the ONE zone outside a row that the harness touches
 * (D8): an indented continuation line under the task holding the clipped output
 * of a failed Check. It is recognised by its own prefix, so the model's prose
 * under the same task — also indented — is never mistaken for it, and writing a
 * Check that now passes removes the line instead of leaving a stale failure.
 *
 * A field's value runs to the next ` — ` separator or to the end of the line,
 * the same rule `inlineField` uses (lint.ts), so `estado:` and `commit:` parse
 * the same way for the reader and for the writer. */

import { readContractTasks } from "./tasks.ts";
import { find, items, sections } from "./lint.ts";
import type { TodoStatus, TodoTask } from "../todo/store.ts";

const TASK_ROW = /^T(\d+)\. /;
/** Name of the field the harness owns. `commit:` (the model's done marker, S2)
 * is never touched here. */
const STATUS_NAME = "estado";
/** One inline `— estado: <value>` field: the leading separator is consumed so a
 * strip leaves the surrounding fields' own ` — ` intact, and the value stops
 * before the next field separator or at end of line. */
const STATUS_SOURCE = `\\s+—\\s+${STATUS_NAME}:\\s*([^—\\n]*?)(?=\\s+—\\s|$)`;
const statusField = (flags = "i") => new RegExp(STATUS_SOURCE, flags);

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

/** 0-based index of task `taskId`'s row line, or -1 when the contract has no
 * `## Tasks` section, the id is unknown, or the only `T1.` lines live outside
 * the section. Splitting is the reader's (lint's `items`), so the writer edits
 * exactly the rows the panel shows. */
function rowIndexOf(md: string, taskId: number): number {
	const row = items(find(sections(md), "tasks", "tareas"), "T").find((item) => Number(item.id.slice(1)) === taskId);
	return row ? row.line - 1 : -1;
}

function headLineOf(md: string, taskId: number): string | undefined {
	const index = rowIndexOf(md, taskId);
	return index === -1 ? undefined : md.split("\n")[index];
}

/** The harness-written state of task `taskId`: `en curso`, `fallada`,
 * `verificada`, `por verificar`, or — for a task nobody marked — undefined. */
export function readTaskStatus(md: string, taskId: number): string | undefined {
	const head = headLineOf(md, taskId);
	if (head === undefined) return undefined;
	const value = statusField().exec(head)?.[1]?.trim();
	return value === undefined || value === "" ? undefined : value;
}

/** Write (status given) or clear (status undefined) the harness field on task
 * `taskId`. Unknown id and contracts without `## Tasks` return the text
 * unchanged; every other byte — the model's title, its `commit:`, its prose,
 * the other rows — is preserved. */
export function setTaskStatus(md: string, taskId: number, status: string | undefined): string {
	const lines = md.split("\n");
	const index = rowIndexOf(md, taskId);
	if (index === -1) return md;
	const head = lines[index]!;
	const hasField = statusField().test(head);
	if (status === undefined) {
		lines[index] = head.replace(statusField("gi"), "");
	} else if (hasField) {
		// replace in place, so a field the model put text after keeps its place
		lines[index] = head.replace(statusField("gi"), ` — ${STATUS_NAME}: ${status}`);
	} else {
		lines[index] = `${head} — ${STATUS_NAME}: ${status}`;
	}
	return lines.join("\n");
}

/** The panel's view of the contract: `done` comes from `commit:` (S2, via the
 * T3 reader) or from the harness's `estado: verificada` (D7: a task whose Check
 * passed is done even before the model writes its commit); `en curso` means in
 * progress; everything else — `fallada`, `por verificar`, nothing — is pending,
 * because a task the harness could not clear is a task still open. */
export function todoFromContract(md: string): TodoTask[] {
	return readContractTasks(md).map((task) => {
		const estado = readTaskStatus(md, task.id);
		let status: TodoStatus = "pending";
		if (task.done || estado === "verificada") status = "done";
		else if (estado === "en curso") status = "in_progress";
		return { id: task.id, title: task.title, status };
	});
}

/** Prefix that marks the continuation line as the harness's own (D8). Only a
 * line starting with exactly this is ever replaced or removed. */
const CHECK_NOTE_PREFIX = "    Check falló: ";
/** How much of a failed Check's output lands in the file: the first lines, on
 * one line, so a red row stays one row plus one line. */
const NOTE_MAX_LINES = 3;
const NOTE_MAX_CHARS = 300;

/** The clipped form of a failed Check's output (D8). */
export function clipCheckOutput(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.slice(0, NOTE_MAX_LINES);
	const text = lines.join(" / ");
	return text.length > NOTE_MAX_CHARS ? `${text.slice(0, NOTE_MAX_CHARS)}...` : text;
}

/** Index of the harness's own continuation line under the row at `rowIndex`, or
 * -1. The scan stops at a blank line or at column 0 (the next row or section),
 * so a note always belongs to the row above it and never to a neighbour. */
function noteIndexOf(lines: readonly string[], rowIndex: number): number {
	for (let i = rowIndex + 1; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.trim() === "") break;
		if (!/^\s/.test(line)) break;
		if (line.startsWith(CHECK_NOTE_PREFIX)) return i;
	}
	return -1;
}

/** Write (`output` given) or remove (`output` undefined) the harness's line of
 * failed-Check output under task `taskId` (D8). The line goes directly under the
 * row; the model's own indented prose is left where it is, byte for byte, and an
 * unknown id or a contract without `## Tasks` returns the text unchanged. */
export function setTaskCheckOutput(md: string, taskId: number, output: string | undefined): string {
	const lines = md.split("\n");
	const row = rowIndexOf(md, taskId);
	if (row === -1) return md;
	const existing = noteIndexOf(lines, row);
	const text = output === undefined ? "" : clipCheckOutput(output);
	if (text === "") {
		if (existing === -1) return md;
		lines.splice(existing, 1);
		return lines.join("\n");
	}
	const note = `${CHECK_NOTE_PREFIX}${text}`;
	if (existing === -1) lines.splice(row + 1, 0, note);
	else lines[existing] = note;
	return lines.join("\n");
}
