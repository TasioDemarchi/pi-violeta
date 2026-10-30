import { test } from "node:test";
import assert from "node:assert/strict";
import { cardMaxRows, cardTasks, formatElapsed, renderAgentsCard, type CardFg } from "../src/agents/card.ts";
import type { AgentTask } from "../src/agents/store.ts";

// Identity theme: roles must not change the visible text in layout tests.
const plain: CardFg = (_role, text) => text;
// Tagging theme: makes the role of every segment visible for color tests.
const tagged: CardFg = (role, text) => `<${role}>${text}</${role}>`;

function task(overrides: Partial<AgentTask>): AgentTask {
	return {
		id: "t1",
		name: "probe",
		label: "hello",
		status: "running",
		model: "gpt/x",
		effort: "low",
		tokens: 0,
		cost: 0,
		startedAt: 0,
		thread: [],
		...overrides,
	};
}

test("formatElapsed renders seconds, minutes and hours", () => {
	assert.equal(formatElapsed(0), "0s");
	assert.equal(formatElapsed(25_400), "25s");
	assert.equal(formatElapsed(84_000), "1m24s");
	assert.equal(formatElapsed(3_725_000), "1h02m");
});

test("cardTasks shows active tasks plus finished ones for one minute, at most three", () => {
	const now = 100_000;
	const tasks = [
		task({ id: "a", status: "completed", endedAt: now - 61_000 }),
		task({ id: "b", status: "completed", endedAt: now - 30_000 }),
		task({ id: "c", status: "failed", endedAt: now - 20_000 }),
		task({ id: "d", status: "aborted", endedAt: now - 10_000 }),
		task({ id: "e", status: "completed", endedAt: now - 5_000 }),
		task({ id: "f", status: "completed", endedAt: now - 1_000 }),
		task({ id: "g", status: "running" }),
	];
	const shown = cardTasks(tasks, now);
	// a expired; the three newest finished rows survive (f, e, d).
	assert.deepEqual(shown.map((t) => t.id), ["g", "f", "e", "d"]);
});

test("cardMaxRows is a quarter of the terminal, clamped to 3..8", () => {
	assert.equal(cardMaxRows(40), 8);
	assert.equal(cardMaxRows(12), 3);
	assert.equal(cardMaxRows(20), 5);
	assert.equal(cardMaxRows(undefined), 8);
});

test("renderAgentsCard returns no lines when there is nothing to show", () => {
	assert.deepEqual(renderAgentsCard([], { width: 80, now: 0 }, plain), []);
	// A finished row older than the TTL does not resurrect the card.
	assert.deepEqual(
		renderAgentsCard([task({ status: "completed", endedAt: 0 })], { width: 80, now: 61_000 }, plain),
		[],
	);
});

test("renderAgentsCard aligns the metadata columns across rows of different widths", () => {
	const now = 25_000;
	const tasks = [
		task({ id: "a", name: "explore", label: "map footer", tokens: 34_000, cost: 0.27 }),
		task({ id: "b", name: "worker", label: "write shell", status: "completed", tokens: 120_000, cost: 12.5, endedAt: 20_000 }),
	];
	const lines = renderAgentsCard(tasks, { width: 70, now }, plain);
	assert.deepEqual(lines, [
		"╭─ Agents · 1 active · 1 done " + "─".repeat(33) + " 25s ─╮",
		"│ ◐  explore  map footer" + " ".repeat(9) + "gpt/x · low ·  34.0k ·  $0.27 · 25s │",
		"│ ✓  worker   write shell" + " ".repeat(8) + "gpt/x · low · 120.0k · $12.50 · 20s │",
		"╰" + "─".repeat(68) + "╯",
	]);
});

test("renderAgentsCard paints the card through theme roles only", () => {
	const tasks = [task({ id: "a", status: "completed", tokens: 1000, cost: 0.01, endedAt: 9_000 })];
	const lines = renderAgentsCard(tasks, { width: 70, now: 10_000 }, tagged);
	assert.ok(lines[0]!.includes("<accent>Agents · 0 active · 1 done</accent>"));
	assert.ok(lines[0]!.startsWith("<borderAccent>╭"));
	assert.ok(lines[1]!.includes("<success>✓</success>"));
	assert.ok(lines[2]!.startsWith("<borderAccent>╰"));
});

test("a queued row shows only the word queued in the elapsed column", () => {
	const tasks = [task({ id: "a", status: "queued", startedAt: 0 })];
	const lines = renderAgentsCard(tasks, { width: 40, now: 5_000 }, plain);
	assert.deepEqual(lines, [
		"╭─ Agents · 1 active · 0 done " + "─".repeat(4) + " 5s ─╮",
		"│ ◌  probe  hello" + " ".repeat(15) + "queued │",
		"╰" + "─".repeat(38) + "╯",
	]);
});

test("narrow cards drop the task text first, then model·effort, then tokens; cost and elapsed stay", () => {
	const tasks = [
		task({ id: "a", label: "greet", model: "very-long-model-name", effort: "high", tokens: 120_000, cost: 12.5 }),
	];
	// 66 columns: the task text and the model·effort label no longer fit.
	const lines = renderAgentsCard(tasks, { width: 66, now: 25_000 }, plain);
	assert.deepEqual(lines, [
		"╭─ Agents · 1 active · 0 done " + "─".repeat(29) + " 25s ─╮",
		"│ ◐  probe  120.0k · $12.50 · 25s" + " ".repeat(31) + " │",
		"╰" + "─".repeat(64) + "╯",
	]);
	// 34 columns: the header elapsed goes first, then tokens drop; cost and
	// elapsed are the last columns standing.
	const narrower = renderAgentsCard(tasks, { width: 34, now: 25_000 }, plain);
	assert.equal(narrower[0], "╭─ Agents · 1 active · 0 done " + "─".repeat(2) + "╮");
	assert.equal(narrower[1], "│ ◐  probe  $12.50 · 25s" + " ".repeat(8) + " │");
	// 16 columns: only the identity survives.
	const narrowest = renderAgentsCard(tasks, { width: 16, now: 25_000 }, plain);
	assert.equal(narrowest[1], "│ ◐  probe" + " ".repeat(4) + " │");
});

test("the card folds overflow into one `… N more · alt+a to view` row and keeps active work first", () => {
	const now = 10_000;
	const tasks = [
		task({ id: "done1", status: "completed", endedAt: now - 1_000 }),
		task({ id: "done2", status: "completed", endedAt: now - 2_000 }),
		task({ id: "run1", status: "running" }),
		task({ id: "queue1", status: "queued" }),
	];
	// 12 terminal rows → cardMaxRows 3 → one body row, spent on the fold line.
	const lines = renderAgentsCard(tasks, { width: 60, rows: 12, now, viewKey: "alt+a" }, plain);
	assert.deepEqual(lines, [
		"╭─ Agents · 2 active · 2 done " + "─".repeat(23) + " 10s ─╮",
		"│ … 4 more · alt+a to view" + " ".repeat(32) + " │",
		"╰" + "─".repeat(58) + "╯",
	]);
	// 16 rows → 4 card rows → two body rows: the running task and the fold line.
	const two = renderAgentsCard(tasks, { width: 60, rows: 16, now, viewKey: "alt+a" }, plain);
	assert.ok(two[1]!.includes("hello"), two[1]);
	assert.ok(two[2]!.includes("… 3 more · alt+a to view"), two[2]);
});
