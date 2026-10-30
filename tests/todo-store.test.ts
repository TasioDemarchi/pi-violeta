import { test } from "node:test";
import assert from "node:assert/strict";
import { applyTodo, emptyTodo, renderTodoText, type TodoState } from "../src/todo/store.ts";

const NOW = 1_000_000;

const seededState = (): TodoState => {
	let state = emptyTodo();
	state = applyTodo(state, { action: "add", title: "Write the parser" }, NOW).state;
	state = applyTodo(state, { action: "add", title: "Run tests", status: "in_progress", note: "npm test" }, NOW).state;
	state = applyTodo(state, { action: "add", title: "Deploy", status: "blocked", note: "waiting for CI" }, NOW).state;
	return state;
};

const LIST_TEXT = "#1 [pending] Write the parser\n#2 [in_progress] Run tests — npm test\n#3 [blocked] Deploy — waiting for CI";

test("emptyTodo is an empty list with next id 1", () => {
	assert.deepEqual(emptyTodo(), { tasks: [], nextId: 1 });
});

test("add appends one task with sequential ids", () => {
	const first = applyTodo(emptyTodo(), { action: "add", title: "First" }, NOW);
	assert.equal(first.error, undefined);
	assert.equal(first.text, "#1 [pending] First");
	assert.equal(first.state.tasks[0]?.id, 1);
	const second = applyTodo(first.state, { action: "add", title: "Second", status: "in_progress", note: "now" }, NOW);
	assert.equal(second.state.tasks[1]?.id, 2);
	assert.equal(second.state.tasks[1]?.status, "in_progress");
	assert.equal(second.state.tasks[1]?.note, "now");
	assert.equal(second.state.nextId, 3);
});

test("every successful call returns the compact rendering of the current list", () => {
	const state = seededState();
	assert.equal(applyTodo(state, { action: "list" }, NOW).text, LIST_TEXT);
	assert.equal(applyTodo(state, { action: "add", title: "Extra" }, NOW).text, LIST_TEXT + "\n#4 [pending] Extra");
	assert.equal(applyTodo(state, { action: "update", id: 1, status: "done" }, NOW).text, "#1 [done] Write the parser\n" + LIST_TEXT.slice(LIST_TEXT.indexOf("#2")));
	assert.equal(applyTodo(state, { action: "clear" }, NOW).text, "Sin tareas.");
});

test("renderTodoText of an empty list is exactly `Sin tareas.`", () => {
	assert.equal(renderTodoText(emptyTodo()), "Sin tareas.");
});

test("write replaces the whole list and keeps the ids of tasks that already exist", () => {
	const state = seededState();
	const result = applyTodo(state, {
		action: "write",
		tasks: [
			{ id: 2, title: "Run tests", status: "done" },
			{ title: "New task" },
		],
	}, NOW);
	assert.equal(result.error, undefined);
	assert.deepEqual(
		result.state.tasks.map((t) => [t.id, t.title, t.status]),
		[[2, "Run tests", "done"], [4, "New task", "pending"]],
	);
	// nextId stays above every id ever used in the session (ids 1-3 were used).
	assert.equal(result.state.nextId, 5);
	const after = applyTodo(result.state, { action: "add", title: "One more" }, NOW);
	assert.equal(after.state.tasks[2]?.id, 5);
});

test("write without ids assigns fresh ids from 1", () => {
	const result = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "a" }, { title: "b" }] }, NOW);
	assert.deepEqual(result.state.tasks.map((t) => t.id), [1, 2]);
});

test("write with a duplicate id keeps the first and assigns a new one to the second", () => {
	const result = applyTodo(emptyTodo(), {
		action: "write",
		tasks: [{ id: 5, title: "a" }, { id: 5, title: "b" }],
	}, NOW);
	assert.deepEqual(result.state.tasks.map((t) => t.id), [5, 6]);
});

test("write with no tasks empties the list", () => {
	const result = applyTodo(seededState(), { action: "write", tasks: [] }, NOW);
	assert.deepEqual(result.state.tasks, []);
	assert.equal(result.text, "Sin tareas.");
});

test("update changes one task by id (status, title, note)", () => {
	const state = seededState();
	const byStatus = applyTodo(state, { action: "update", id: 1, status: "in_progress" }, NOW);
	assert.equal(byStatus.state.tasks[0]?.status, "in_progress");
	const byTitle = applyTodo(state, { action: "update", id: 1, title: "Write the AST" }, NOW);
	assert.equal(byTitle.state.tasks[0]?.title, "Write the AST");
	const byNote = applyTodo(state, { action: "update", id: 1, note: "carefully" }, NOW);
	assert.equal(byNote.state.tasks[0]?.note, "carefully");
	// Unspecified fields survive.
	assert.equal(byStatus.state.tasks[0]?.title, "Write the parser");
});

test("update with an unknown id fails and leaves the list unchanged", () => {
	const state = seededState();
	const result = applyTodo(state, { action: "update", id: 9, status: "done" }, NOW);
	assert.equal(result.text, "Error: no existe la tarea #9");
	assert.equal(result.error, "no existe la tarea #9");
	assert.equal(result.state, state);
	assert.deepEqual(result.state.tasks, state.tasks);
});

test("update with nothing to change fails", () => {
	const state = seededState();
	const result = applyTodo(state, { action: "update", id: 1 }, NOW);
	assert.equal(result.text, "Error: nada que actualizar: pasá status, title o note");
	assert.equal(result.state, state);
});

test("blocked requires a note on add, write and update", () => {
	const state = emptyTodo();
	const added = applyTodo(state, { action: "add", title: "Wait", status: "blocked" }, NOW);
	assert.equal(added.text, "Error: una tarea bloqueada necesita una nota que diga qué espera");
	assert.equal(added.error, "una tarea bloqueada necesita una nota que diga qué espera");
	assert.equal(added.state, state);

	const written = applyTodo(state, { action: "write", tasks: [{ title: "Wait", status: "blocked" }] }, NOW);
	assert.equal(written.error, "una tarea bloqueada necesita una nota que diga qué espera");
	assert.equal(written.state, state);

	const updated = applyTodo(seededState(), { action: "update", id: 1, status: "blocked" }, NOW);
	assert.equal(updated.error, "una tarea bloqueada necesita una nota que diga qué espera");

	// A note attached by a separate update satisfies the rule.
	const ok = applyTodo(applyTodo(emptyTodo(), { action: "add", title: "Wait", note: "on ops" }, NOW).state, { action: "update", id: 1, status: "blocked" }, NOW);
	assert.equal(ok.error, undefined);
	assert.equal(ok.state.tasks[0]?.status, "blocked");
});

test("an empty title is rejected", () => {
	const state = emptyTodo();
	const result = applyTodo(state, { action: "add", title: "   " }, NOW);
	assert.equal(result.text, "Error: falta el título");
	assert.equal(result.state, state);
});

test("an unknown status is rejected with the valid list", () => {
	const result = applyTodo(emptyTodo(), { action: "add", title: "X", status: "doing" }, NOW);
	assert.equal(result.text, 'Error: estado desconocido "doing" (usá pending, in_progress, blocked, done o dropped)');
});

test("an unknown action is rejected and leaves the list unchanged", () => {
	const state = seededState();
	const result = applyTodo(state, { action: "purge" }, NOW);
	assert.equal(result.text, 'Error: acción desconocida "purge" (usá write, add, update, clear o list)');
	assert.equal(result.state, state);
});

test("clear empties the list", () => {
	const result = applyTodo(seededState(), { action: "clear" }, NOW);
	assert.deepEqual(result.state.tasks, []);
	assert.deepEqual(result.state.nextId, 4);
});

test("settledAt is set when everything is done or dropped and cleared while work is open", () => {
	let state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "a" }, { title: "b" }] }, NOW).state;
	assert.equal(state.settledAt, undefined);
	state = applyTodo(state, { action: "update", id: 1, status: "done" }, NOW + 1).state;
	assert.equal(state.settledAt, undefined);
	state = applyTodo(state, { action: "update", id: 2, status: "dropped" }, NOW + 2).state;
	assert.equal(state.settledAt, NOW + 2);
	// An update that keeps everything finished does not restart the hide window.
	state = applyTodo(state, { action: "update", id: 1, note: "ok" }, NOW + 3).state;
	assert.equal(state.settledAt, NOW + 2);
	// Reopening work clears it.
	state = applyTodo(state, { action: "add", title: "c" }, NOW + 4).state;
	assert.equal(state.settledAt, undefined);
});
