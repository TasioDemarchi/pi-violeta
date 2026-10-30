/**
 * Notice texts for background jobs, pure string builders: the exact wording
 * the model receives when a job starts, when monitor lines arrive, when a
 * monitor is stopped by the harness, and when a job exits.
 */

import type { MonitorBatch } from "./lines.ts";
import type { MonitorStopReason } from "./monitors.ts";
import { formatDuration, jobStatusText } from "./view.ts";
import { jobs as t } from "../i18n.ts";
import type { JobRecord } from "./registry.ts";

/** `Trabajo job-1 (build check) iniciado. Salida: /tmp/…/job-1.log` */
export function jobStartText(job: JobRecord): string {
	return t.jobStart(job.id, job.label, job.outputPath);
}

/** `Monitor job-2 (watch) iniciado por hasta 20s. Salida: /tmp/…/job-2.log` */
export function monitorStartText(job: JobRecord): string {
	return t.monitorStart(job.id, job.label, job.timeoutSeconds ?? 0, job.outputPath);
}

/** The exit notice: id, label, outcome, duration, last output lines, and the
 * output file path — everything needed to act without polling. */
export function jobExitNotice(job: JobRecord): string {
	const duration = formatDuration((job.endedAt ?? job.startedAt) - job.startedAt);
	const outcome = job.status === "failed" ? t.couldNotRun(job.error) : jobStatusText(job);
	const lines = [t.jobExitHeader(job.id, job.label, outcome, duration), t.jobExitCommand(job.command)];
	if (job.tail.length > 0) lines.push(t.jobExitLastOutput, ...job.tail);
	else lines.push(t.jobExitNoOutput);
	lines.push(t.jobExitFullOutput(job.outputPath));
	return lines.join("\n");
}

/** One batch of monitor lines: the lines, then the dropped note when the cap
 * swallowed extra lines in the same window. */
export function monitorEventsNotice(job: JobRecord, batch: MonitorBatch): string {
	const lines = [t.monitorReported(job.id, job.label, batch.lines.length), ...batch.lines];
	if (batch.dropped > 0) lines.push(t.linesDropped(batch.dropped));
	return lines.join("\n");
}

/** The final notice for a monitor the harness stopped: it says why. */
export function monitorStoppedNotice(job: JobRecord, reason: MonitorStopReason): string {
	return reason === "timeout"
		? t.monitorStoppedTimeout(job.id, job.label, job.timeoutSeconds ?? 0, job.outputPath)
		: t.monitorStoppedFlood(job.id, job.label, job.outputPath);
}
