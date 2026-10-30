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

test("jobStatusText: en ejecución, salió con código, terminado por señal, detenido, falló", () => {
	assert.equal(jobStatusText(job({ status: "running" })), "en ejecución");
	assert.equal(jobStatusText(job()), "salió con código 0");
	assert.equal(jobStatusText(job({ exitCode: 3 })), "salió con código 3");
	assert.equal(jobStatusText(job({ exitCode: null, signal: "SIGTERM" })), "terminado por la señal SIGTERM");
	assert.equal(jobStatusText(job({ status: "stopped" })), "detenido");
	assert.equal(jobStatusText(job({ status: "failed", error: "spawn bash ENOENT" })), "falló: spawn bash ENOENT");
});

test("listLine shows id, kind, label, status, elapsed and exit code", () => {
	assert.equal(listLine(job(), 6_000), "job-1 · job · build check · salió con código 0 · 4s");
	assert.equal(
		listLine(job({ id: "job-2", kind: "monitor", label: "watch log", status: "running", endedAt: undefined, exitCode: undefined }), 13_000),
		"job-2 · monitor · watch log · en ejecución · 12s",
	);
	assert.equal(
		listLine(job({ id: "job-3", exitCode: null, signal: "SIGKILL" }), 6_000),
		"job-3 · job · build check · terminado por la señal SIGKILL · 4s",
	);
	assert.equal(
		listLine(job({ id: "job-4", status: "failed", error: "could not spawn", endedAt: 1_000, exitCode: undefined, signal: undefined }), 6_000),
		"job-4 · job · build check · falló: could not spawn · 0s",
	);
});

test("jobStartText and monitorStartText are exact", () => {
	assert.equal(
		jobStartText(job()),
		"Trabajo job-1 (build check) iniciado. Salida: /tmp/violeta-jobs-123/job-1.log",
	);
	assert.equal(
		monitorStartText(job({ id: "job-2", kind: "monitor", timeoutSeconds: 20 })),
		"Monitor job-2 (build check) iniciado por hasta 20s. Salida: /tmp/violeta-jobs-123/job-1.log",
	);
});

test("jobExitNotice carries id, label, exit code, duration, last lines and the output path", () => {
	assert.equal(
		jobExitNotice(job()),
		[
			"El trabajo job-1 (build check) salió con código 0 después de 4s.",
			"Comando: sleep 4; echo done-marker",
			"Última salida:",
			"done-marker",
			"Salida completa: /tmp/violeta-jobs-123/job-1.log",
		].join("\n"),
	);
});

test("jobExitNotice covers signal exits, failures and empty output", () => {
	assert.match(
		jobExitNotice(job({ exitCode: null, signal: "SIGTERM", tail: [] })),
		/^El trabajo job-1 \(build check\) terminado por la señal SIGTERM después de 4s\.\nComando: sleep 4; echo done-marker\nSin salida\.\nSalida completa: /,
	);
	assert.match(
		jobExitNotice(job({ status: "failed", error: "spawn bash ENOENT", exitCode: undefined, signal: undefined, endedAt: 1_000 })),
		/^El trabajo job-1 \(build check\) no pudo ejecutarse: spawn bash ENOENT después de 0s\./,
	);
});

test("monitorEventsNotice lists the lines and the dropped note", () => {
	const batch = { lines: ["one", "two"], dropped: 3 };
	assert.equal(
		monitorEventsNotice(job({ id: "job-2", kind: "monitor" }), batch),
		["El monitor job-2 (build check) reportó 2 líneas nuevas:", "one", "two", "(+3 líneas descartadas)"].join("\n"),
	);
	assert.equal(
		monitorEventsNotice(job({ id: "job-2", kind: "monitor" }), { lines: ["one"], dropped: 0 }),
		["El monitor job-2 (build check) reportó 1 línea nueva:", "one"].join("\n"),
	);
});

test("monitorStoppedNotice says why", () => {
	assert.equal(
		monitorStoppedNotice(job({ id: "job-2", kind: "monitor", timeoutSeconds: 20 }), "timeout"),
		"El monitor job-2 (build check) fue detenido: alcanzó su timeout de 20s. Salida completa: /tmp/violeta-jobs-123/job-1.log",
	);
	assert.equal(
		monitorStoppedNotice(job({ id: "job-2", kind: "monitor" }), "flood"),
		"El monitor job-2 (build check) fue detenido: imprimió más de 120 líneas en 60 segundos. Salida completa: /tmp/violeta-jobs-123/job-1.log",
	);
});
