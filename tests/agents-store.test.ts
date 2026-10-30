import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentStore, capText, getAgentStore, type AgentTask } from "../src/agents/store.ts";

function task(overrides: Partial<AgentTask> = {}): AgentTask {
	return {
		id: overrides.id ?? "t1",
		name: "probe",
		label: "hello",
		status: overrides.status ?? "running",
		model: "nan/deepseek-v4-flash",
		effort: "low",
		tokens: 0,
		cost: 0,
		startedAt: 1000,
		thread: [],
		...overrides,
	};
}

test("upsert, get and list return tasks in insertion order", () => {
	const store = new AgentStore();
	store.upsert(task({ id: "a" }));
	store.upsert(task({ id: "b" }));
	assert.deepEqual(store.list().map((t) => t.id), ["a", "b"]);
	assert.equal(store.get("b")?.name, "probe");
	assert.equal(store.get("zz"), undefined);
});

test("update merges a patch and notifies subscribers with the task", () => {
	const store = new AgentStore();
	store.upsert(task());
	const seen: AgentTask[] = [];
	// Listeners receive the live task reference (mutated in place); snapshot it.
	const unsubscribe = store.subscribe((t) => seen.push({ ...t, thread: [...t.thread] }));
	store.update("t1", { status: "completed", result: "done" });
	unsubscribe();
	store.update("t1", { status: "failed" });
	assert.equal(seen.length, 1);
	assert.equal(seen[0]?.status, "completed");
	assert.equal(store.get("t1")?.result, "done");
});

test("subscribe returns an unsubscribe that stops notifications", () => {
	const store = new AgentStore();
	store.upsert(task());
	let count = 0;
	const unsubscribe = store.subscribe(() => count++);
	store.update("t1", { status: "completed" });
	unsubscribe();
	store.update("t1", { error: "late" });
	assert.equal(count, 1);
});

test("cancel marks a queued task aborted and counts it in activeCount until then", () => {
	const store = new AgentStore();
	store.upsert(task({ status: "queued" }));
	assert.equal(store.activeCount(), 1);
	assert.equal(store.cancel("t1"), true);
	assert.equal(store.get("t1")?.status, "aborted");
	assert.equal(typeof store.get("t1")?.endedAt, "number");
	assert.equal(store.activeCount(), 0);
});

test("cancel on a running task delegates to the cancel handler", () => {
	const store = new AgentStore();
	store.upsert(task({ status: "running" }));
	let asked: string | undefined;
	store.setCancelHandler((id) => {
		asked = id;
		return true;
	});
	assert.equal(store.cancel("t1"), true);
	assert.equal(asked, "t1");
});

test("cancel on an unknown or finished task returns false", () => {
	const store = new AgentStore();
	store.upsert(task({ status: "completed" }));
	assert.equal(store.cancel("t1"), false);
	assert.equal(store.cancel("nope"), false);
});

test("cancelAll cancels every active task", () => {
	const store = new AgentStore();
	const asked: string[] = [];
	store.setCancelHandler((id) => {
		asked.push(id);
		return true;
	});
	store.upsert(task({ id: "a", status: "queued" }));
	store.upsert(task({ id: "b", status: "running" }));
	store.upsert(task({ id: "c", status: "completed" }));
	assert.equal(store.cancelAll(), 2);
	assert.deepEqual(asked.sort(), ["b"]);
	assert.equal(store.get("a")?.status, "aborted");
	assert.equal(store.get("c")?.status, "completed");
});

test("history loads finished tasks and skips present and unfinished ones", () => {
	const store = new AgentStore();
	store.upsert(task({ id: "live", status: "running" }));
	store.history([
		task({ id: "old1", status: "completed", result: "r" }),
		task({ id: "live", status: "completed" }),
		task({ id: "junk", status: "running" } as AgentTask),
	]);
	assert.deepEqual(store.list().map((t) => t.id), ["live", "old1"]);
	assert.equal(store.get("live")?.status, "running");
	assert.equal(store.get("old1")?.result, "r");
});

test("thread items are capped and long text is truncated", () => {
	const store = new AgentStore();
	store.upsert(task());
	for (let i = 0; i < 300; i++) store.pushThreadItem("t1", { kind: "text", text: `item ${i}` });
	const thread = store.get("t1")!.thread;
	assert.equal(thread.length, 200);
	assert.equal(thread[0]?.text, "item 100");
	assert.equal(thread[199]?.text, "item 299");
	assert.equal(capText("x".repeat(9000), 8000).length, 8000);
});

test("appendThreadText extends the last item of the same kind or pushes a new one", () => {
	const store = new AgentStore();
	store.upsert(task());
	store.appendThreadText("t1", "thinking", "one ");
	store.appendThreadText("t1", "thinking", "two");
	store.appendThreadText("t1", "text", "answer");
	const thread = store.get("t1")!.thread;
	assert.deepEqual(thread.map((i) => i.text), ["one two", "answer"]);
	assert.deepEqual(thread.map((i) => i.kind), ["thinking", "text"]);
});

test("getAgentStore returns the same module singleton", () => {
	assert.equal(getAgentStore(), getAgentStore());
	assert.ok(getAgentStore() instanceof AgentStore);
});
