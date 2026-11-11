import { test } from "node:test";
import assert from "node:assert/strict";
import {
	formatDuration,
	indicatorLine,
	initialOverlayState,
	listLine,
	orderedJobs,
	reduceOverlay,
	renderJobOverlay,
} from "../src/jobs/view.ts";
import type { JobRecord } from "../src/jobs/registry.ts";

const fg = (_role: string, text: string) => text;

function job(id: string, overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id,
		kind: "job",
		label: `label ${id}`,
		command: "sleep 4",
		cwd: "/repo",
		outputPath: `/tmp/x/${id}.log`,
		startedAt: Number(id.replace(/\D/g, "")) * 100,
		status: "running",
		tail: [],
		...overrides,
	};
}

test("orderedJobs: running first (newest first), then finished (newest ended first)", () => {
	const jobs = [
		job("job-1", { startedAt: 100, status: "exited", exitCode: 0, endedAt: 400 }),
		job("job-2", { startedAt: 300 }),
		job("job-3", { startedAt: 200 }),
		job("job-4", { startedAt: 50, status: "exited", exitCode: 0, endedAt: 500 }),
	];
	assert.deepEqual(
		orderedJobs(jobs).map((job) => job.id),
		["job-2", "job-3", "job-4", "job-1"],
	);
});

test("indicatorLine: one line while anything runs, empty otherwise", () => {
	assert.equal(indicatorLine([]), "");
	assert.equal(indicatorLine([job("job-1", { status: "exited", exitCode: 0, endedAt: 1 })]), "");
	assert.equal(indicatorLine([job("job-1"), job("job-2"), job("job-3", { status: "exited", exitCode: 0, endedAt: 1 })]), "jobs: 2 running");
});

test("formatDuration matches the list and notices format", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(4_000), "4s");
	assert.equal(formatDuration(84_000), "1m 24s");
	assert.equal(formatDuration(3_720_000), "1h 2m");
});

test("listLine is one compact line per job", () => {
	assert.equal(listLine(job("job-1"), 10_000), "job-1 · job · label job-1 · running · 10s");
});

test("reduceOverlay: j/k moves the selection through the ordered list", () => {
	// Ordered newest first: job-2 (started 200) before job-1 (started 100).
	const jobs = [job("job-1"), job("job-2")];
	let state = initialOverlayState(jobs);
	assert.equal(state.selectedId, "job-2");
	state = reduceOverlay(state, "down", jobs).state;
	assert.equal(state.selectedId, "job-1");
	state = reduceOverlay(state, "down", jobs).state;
	assert.equal(state.selectedId, "job-1", "clamps at the end");
	state = reduceOverlay(state, "up", jobs).state;
	assert.equal(state.selectedId, "job-2");
	state = reduceOverlay(state, "up", jobs).state;
	assert.equal(state.selectedId, "job-2", "clamps at the start");
});

test("reduceOverlay: s arms a confirm, a second s stops the running job", () => {
	const jobs = [job("job-1")];
	let state = initialOverlayState(jobs);
	const armed = reduceOverlay(state, "stop", jobs);
	assert.equal(armed.stop, undefined);
	assert.equal(armed.state.confirmId, "job-1");
	const confirmed = reduceOverlay(armed.state, "stop", jobs);
	assert.equal(confirmed.stop, "job-1");
	assert.equal(confirmed.state.confirmId, undefined);
	// Moving the selection disarms the confirm.
	state = initialOverlayState(jobs);
	const moved = reduceOverlay(reduceOverlay(state, "stop", jobs).state, "down", jobs);
	assert.equal(moved.state.confirmId, undefined);
});

test("reduceOverlay: s on a finished job does nothing and close closes", () => {
	const jobs = [job("job-1", { status: "exited", exitCode: 0, endedAt: 1 })];
	const state = initialOverlayState(jobs);
	const finished = reduceOverlay(state, "stop", jobs);
	assert.equal(finished.stop, undefined);
	assert.equal(finished.state.confirmId, undefined);
	assert.equal(reduceOverlay(state, "close", jobs).state.closed, true);
});

test("renderJobOverlay: header, rows, confirm row and hint", () => {
	const jobs = [
		job("job-1"),
		job("job-2", { kind: "monitor", status: "exited", exitCode: 0, endedAt: 1_200 }),
	];
	const state = initialOverlayState(jobs);
	const lines = renderJobOverlay(jobs, state, { width: 80, rows: 10 }, 1_100, fg);
	assert.equal(lines[0], "Jobs · 1 running · 1 finished");
	assert.match(lines[1], /› .*job-1/);
	assert.match(lines[1], /label job-1/);
	assert.match(lines[2], /job-2/);
	const confirming = renderJobOverlay(jobs, { ...state, confirmId: "job-1" }, { width: 80, rows: 10 }, 1_100, fg);
	assert.ok(confirming.some((line) => /s again to stop job-1/.test(line)), confirming.join("\n"));
	assert.equal(lines.at(-1), "j/k select  s stop  q close");
});

test("renderJobOverlay: empty state and narrow width clip gracefully", () => {
	const lines = renderJobOverlay([], initialOverlayState([]), { width: 80, rows: 10 }, 0, fg);
	assert.equal(lines[0], "Jobs · 0 running");
	assert.match(lines[1]!, /No jobs./);
	const narrow = renderJobOverlay([job("job-1")], initialOverlayState([job("job-1")]), { width: 20, rows: 10 }, 0, fg);
	for (const line of narrow) {
		const visible = line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
		assert.ok(visible.length <= 20, `"${visible}" is wider than 20`);
	}
});
