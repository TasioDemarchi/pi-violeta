/**
 * Notice texts for background jobs, pure string builders: the exact wording
 * the model receives when a job starts, when monitor lines arrive, when a
 * monitor is stopped by the harness, and when a job exits.
 */

import type { MonitorBatch } from "./lines.ts";
import type { MonitorStopReason } from "./monitors.ts";
import { formatDuration, jobStatusText } from "./view.ts";
import type { JobRecord } from "./registry.ts";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** `Started job job-1 (build check). Output: /tmp/…/job-1.log` */
export function jobStartText(job: JobRecord): string {
	return `Started job ${job.id} (${job.label}). Output: ${job.outputPath}`;
}

/** `Started monitor job-2 (watch) for up to 20s. Output: /tmp/…/job-2.log` */
export function monitorStartText(job: JobRecord): string {
	return `Started monitor ${job.id} (${job.label}) for up to ${job.timeoutSeconds}s. Output: ${job.outputPath}`;
}

/** The exit notice: id, label, outcome, duration, last output lines, and the
 * output file path — everything needed to act without polling. */
export function jobExitNotice(job: JobRecord): string {
	const duration = formatDuration((job.endedAt ?? job.startedAt) - job.startedAt);
	const outcome = job.status === "failed" ? `could not run: ${job.error ?? "unknown error"}` : jobStatusText(job);
	const lines = [`Job ${job.id} (${job.label}) ${outcome} after ${duration}.`, `Command: ${job.command}`];
	if (job.tail.length > 0) lines.push("Last output:", ...job.tail);
	else lines.push("No output.");
	lines.push(`Full output: ${job.outputPath}`);
	return lines.join("\n");
}

/** One batch of monitor lines: the lines, then the dropped note when the cap
 * swallowed extra lines in the same window. */
export function monitorEventsNotice(job: JobRecord, batch: MonitorBatch): string {
	const lines = [`Monitor ${job.id} (${job.label}) reported ${plural(batch.lines.length, "new line")}:`, ...batch.lines];
	if (batch.dropped > 0) lines.push(`(+${batch.dropped} lines dropped)`);
	return lines.join("\n");
}

/** The final notice for a monitor the harness stopped: it says why. */
export function monitorStoppedNotice(job: JobRecord, reason: MonitorStopReason): string {
	const why = reason === "timeout"
		? `it reached its ${job.timeoutSeconds}s timeout`
		: "it printed more than 120 lines within 60 seconds";
	return `Monitor ${job.id} (${job.label}) was stopped: ${why}. Full output: ${job.outputPath}`;
}
