import { test } from "node:test";
import assert from "node:assert/strict";
import { replayTodo, TODO_ENTRY_TYPE, todoSnapshot } from "../src/todo/persist.ts";
import { applyTodo, emptyTodo } from "../src/todo/store.ts";

const NOW = 1_000_000;

function state() {
	return applyTodo(applyTodo(emptyTodo(), { action: "add", title: "a" }, NOW).state, {
		action: "add",
		title: "b",
		status: "in_progress",
		note: "n",
	}, NOW).state;
}

test("the entry type is namespaced for violeta", () => {
	assert.equal(TODO_ENTRY_TYPE, "violeta-todo");
});

test("todoSnapshot is plain JSON data carrying tasks, nextId and the hide timestamp", () => {
	const snap = todoSnapshot(state());
	assert.deepEqual(snap, {
		tasks: [
			{ id: 1, title: "a", status: "pending" },
			{ id: 2, title: "b", status: "in_progress", note: "n" },
		],
		nextId: 3,
		settledAt: null,
	});
	assert.deepEqual(JSON.parse(JSON.stringify(snap)), snap);
});

test("todoSnapshot carries settledAt when every task is finished", () => {
	let done = applyTodo(state(), { action: "update", id: 1, status: "done" }, NOW + 1).state;
	done = applyTodo(done, { action: "update", id: 2, status: "done" }, NOW + 2).state;
	assert.equal(todoSnapshot(done).settledAt, NOW + 2);
});

test("replayTodo of no entries is an empty list", () => {
	assert.deepEqual(replayTodo([]), emptyTodo());
});

test("replayTodo ignores foreign entries and restores the last violeta-todo snapshot", () => {
	const older = todoSnapshot(state());
	const newer = todoSnapshot(emptyTodo());
	const entries = [
		{ type: "message", message: { role: "user" } },
		{ type: "custom", customType: "other-extension", data: { tasks: "junk" } },
		{ type: "custom", customType: TODO_ENTRY_TYPE, data: older },
		{ type: "message", message: { role: "assistant" } },
		{ type: "custom", customType: TODO_ENTRY_TYPE, data: newer },
	];
	assert.deepEqual(replayTodo(entries), emptyTodo());
	assert.deepEqual(replayTodo(entries.slice(0, 4)), state());
});

test("replayTodo survives a settledAt timestamp and restores the hide window", () => {
	let done = applyTodo(state(), { action: "update", id: 1, status: "done" }, NOW + 1).state;
	done = applyTodo(done, { action: "update", id: 2, status: "done" }, NOW + 2).state;
	const restored = replayTodo([{ type: "custom", customType: TODO_ENTRY_TYPE, data: todoSnapshot(done) }]);
	assert.deepEqual(restored, done);
	assert.equal(restored.settledAt, NOW + 2);
});

test("replayTodo tolerates malformed snapshots", () => {
	const restored = replayTodo([
		{ type: "custom", customType: TODO_ENTRY_TYPE, data: { tasks: [null, { title: "no id" }, { id: "x", title: "y" }, { id: 7, title: "ok", status: "weird" }, { id: 3, title: "fine", status: "done" }], nextId: "z" } },
	]);
	assert.deepEqual(restored.tasks, [{ id: 7, title: "ok", status: "pending" }, { id: 3, title: "fine", status: "done" }]);
	assert.equal(restored.nextId, 8);
});
