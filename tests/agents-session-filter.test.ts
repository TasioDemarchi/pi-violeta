import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionTasks } from "../src/agents/session-filter.ts";
import type { AgentTask } from "../src/agents/store.ts";

function task(id: string, sessionId?: string): AgentTask {
	return {
		id,
		...(sessionId ? { sessionId } : {}),
		name: "probe",
		label: `label ${id}`,
		title: `title ${id}`,
		status: "completed",
		model: "nan/deepseek-v4-flash",
		effort: "low",
		tokens: 1,
		turns: 1,
		cost: 0,
		startedAt: 1,
		thread: [],
	};
}

test("keeps only the current session's tasks", () => {
	const tasks = [task("a", "s1"), task("b", "s2"), task("c", "s1")];
	assert.deepEqual(sessionTasks(tasks, "s1").map((t) => t.id), ["a", "c"]);
	assert.deepEqual(sessionTasks(tasks, "s9"), []);
});

test("tasks without a session id stay out of a scoped view", () => {
	assert.deepEqual(sessionTasks([task("old")], "s1"), []);
});

test("without a known session id nothing is hidden", () => {
	const tasks = [task("a", "s1"), task("b", "s2"), task("old")];
	assert.deepEqual(sessionTasks(tasks, undefined).map((t) => t.id), ["a", "b", "old"]);
});
