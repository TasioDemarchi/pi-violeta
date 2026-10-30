/**
 * Monitor controller — wires a monitor's per-line events to the batcher from
 * `lines.ts` and auto-stops on timeout or flood. No timers of its own: the
 * clock and the scheduler are injected, so tests run the 200 ms window, the
 * flood rule and the timeout with a fake clock. Notices leave through one
 * `deliver` callback; the caller decides how they reach the model.
 */

import { MONITOR_BATCH_MS, MONITOR_MAX_TIMEOUT_SECONDS, createEventBatcher, type MonitorBatch } from "./lines.ts";
import type { JobRecord, JobRegistry } from "./registry.ts";

export type MonitorStopReason = "timeout" | "flood";

export type MonitorNotice =
	| { kind: "events"; job: JobRecord; batch: MonitorBatch }
	| { kind: "stopped"; job: JobRecord; reason: MonitorStopReason };

export interface MonitorDeps {
	registry: Pick<JobRegistry, "start" | "stop" | "get">;
	schedule: (fn: () => void, ms: number) => () => void;
	now: () => number;
	/** Hands one notice to the delivery layer. */
	deliver: (notice: MonitorNotice) => void;
}

export interface MonitorStartRequest {
	command: string;
	cwd: string;
	label?: string;
	/** Mandatory: the monitor is stopped after this many seconds (1-1800). */
	timeoutSeconds: number;
}

/** Mandatory timeout: a clear error for anything but a whole 1-1800 number. */
export function validateTimeoutSeconds(value: unknown): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MONITOR_MAX_TIMEOUT_SECONDS) {
		throw new Error(`timeout_seconds is required and must be a whole number from 1 to ${MONITOR_MAX_TIMEOUT_SECONDS}.`);
	}
	return value;
}

interface MonitorState {
	batcher: ReturnType<typeof createEventBatcher>;
	cancelFlush?: () => void;
	cancelTimeout: () => void;
}

export function createMonitorController(deps: MonitorDeps) {
	const active = new Map<string, MonitorState>();

	const flush = (job: JobRecord): void => {
		const state = active.get(job.id);
		if (!state) return;
		state.cancelFlush?.();
		state.cancelFlush = undefined;
		const batch = state.batcher.flush();
		if (batch) deps.deliver({ kind: "events", job, batch });
	};

	const forget = (id: string): void => {
		const state = active.get(id);
		if (!state) return;
		state.cancelFlush?.();
		state.cancelTimeout();
		active.delete(id);
	};

	/** Harness stop (timeout or flood): flush, disarm, kill, and say why. */
	const stopFor = (job: JobRecord, reason: MonitorStopReason): void => {
		if (job.status !== "running") return;
		flush(job);
		forget(job.id);
		deps.registry.stop(job.id);
		deps.deliver({ kind: "stopped", job, reason });
	};

	return {
		start(request: MonitorStartRequest): JobRecord {
			const timeoutSeconds = validateTimeoutSeconds(request.timeoutSeconds);
			const { timeoutSeconds: _validated, ...rest } = request;
			const batcher = createEventBatcher();
			let job: JobRecord | undefined;
			const onLine = (line: string): void => {
				const state = job && active.get(job.id);
				// A stopped or finished monitor reports nothing more.
				if (!job || !state || job.status !== "running") return;
				const { opensBatch, flood } = batcher.pushLine(line, deps.now());
				job.events = batcher.total();
				if (flood) {
					stopFor(job, "flood");
					return;
				}
				if (opensBatch) state.cancelFlush = deps.schedule(() => flush(job!), MONITOR_BATCH_MS);
			};
			job = deps.registry.start({ ...rest, kind: "monitor", onLine });
			job.events = 0;
			job.timeoutSeconds = timeoutSeconds;
			const started = job;
			active.set(started.id, { batcher, cancelTimeout: deps.schedule(() => stopFor(started, "timeout"), timeoutSeconds * 1000) });
			return started;
		},
		/** The process exited on its own: deliver pending lines before the exit notice. */
		finish(job: JobRecord): void {
			if (!active.has(job.id)) return;
			flush(job);
			forget(job.id);
		},
		/** Manual stop (job_stop): drop timers and pending lines; the caller stops the job itself. */
		cancel(id: string): void {
			forget(id);
		},
		cancelAll(): void {
			for (const id of [...active.keys()]) forget(id);
		},
	};
}
