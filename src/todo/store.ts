/** Todo store — the pure reducer behind the `todo` tool (T2/S6). Validation and
 * semantics live here so every path is testable without a TUI: a rejected call
 * returns the ORIGINAL state (never a copy) so "unchanged" is observable, and
 * every successful call's text is the compact rendering of the current list. */

import { todo as t } from "../i18n.ts";

export const TODO_STATUSES = ["pending", "in_progress", "blocked", "done", "dropped"] as const;
export type TodoStatus = (typeof TODO_STATUSES)[number];

export interface TodoTask {
	id: number;
	title: string;
	status: TodoStatus;
	note?: string;
}

export interface TodoState {
	tasks: TodoTask[];
	/** Next id to hand out; never decreases within a session. */
	nextId: number;
	/** Epoch ms when the list became all done/dropped; drives the card's hide window. */
	settledAt?: number;
}

export interface TodoTaskInput {
	id?: number;
	title?: string;
	status?: string;
	note?: string;
}

export interface TodoParams {
	action: string;
	tasks?: TodoTaskInput[];
	id?: number;
	title?: string;
	status?: string;
	note?: string;
}

export interface TodoResult {
	state: TodoState;
	/** Exact tool result text: the compact list, or `Error: <reason>` when rejected. */
	text: string;
	error?: string;
}

export function emptyTodo(): TodoState {
	return { tasks: [], nextId: 1 };
}

function cleanText(value: unknown): string {
	return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function parseStatus(value: unknown): TodoStatus | undefined {
	const normalized = cleanText(value).toLowerCase();
	return (TODO_STATUSES as readonly string[]).includes(normalized) ? (normalized as TodoStatus) : undefined;
}

export function openCount(tasks: readonly TodoTask[]): number {
	return tasks.filter((task) => task.status === "pending" || task.status === "in_progress" || task.status === "blocked").length;
}

export function doneCount(tasks: readonly TodoTask[]): number {
	return tasks.filter((task) => task.status === "done").length;
}

/** `#2 [in_progress] Run tests — npm test` per task, in list order. */
export function renderTodoText(state: TodoState): string {
	if (state.tasks.length === 0) return t.empty;
	return state.tasks
		.map((task) => `#${task.id} [${task.status}] ${task.title}${task.note ? ` — ${task.note}` : ""}`)
		.join("\n");
}

function isSettled(tasks: readonly TodoTask[]): boolean {
	return tasks.length > 0 && tasks.every((task) => task.status === "done" || task.status === "dropped");
}

/** The settled timestamp survives updates that keep everything finished, so an
 * edit inside the hide window never extends it. */
function settledAtOf(previous: TodoState, tasks: TodoTask[], now: number): number | undefined {
	if (!isSettled(tasks)) return undefined;
	const at = previous.settledAt ?? now;
	return at;
}

/** Canonical state: no settledAt key when undefined, so snapshots compare clean. */
function withSettled(tasks: TodoTask[], nextId: number, settledAt: number | undefined): TodoState {
	return { tasks, nextId, ...(settledAt !== undefined ? { settledAt } : {}) };
}

/** Validate one task input; returns the task or the error message. */
function buildTask(input: TodoTaskInput, id: number): TodoTask | string {
	const title = cleanText(input.title);
	if (title.length === 0) return t.titleRequired;
	const status = input.status === undefined || input.status === "" ? "pending" : parseStatus(input.status);
	if (!status) return t.unknownStatus(String(input.status));
	const note = cleanText(input.note);
	if (status === "blocked" && note.length === 0) return t.blockedNeedsNote;
	return { id, title, status, ...(note ? { note } : {}) };
}

function write(state: TodoState, inputs: readonly TodoTaskInput[] | undefined, now: number): TodoResult {
	const tasks: TodoTask[] = [];
	let nextId = state.nextId;
	for (const input of inputs ?? []) {
		const usable = typeof input.id === "number" && Number.isInteger(input.id) && input.id > 0 && !tasks.some((task) => task.id === input.id);
		const id = usable ? (input.id as number) : nextId++;
		nextId = Math.max(nextId, id + 1);
		const built = buildTask(input, id);
		if (typeof built === "string") return { state, text: `Error: ${built}`, error: built };
		tasks.push(built);
	}
	const settled = settledAtOf(state, tasks, now);
	const next: TodoState = withSettled(tasks, nextId, settled);
	return { state: next, text: renderTodoText(next) };
}

function update(state: TodoState, params: TodoParams, now: number): TodoResult {
	const task = state.tasks.find((candidate) => candidate.id === params.id);
	if (!task) return { state, text: `Error: ${t.noTask(params.id)}`, error: t.noTask(params.id) };
	if (params.status === undefined && params.title === undefined && params.note === undefined) {
		const error = t.nothingToUpdate;
		return { state, text: `Error: ${error}`, error };
	}
	const built = buildTask(
		{ title: params.title ?? task.title, status: params.status ?? task.status, note: params.note ?? task.note },
		task.id,
	);
	if (typeof built === "string") return { state, text: `Error: ${built}`, error: built };
	const tasks = state.tasks.map((candidate) => (candidate.id === task.id ? built : candidate));
	const next: TodoState = withSettled(tasks, state.nextId, settledAtOf(state, tasks, now));
	return { state: next, text: renderTodoText(next) };
}

/** The whole tool: pure, and a rejected call returns the original state object. */
export function applyTodo(state: TodoState, params: TodoParams, now: number = Date.now()): TodoResult {
	switch (params.action) {
		case "write":
			return write(state, params.tasks, now);
		case "add": {
			const built = buildTask({ title: params.title, status: params.status, note: params.note }, state.nextId);
			if (typeof built === "string") return { state, text: `Error: ${built}`, error: built };
			const tasks = [...state.tasks, built];
			const next: TodoState = withSettled(tasks, state.nextId + 1, settledAtOf(state, tasks, now));
			return { state: next, text: renderTodoText(next) };
		}
		case "update":
			return update(state, params, now);
		case "clear":
			return { state: { tasks: [], nextId: state.nextId }, text: t.empty };
		case "list":
			return { state, text: renderTodoText(state) };
		default: {
			const error = t.unknownAction(params.action);
			return { state, text: `Error: ${error}`, error };
		}
	}
}
