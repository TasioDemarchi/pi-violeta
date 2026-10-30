import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentStore, type AgentTask } from "../src/agents/store.ts";
import { createReducer, type Reducer } from "../src/agents/reduce.ts";

function setup(): { store: AgentStore; task: AgentTask; reducer: Reducer } {
	const store = new AgentStore();
	const task: AgentTask = {
		id: "t1",
		name: "probe",
		label: "hello",
		status: "running",
		model: "nan/deepseek-v4-flash",
		effort: "low",
		tokens: 0,
		cost: 0,
		startedAt: 1000,
		thread: [],
	};
	store.upsert(task);
	return { store, task, reducer: createReducer(store, task) };
}

test("thinking and text deltas accumulate into thread items", () => {
	const { task, reducer } = setup();
	reducer.apply({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm " } });
	reducer.apply({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "ok" } });
	reducer.apply({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hi " } });
	reducer.apply({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "there" } });
	assert.deepEqual(task.thread.map((i) => [i.kind, i.text]), [
		["thinking", "hmm ok"],
		["text", "Hi there"],
	]);
});

test("tool start and end map to a bounded tool item with status", () => {
	const { task, reducer } = setup();
	reducer.apply({ type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "ls" } });
	assert.deepEqual(task.thread[0], { kind: "tool", text: "ls", toolName: "bash", toolStatus: "running" });
	assert.equal(reducer.inFlightCount(), 1);
	const end = reducer.apply({
		type: "tool_execution_end",
		toolCallId: "c1",
		toolName: "bash",
		isError: false,
		result: { content: [{ type: "text", text: "file.txt" }] },
	});
	assert.equal(end.activity, true);
	assert.equal(reducer.inFlightCount(), 0);
	assert.equal(task.thread[0]?.toolStatus, "done");
	assert.match(task.thread[0]?.text ?? "", /file\.txt/);

	reducer.apply({ type: "tool_execution_start", toolCallId: "c2", toolName: "write", args: {} });
	reducer.apply({ type: "tool_execution_end", toolCallId: "c2", toolName: "write", isError: true, result: {} });
	assert.equal(task.thread[1]?.toolStatus, "error");
});

test("assistant message_end accumulates tokens and cost and records the result", () => {
	const { task, reducer } = setup();
	reducer.apply({
		type: "message_end",
		message: {
			role: "assistant",
			content: [{ type: "text", text: "The answer." }],
			usage: { input: 100, output: 20, cost: { total: 0.5 } },
		},
	});
	assert.equal(task.tokens, 120);
	assert.equal(task.cost, 0.5);
	assert.equal(task.result, "The answer.");
	reducer.apply({
		type: "message_end",
		message: { role: "assistant", content: [{ type: "text", text: "More." }], usage: { input: 10, output: 5, cost: { total: 0.25 } } },
	});
	assert.equal(task.tokens, 135);
	assert.equal(task.cost, 0.75);
	assert.equal(task.result, "More.");
});

test("user message_end is ignored", () => {
	const { task, reducer } = setup();
	const r = reducer.apply({ type: "message_end", message: { role: "user", content: "hi" } });
	assert.equal(task.tokens, 0);
	assert.equal(task.result, undefined);
	assert.equal(r.settled, false);
});

test("agent_settled reports settlement and aborts", () => {
	const { reducer } = setup();
	const r = reducer.apply({ type: "agent_settled", aborted: false });
	assert.equal(r.settled, true);
	assert.equal(r.aborted, false);
	const r2 = reducer.apply({ type: "agent_settled", aborted: true });
	assert.equal(r2.aborted, true);
});

test("every parsed record counts as activity", () => {
	const { reducer } = setup();
	assert.equal(reducer.apply({ type: "turn_start" }).activity, true);
});

test("thread stays bounded while streaming", () => {
	const { task, reducer } = setup();
	for (let i = 0; i < 500; i++) {
		reducer.apply({ type: "tool_execution_start", toolCallId: `c${i}`, toolName: "bash", args: { command: `cmd ${i}` } });
	}
	assert.ok(task.thread.length <= 200);
	assert.equal(reducer.inFlightCount(), 200);
});
