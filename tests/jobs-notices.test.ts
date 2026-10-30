import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration, jobStatusText, listLine } from "../src/jobs/view.ts";
import { jobExitNotice, jobStartText, monitorEventsNotice, monitorStartText, monitorStoppedNotice } from "../src/jobs/notices.ts";
import type { JobRecord } from "../src/jobs/registry.ts";

function job(overrides: Partial<JobRecord> = {}): JobRecord {
	return {
		id: "job-1",
		kind: "job",
		label: "build check",
		command: "sleep 4; echo done-marker",
		cwd: "/repo",
		outputPath: "/tmp/violeta-jobs-123/job-1.log",
		startedAt: 1_000,
		status: "exited",
		exitCode: 0,
		signal: null,
		endedAt: 5_000,
		tail: ["done-marker"],
		...overrides,
	};
}

test("formatDuration is compact", () => {
	assert.equal(formatDuration(0), "0s");
	assert.equal(formatDuration(4_000), "4s");
	assert.equal(formatDuration(84_000), "1m 24s");
	assert.equal(formatDuration(3_720_000), "1h 2m");
});

test("jobStatusText: running, exited with code, killed by signal, stopped, failed", () => {
	assert.equal(jobStatusText(job({ status: "running" })), "running");
	assert.equal(jobStatusText(job()), "exited with code 0");
	assert.equal(jobStatusText(job({ exitCode: 3 })), "exited with code 3");
	assert.equal(jobStatusText(job({ exitCode: null, signal: "SIGTERM" })), "killed by signal SIGTERM");
	assert.equal(jobStatusText(job({ status: "stopped" })), "stopped");
	assert.equal(jobStatusText(job({ status: "failed", error: "spawn bash ENOENT" })), "failed: spawn bash ENOENT");
});

test("listLine shows id, kind, label, status, elapsed and exit code", () => {
	assert.equal(listLine(job(), 6_000), "job-1 · job · build check · exited with code 0 · 4s");
	assert.equal(
		listLine(job({ id: "job-2", kind: "monitor", label: "watch log", status: "running", endedAt: undefined, exitCode: undefined }), 13_000),
		"job-2 · monitor · watch log · running · 12s",
	);
	assert.equal(
		listLine(job({ id: "job-3", exitCode: null, signal: "SIGKILL" }), 6_000),
		"job-3 · job · build check · killed by signal SIGKILL · 4s",
	);
	assert.equal(
		listLine(job({ id: "job-4", status: "failed", error: "could not spawn", endedAt: 1_000, exitCode: undefined, signal: undefined }), 6_000),
		"job-4 · job · build check · failed: could not spawn · 0s",
	);
});

test("jobStartText and monitorStartText are exact", () => {
	assert.equal(
		jobStartText(job()),
		"Started job job-1 (build check). Output: /tmp/violeta-jobs-123/job-1.log",
	);
	assert.equal(
		monitorStartText(job({ id: "job-2", kind: "monitor", timeoutSeconds: 20 })),
		"Started monitor job-2 (build check) for up to 20s. Output: /tmp/violeta-jobs-123/job-1.log",
	);
});

test("jobExitNotice carries id, label, exit code, duration, last lines and the output path", () => {
	assert.equal(
		jobExitNotice(job()),
		[
			"Job job-1 (build check) exited with code 0 after 4s.",
			"Command: sleep 4; echo done-marker",
			"Last output:",
			"done-marker",
			"Full output: /tmp/violeta-jobs-123/job-1.log",
		].join("\n"),
	);
});

test("jobExitNotice covers signal exits, failures and empty output", () => {
	assert.match(
		jobExitNotice(job({ exitCode: null, signal: "SIGTERM", tail: [] })),
		/^Job job-1 \(build check\) killed by signal SIGTERM after 4s\.\nCommand: sleep 4; echo done-marker\nNo output\.\nFull output: /,
	);
	assert.match(
		jobExitNotice(job({ status: "failed", error: "spawn bash ENOENT", exitCode: undefined, signal: undefined, endedAt: 1_000 })),
		/^Job job-1 \(build check\) could not run: spawn bash ENOENT after 0s\./,
	);
});

test("monitorEventsNotice lists the lines and the dropped note", () => {
	const batch = { lines: ["one", "two"], dropped: 3 };
	assert.equal(
		monitorEventsNotice(job({ id: "job-2", kind: "monitor" }), batch),
		["Monitor job-2 (build check) reported 2 new lines:", "one", "two", "(+3 lines dropped)"].join("\n"),
	);
	assert.equal(
		monitorEventsNotice(job({ id: "job-2", kind: "monitor" }), { lines: ["one"], dropped: 0 }),
		["Monitor job-2 (build check) reported 1 new line:", "one"].join("\n"),
	);
});

test("monitorStoppedNotice says why", () => {
	assert.equal(
		monitorStoppedNotice(job({ id: "job-2", kind: "monitor", timeoutSeconds: 20 }), "timeout"),
		"Monitor job-2 (build check) was stopped: it reached its 20s timeout. Full output: /tmp/violeta-jobs-123/job-1.log",
	);
	assert.equal(
		monitorStoppedNotice(job({ id: "job-2", kind: "monitor" }), "flood"),
		"Monitor job-2 (build check) was stopped: it printed more than 120 lines within 60 seconds. Full output: /tmp/violeta-jobs-123/job-1.log",
	);
});
