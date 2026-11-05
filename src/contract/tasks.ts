/** The pure reader of a contract's `## Tasks` section (S2, estado-de-tareas).
 *
 * One task per `T#.` row: its id, its title (the row text before its first
 * inline field) and whether it is done. Done means the row's `commit:` field
 * holds something other than `-` (D2: the contract file is the only source of
 * truth; D3: the harness only marks a task done after its `Check` is green, so
 * the model writing a commit is the model saying "I shipped this").
 *
 * The reader is pure: no filesystem, no environment, no Pi — the caller reads
 * the file and hands the text over. A contract without `## Tasks` yields an
 * empty list instead of throwing, because most contracts predate the section.
 *
 * It reuses the lint's section/item splitting on purpose: a row the lint sees
 * and a row the panel sees must be the same row, or the two disagree about how
 * many tasks the contract has.
 */

import { find, inlineField, items, sections } from "./lint.ts";

export interface ContractTask {
	/** Numeric part of the row id: `T3.` is `3`. */
	id: number;
	/** Row text before the first `— <field>:`, trimmed. */
	title: string;
	/** `commit:` has content other than `-`. */
	done: boolean;
}

/** The row's title: everything before the first inline field. An em dash that
 * is part of the prose (`— como sea`) stays in the title; only `— name:` cuts. */
function titleOf(body: string): string {
	const first = (body.split("\n")[0] ?? "").trim();
	const cut = first.search(/\s+—\s+[^\s—]+:/);
	return (cut === -1 ? first : first.slice(0, cut)).trim();
}

function isDone(body: string): boolean {
	const commit = inlineField(body, "commit");
	return commit !== undefined && commit !== "" && commit !== "-";
}

/** Every `T#.` row of the `## Tasks` section, in file order. */
export function readContractTasks(md: string): ContractTask[] {
	return items(find(sections(md), "tasks", "tareas"), "T").map((item) => ({
		id: Number(item.id.replace(/^T/, "")),
		title: titleOf(item.body),
		done: isDone(item.body),
	}));
}
