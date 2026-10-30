/**
 * Background job registry — the job table for `bash_background` and `monitor`.
 *
 * A job runs `bash -c <command>` detached (its own process group) in the
 * session cwd; stdout and stderr stream to one 0600 log file under a
 * per-process temp directory, and the last lines are kept in memory for
 * notices and listings. The registry reports each job's own exit exactly once
 * through `onSettled`; a stopped job reports nothing (whoever stopped it
 * already knows). Monitors add per-line callbacks; the batching lives in
 * `monitors.ts`. Everything injectable (clock, scheduler, spawn) is an
 * option, so tests run real short commands with a tight timeout.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, closeSync, createWriteStream, existsSync, mkdirSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { killTree, killTreeEscalating, type ScheduleFn } from "./kill.ts";
import { createTail, MAX_LINE_CHARS, TAIL_LINES } from "./lines.ts";

export type JobStatus = "running" | "exited" | "failed" | "stopped";
export type JobKind = "job" | "monitor";

export interface JobRecord {
	readonly id: string;
	readonly kind: JobKind;
	readonly label: string;
	readonly command: string;
	readonly cwd: string;
	readonly outputPath: string;
	pid?: number;
	readonly startedAt: number;
	status: JobStatus;
	/** null when killed by a signal; undefined while running or on spawn failure. */
	exitCode?: number | null;
	signal?: string | null;
	error?: string;
	endedAt?: number;
	/** Last output lines, refreshed until the job ends. */
	tail: string[];
	/** Monitor only: event lines delivered so far. */
	events?: number;
	/** Monitor only: the mandatory timeout it was started with. */
	timeoutSeconds?: number;
}

export interface StartRequest {
	command: string;
	cwd: string;
	label?: string;
	kind?: JobKind;
	/** Called with each complete output line, and the last partial one at exit. */
	onLine?: (line: string) => void;
}

export interface JobRegistryOptions {
	now?: () => number;
	schedule?: ScheduleFn;
	spawn?: typeof spawn;
	/** Log directory; defaults to `<tmpdir>/violeta-jobs-<pid>/`. */
	dir?: string;
	/** Running jobs allowed at once (default 25). */
	maxRunning?: number;
	/** Finished records kept in memory (default 100). */
	finishedCap?: number;
	/** SIGTERM → SIGKILL grace on stop (default 3000). */
	graceMs?: number;
	/** Called once when a job ends on its own; never for a stop. */
	onSettled?: (job: JobRecord) => void;
}

export const MAX_RUNNING_JOBS = 25;
export const FINISHED_CAP = 100;
export const JOB_KILL_GRACE_MS = 3000;

/** Short display label: the explicit label, else the command's head. */
function shortLabel(label: string | undefined, command: string): string {
	const text = (label?.trim() || command).replace(/\s+/g, " ").trim();
	return text.length <= 60 ? text : `${text.slice(0, 59)}…`;
}

export class JobRegistry {
	private readonly options: Required<Omit<JobRegistryOptions, "dir" | "onSettled" | "spawn">> & Pick<JobRegistryOptions, "dir" | "onSettled" | "spawn">;
	private readonly jobs = new Map<string, JobRecord>();
	private readonly listeners = new Set<() => void>();
	private readonly escalations = new Map<string, () => void>();
	private counter = 0;

	constructor(options: JobRegistryOptions = {}) {
		this.options = {
			now: options.now ?? (() => Date.now()),
			schedule: options.schedule ?? ((fn, ms) => {
				const timer = setTimeout(fn, ms);
				timer.unref?.();
				return () => clearTimeout(timer);
			}),
			spawn: options.spawn ?? ((command, args, opts) => spawn(command, args, opts)),
			dir: options.dir,
			maxRunning: options.maxRunning && options.maxRunning >= 1 ? options.maxRunning : MAX_RUNNING_JOBS,
			finishedCap: options.finishedCap && options.finishedCap >= 1 ? options.finishedCap : FINISHED_CAP,
			graceMs: options.graceMs ?? JOB_KILL_GRACE_MS,
			onSettled: options.onSettled,
		};
	}

	private dir(): string {
		return this.options.dir ?? join(tmpdir(), `violeta-jobs-${process.pid}`);
	}

	private ensureDir(): void {
		const dir = this.dir();
		if (existsSync(dir)) return;
		mkdirSync(dir, { recursive: true, mode: 0o700 });
		try {
			chmodSync(dir, 0o700);
		} catch {
			// best effort: the files carry their own 0600 mode
		}
	}

	/** Start one job. Throws a clear error when the running cap is reached. */
	start(request: StartRequest): JobRecord {
		if (this.runningCount() >= this.options.maxRunning) {
			throw new Error(`At most ${this.options.maxRunning} jobs can run at once; stop one with job_stop first.`);
		}
		this.ensureDir();
		const id = `job-${++this.counter}`;
		const job: JobRecord = {
			id,
			kind: request.kind ?? "job",
			label: shortLabel(request.label, request.command),
			command: request.command,
			cwd: request.cwd,
			outputPath: join(this.dir(), `${id}.log`),
			startedAt: this.options.now(),
			status: "running",
			tail: [],
		};
		this.jobs.set(id, job);
		const tail = createTail(TAIL_LINES);
		// Streaming decode keeps a multibyte character split across chunks intact.
		const decoder = new TextDecoder("utf-8");
		let linePartial = "";
		const emitLines = (text: string, end: boolean): void => {
			if (!request.onLine || job.status !== "running") return;
			const parts = (linePartial + text).split("\n");
			linePartial = end ? "" : parts.pop() ?? "";
			for (const part of parts) {
				const line = part.length > MAX_LINE_CHARS ? `…${part.slice(-MAX_LINE_CHARS)}` : part;
				request.onLine(line);
			}
		};
		const ingest = (data: Buffer, end = false): void => {
			output.write(data);
			const text = end ? decoder.decode() : decoder.decode(data, { stream: true });
			if (text === "") return;
			tail.push(text);
			job.tail = tail.lines();
			emitLines(text, end);
		};
		let output: import("node:stream").Writable;
		try {
			// 0600 regardless of umask: open, then chmod, then wrap in a stream.
			closeSync(openSync(job.outputPath, "a", 0o600));
			chmodSync(job.outputPath, 0o600);
			output = createWriteStream(job.outputPath, { flags: "a", mode: 0o600 });
			output.on("error", () => {
				// a lost log must not crash the session; the tail survives
			});
		} catch (error) {
			this.finish(job, "failed", { error: `could not open the output file: ${error instanceof Error ? error.message : String(error)}` });
			return job;
		}
		try {
			const child = this.options.spawn("bash", ["-c", request.command], {
				cwd: request.cwd,
				detached: process.platform !== "win32",
				windowsHide: true,
				stdio: ["ignore", "pipe", "pipe"],
			});
			job.pid = child.pid;
			child.stdout?.on("data", (data: Buffer) => ingest(data));
			child.stderr?.on("data", (data: Buffer) => ingest(data));
			child.on("error", (error) => {
				output.end();
				this.finish(job, "failed", { error: error.message });
			});
			child.on("exit", (_code, _signal) => {
				ingest(Buffer.alloc(0), true);
				output.end();
				if (job.status !== "running") {
					this.clearEscalation(id);
					this.notify();
					return; // stopped: no exit notice, whoever stopped it already knows
				}
				this.finish(job, "exited", { exitCode: _code, signal: _signal });
			});
		} catch (error) {
			output.end();
			this.finish(job, "failed", { error: `could not start bash: ${error instanceof Error ? error.message : String(error)}` });
			return job;
		}
		this.notify();
		return job;
	}

	/** Stop a job and kill its whole process tree (SIGTERM, SIGKILL after the
	 * grace). Unknown ids return undefined; finished jobs are returned as-is. */
	stop(id: string): JobRecord | undefined {
		const job = this.jobs.get(id);
		if (!job || job.status !== "running") return job;
		job.status = "stopped";
		job.endedAt = this.options.now();
		this.clearEscalation(id);
		if (job.pid) {
			const cancel = killTreeEscalating(job.pid, this.options.schedule, this.options.graceMs);
			this.escalations.set(id, cancel);
		}
		this.notify();
		return job;
	}

	get(id: string): JobRecord | undefined {
		return this.jobs.get(id);
	}

	/** All jobs in start order; the views sort. */
	list(): JobRecord[] {
		return [...this.jobs.values()];
	}

	runningCount(): number {
		let count = 0;
		for (const job of this.jobs.values()) if (job.status === "running") count++;
		return count;
	}

	/** Stop every running job: "graceful" SIGTERMs first, "force" SIGKILLs at
	 * once (session shutdown and process exit cannot wait). */
	killAll(mode: "graceful" | "force" = "graceful"): number {
		let stopped = 0;
		for (const job of this.jobs.values()) {
			if (job.status !== "running") continue;
			job.status = "stopped";
			job.endedAt = this.options.now();
			if (job.pid) killTree(job.pid, mode === "force" ? "SIGKILL" : "SIGTERM");
			stopped++;
		}
		if (stopped > 0) this.notify();
		return stopped;
	}

	/** Force-stop everything and remove the temp directory (tests, shutdown). */
	dispose(): void {
		this.killAll("force");
		try {
			rmSync(this.dir(), { recursive: true, force: true });
		} catch {
			// best effort: temp files are harmless leftovers
		}
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private clearEscalation(id: string): void {
		const cancel = this.escalations.get(id);
		if (cancel) {
			cancel();
			this.escalations.delete(id);
		}
	}

	private finish(job: JobRecord, status: "exited" | "failed", patch: Partial<JobRecord>): void {
		Object.assign(job, patch, { status, endedAt: this.options.now() });
		this.clearEscalation(job.id);
		this.pruneFinished();
		this.notify();
		this.options.onSettled?.(job);
	}

	/** Keep at most `finishedCap` finished records; drop the oldest started. */
	private pruneFinished(): void {
		let finished = [...this.jobs.values()].filter((job) => job.status !== "running");
		while (finished.length > this.options.finishedCap) {
			const oldest = finished.shift();
			if (!oldest) break;
			this.jobs.delete(oldest.id);
			finished = finished.filter((job) => job.id !== oldest.id);
		}
	}

	private notify(): void {
		for (const listener of [...this.listeners]) {
			try {
				listener();
			} catch {
				// a broken view must never break the engine
			}
		}
	}
}
