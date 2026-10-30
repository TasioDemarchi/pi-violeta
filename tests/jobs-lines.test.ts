import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MAX_LINE_CHARS,
	MONITOR_BATCH_MS,
	MONITOR_FLOOD_LINES,
	MONITOR_FLOOD_WINDOW_MS,
	MONITOR_LINES_PER_NOTICE,
	MONITOR_MAX_TIMEOUT_SECONDS,
	createEventBatcher,
	createTail,
} from "../src/jobs/lines.ts";

test("createTail keeps the last maxLines lines and marks cut long lines", () => {
	const tail = createTail(3);
	tail.push("a\nb\nc\n");
	assert.deepEqual(tail.lines(), ["a", "b", "c"]);
	tail.push("d\ne\n");
	assert.deepEqual(tail.lines(), ["c", "d", "e"]);
	// One endless line keeps only its newest characters, after an ellipsis.
	const long = "x".repeat(MAX_LINE_CHARS + 50);
	tail.push(long);
	assert.equal(tail.lines().at(-1), `…${"x".repeat(MAX_LINE_CHARS)}`);
});

test("createTail keeps an unterminated partial line visible", () => {
	const tail = createTail(5);
	tail.push("full\npar");
	assert.deepEqual(tail.lines(), ["full", "par"]);
	tail.push("tial\n");
	assert.deepEqual(tail.lines(), ["full", "partial"]);
});

test("pushLine batches lines that arrive within the window and reports the first opener", () => {
	const batcher = createEventBatcher();
	assert.equal(MONITOR_BATCH_MS, 200);
	assert.equal(batcher.pushLine("a", 0).opensBatch, true);
	assert.equal(batcher.pushLine("b", 199).opensBatch, false);
	// Blank lines are data noise: never batched, never counted.
	assert.deepEqual(batcher.pushLine("   ", 199), { opensBatch: false, flood: false });
	const batch = batcher.flush();
	assert.deepEqual(batch, { lines: ["a", "b"], dropped: 0 });
	assert.equal(batcher.flush(), undefined, "flush consumes the batch");
	// A new batch opens after a flush even without a window gap.
	assert.equal(batcher.pushLine("c", 200).opensBatch, true);
	assert.deepEqual(batcher.flush(), { lines: ["c"], dropped: 0 });
});

test("a batch holds at most 20 lines; the rest are counted as dropped", () => {
	assert.equal(MONITOR_LINES_PER_NOTICE, 20);
	const batcher = createEventBatcher();
	for (let i = 0; i < 25; i++) batcher.pushLine(`line${i + 1}`, 0);
	assert.deepEqual(batcher.flush(), {
		lines: Array.from({ length: 20 }, (_, i) => `line${i + 1}`),
		dropped: 5,
	});
});

test("more than 120 lines within 60 seconds is a flood; the window slides", () => {
	assert.equal(MONITOR_FLOOD_LINES, 120);
	assert.equal(MONITOR_FLOOD_WINDOW_MS, 60_000);
	assert.equal(MONITOR_MAX_TIMEOUT_SECONDS, 1800);
	const batcher = createEventBatcher();
	for (let i = 0; i < 120; i++) {
		assert.equal(batcher.pushLine(`l${i}`, 0).flood, false, `line ${i + 1} is not a flood yet`);
	}
	assert.equal(batcher.pushLine("l121", 0).flood, true);
	// 60 seconds after the burst the window has slid: a fresh line is fine.
	assert.equal(batcher.pushLine("later", MONITOR_FLOOD_WINDOW_MS).flood, false);
});

test("lines spread past the 60s window never flood", () => {
	const batcher = createEventBatcher();
	for (let i = 0; i < 130; i++) {
		assert.equal(batcher.pushLine(`l${i}`, i * 1000).flood, false);
	}
});
