/** Session persistence for the todo list (T2/S6): the extension appends one
 * custom entry per successful mutating call and the session is restored by
 * replaying the last snapshot on the branch, so /resume brings the list back
 * while /new starts empty. Everything here is pure. */

import { TODO_STATUSES, emptyTodo, type TodoState, type TodoStatus, type TodoTask } from "./store.ts";

export const TODO_ENTRY_TYPE = "violeta-todo";

export interface TodoSnapshot {
	tasks: Array<{ id: number; title: string; status: TodoStatus; note?: string }>;
	nextId: number;
	/** null in JSON for "not settled" (undefined does not survive serialization). */
	settledAt: number | null;
}

interface SessionEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

/** The plain data stored in the custom entry. */
export function todoSnapshot(state: TodoState): TodoSnapshot {
	return {
		tasks: state.tasks.map((task) => ({ id: task.id, title: task.title, status: task.status, ...(task.note ? { note: task.note } : {}) })),
		nextId: state.nextId,
		settledAt: state.settledAt ?? null,
	};
}

function restoreTask(raw: unknown): TodoTask | undefined {
	if (typeof raw !== "object" || raw === null) return undefined;
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === "number" && Number.isInteger(record.id) && record.id > 0 ? record.id : undefined;
	const title = typeof record.title === "string" && record.title.trim() !== "" ? record.title : undefined;
	if (id === undefined || title === undefined) return undefined;
	const status = (TODO_STATUSES as readonly string[]).includes(record.status as string) ? (record.status as TodoStatus) : "pending";
	const note = typeof record.note === "string" && record.note.trim() !== "" ? record.note : undefined;
	return { id, title, status, ...(note ? { note } : {}) };
}

/** The state stored in one entry's data, defensive against old or junk data. */
function fromData(data: unknown): TodoState {
	if (typeof data !== "object" || data === null) return emptyTodo();
	const record = data as Record<string, unknown>;
	const tasks = Array.isArray(record.tasks) ? record.tasks.map(restoreTask).filter((task) => task !== undefined) : [];
	const nextId = typeof record.nextId === "number" && Number.isInteger(record.nextId) && record.nextId > 0 ? record.nextId : tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1;
	return {
		tasks,
		nextId: Math.max(nextId, tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1),
		...(typeof record.settledAt === "number" ? { settledAt: record.settledAt } : {}),
	};
}

/** Replay the branch: the LAST violeta-todo custom entry wins, everything else
 * (messages, other extensions) is ignored. */
export function replayTodo(entries: readonly unknown[]): TodoState {
	let state = emptyTodo();
	for (const entry of entries as SessionEntry[]) {
		if (entry?.type !== "custom" || entry.customType !== TODO_ENTRY_TYPE) continue;
		state = fromData(entry.data);
	}
	return state;
}
