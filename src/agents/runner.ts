/** Subagent runner: every task is its own child `pi --mode rpc` process fed
 * JSONL commands on stdin and reduced into the store from stdout events.
 * Neutral engine: no roles, no philosophy — definitions come from
 * markdown files and every task is only what the caller asked for.
 *
 * Behavior:
 * - At most `maxConcurrency` (default 3) children run at once; extra tasks stay
 *   "queued" and launch FIFO when a slot frees.
 * - Completion is the child's `agent_settled` event (never `agent_end`).
 * - A stall watchdog fails a child silent for `stallTimeoutMs` (default 4 min);
 *   an announced tool call in flight raises the budget to `toolStallTimeoutMs`
 *   (default 10 min). These are renewable silence budgets, not total limits.
 * - A wrap-up notice (a `steer` message) is sent once, when a run reaches 75% of
 *   its turn or token ceiling, so the report is written BEFORE the cut. Some
 *   models never stop working on their own and the handoff is only the last
 *   thing said; a run cut with no report wastes everything it did.
 * - `maxTurns`/`maxTokens` ARE total limits: a child that reaches one is torn
 *   down with status "budget", keeping its last answer as the handoff. A silence
 *   budget asks "is it alive?"; a ceiling asks "has it had enough?". A talkative
 *   child renews the first forever and still stops at the second.
 * - Cancel sends SIGTERM, then SIGKILL after a short grace. `killAll()` (used
 *   on session shutdown and process exit) SIGKILLs immediately.
 * - The child's own UI dialog requests are answered with a cancellation so a
 *   headless child never hangs waiting for nobody.
 * - Finished tasks persist as one JSON file each under
 *   `<agentDir>/agents-history/` (capped; corrupt entries are skipped on read).
 */

import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReducer, type Reducer } from "./reduce.ts";
import { saveTaskToHistory } from "./history.ts";
import { extractSummary, firstLine, taskTitle } from "./summary.ts";
import { isFinished, type AgentStore, type AgentTask, type BudgetLimit } from "./store.ts";

const HISTORY_SUBDIR = "agents-history";

export type SpawnFn = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached: boolean; windowsHide: boolean; stdio: string[] }) => ChildProcess;

/** The runner only needs these definition fields; a full AgentDefinition fits. */
export interface DefinitionSpec {
	name: string;
	model: string;
	thinking?: string;
	tools: string[];
	maxTurns?: number;
	maxTokens?: number;
	prompt: string;
}

export interface RunnerOptions {
	/** Agent dir; when set, finished tasks persist under `<agentDir>/agents-history/`. */
	agentDir?: string;
	/** Session that owns the tasks this runner starts (history is scoped by it). */
	sessionId?: string;
	/** Working directory for the child. */
	cwd: string;
	maxConcurrency?: number;
	/** Turn ceiling applied to every task, overriding the definition. Exists so a
	 * ceiling can be retuned from the environment without editing agent files. */
	maxTurns?: number;
	/** Token ceiling applied to every task, overriding the definition. */
	maxTokens?: number;
	stallTimeoutMs?: number;
	toolStallTimeoutMs?: number;
	/** Grace between SIGTERM and SIGKILL on cancel. */
	graceMs?: number;
	/** CLI entry to run; defaults to the pi bundle in this package's node_modules. */
	cliPath?: string;
	spawn?: SpawnFn;
	now?: () => number;
	schedule?: (fn: () => void, ms: number) => () => void;
	env?: NodeJS.ProcessEnv;
	/** Called once when a task reaches a terminal status. `mode` is the start
	 * mode of the task ("task" waits in the tool; "background" returns early). */
	onSettled?: (task: AgentTask, mode: "task" | "background") => void;
}

export interface StartParams {
	task: string;
	label?: string;
	context?: string;
	mode: "task" | "background";
}

interface TaskMeta {
	mode: "task" | "background";
	prompt: string;
}

interface LiveTask {
	child: ChildProcess;
	reducer: Reducer;
	cancelStall: () => void;
	escalation: (() => void) | undefined;
	terminal: boolean;
	/** The ceiling this run has already reached, acted on when it tries to do
	 * more. Settlement arriving first means the work finished on budget. */
	overBudget: BudgetLimit | undefined;
	/** How far the wrap-up has gone: the warning, then the order. Each stage
	 * goes out at most once per run. */
	wrapUpStage: "none" | "warned" | "ordered";
	promptDir: string | undefined;
	stderrTail: string;
	responseWaiters: Map<string, (response: { success?: boolean; error?: unknown }) => void>;
}

const DEFAULT_MAX_CONCURRENCY = 3;
/**
 * Share of a ceiling after which the run is WARNED that the end is near, and
 * the later share at which it is ORDERED to send its report.
 *
 * Measured on a real session (2026-11-04): with one notice at 0.75 phrased as
 * "stop starting new work now", ten of eighteen builders answered it with their
 * final report on the very next turn and walked away from a fifth of their
 * budget — sixty turns thrown away, while the token ceiling sat at 4% used. One
 * of them reported `status: blocked — paré por techo de turnos` with six turns
 * left. The notice was read as a stop sign, so it is now two: a warning that
 * says keep going, and an order that says stop.
 */
export const WRAP_UP_RATIO = 0.75;
/** Share of a ceiling after which the report is no longer optional. */
export const WRAP_UP_FINAL_RATIO = 0.9;

/**
 * What a run is told when it nears its ceiling. Two texts, on purpose.
 *
 * The warning must not read as an order: a child that stops the moment it hears
 * "budget" leaves a fifth of its turns unused and hands back work it could have
 * finished. So it names what is left, says to keep going, and asks only that
 * the report be kept cheap enough to fit in the turns that remain.
 *
 * The order is the old text, and it belongs at the very end, where it is true.
 */
export function budgetNotice(stage: "warned" | "ordered", left: string): string {
	if (stage === "warned") {
		return [
			`Budget notice: ${left}.`,
			"KEEP WORKING — this is a heads-up, not a stop order, and stopping now wastes the turns you have left.",
			"Do not send your final report yet. Finish the step you are on, then the next one.",
			"What changes from here: prefer the shortest path to the task's Check, batch independent tool calls into one turn, and do not start any exploration you could do without.",
			"You will get a second notice when it really is time to report.",
		].join(" ");
	}
	return [
		`Budget notice: ${left}. This is the last one.`,
		"Stop starting new work now. In this next message send your complete final report in the format you were given.",
		"Put what you did not finish under the field meant for it (remaining / not_checked).",
		"After the ceiling you are cut off mid-sentence and everything you did is lost if it is not in a report.",
	].join(" ");
}
/** A ceiling this small ends on its own; a notice would only cost a turn. */
const WRAP_UP_MIN_TURNS = 10;
const DEFAULT_STALL_MS = 4 * 60_000;
const DEFAULT_TOOL_STALL_MS = 10 * 60_000;
const DEFAULT_GRACE_MS = 1_000;
const STDERR_TAIL_MAX = 500;
const RESPONSE_TIMEOUT_MS = 30_000;

export function promptText(params: { task: string; context?: string }): string {
	return params.context ? `${params.task}\n\n## Context\n${params.context}` : params.task;
}

/** JSONL framing per the RPC docs: split only on LF, strip an optional CR,
 * ignore lines that are not JSON. (readline would also split on U+2028/2029.) */
export class JsonLines {
	private buffer = "";
	private readonly onValue: (value: unknown) => void;
	constructor(onValue: (value: unknown) => void) {
		this.onValue = onValue;
	}
	push(chunk: string): void {
		this.buffer += chunk;
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const raw of lines) {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			if (!line) continue;
			try {
				this.onValue(JSON.parse(line));
			} catch {
				// not JSON: ignore
			}
		}
	}
}

function defaultCliPath(): string {
	// src/agents/runner.ts -> package root -> the pi bundle shipped in node_modules.
	return new URL("../../node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js", import.meta.url).pathname;
}

export class SubagentRunner {
	readonly options: Required<Omit<RunnerOptions, "agentDir" | "env" | "onSettled" | "spawn" | "maxTurns" | "maxTokens" | "sessionId">> & Pick<RunnerOptions, "agentDir" | "env" | "onSettled" | "maxTurns" | "maxTokens" | "sessionId">;
	private readonly store: AgentStore;
	private readonly active = new Set<string>();
	private readonly parked: string[] = [];
	private readonly live = new Map<string, LiveTask>();
	private readonly meta = new Map<string, TaskMeta>();
	private readonly definitions = new Map<string, DefinitionSpec>();
	private counter = 0;
	private readonly spawnFn: SpawnFn;

	constructor(store: AgentStore, options: RunnerOptions) {
		this.store = store;
		this.spawnFn = options.spawn ?? ((command, args, opts) => nodeSpawn(command, args, opts));
		this.options = {
			cwd: options.cwd,
			maxConcurrency: options.maxConcurrency && options.maxConcurrency >= 1 ? options.maxConcurrency : DEFAULT_MAX_CONCURRENCY,
			maxTurns: options.maxTurns,
			maxTokens: options.maxTokens,
			stallTimeoutMs: options.stallTimeoutMs ?? DEFAULT_STALL_MS,
			toolStallTimeoutMs: options.toolStallTimeoutMs ?? DEFAULT_TOOL_STALL_MS,
			graceMs: options.graceMs ?? DEFAULT_GRACE_MS,
			cliPath: options.cliPath ?? defaultCliPath(),
			now: options.now ?? (() => Date.now()),
			schedule: options.schedule ?? ((fn, ms) => {
				const timer = setTimeout(fn, ms);
				timer.unref?.();
				return () => clearTimeout(timer);
			}),
			agentDir: options.agentDir,
			sessionId: options.sessionId,
			env: options.env,
			onSettled: options.onSettled,
		};
		store.setCancelHandler((id) => this.cancel(id));
	}

	/** Launch a task, or park it as "queued" when all slots are taken. */
	start(definition: DefinitionSpec, params: StartParams): AgentTask {
		this.counter += 1;
		const now = this.options.now();
		const id = `t${this.counter}-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
		const task: AgentTask = {
			id,
			name: definition.name,
			label: (params.label?.trim() || params.task).slice(0, 80),
			// Tolerant even though subagent_run now requires the label: a blank or
			// missing label falls back to the task's first sentence.
			title: taskTitle(params.label, params.task),
			sessionId: this.options.sessionId,
			status: "queued",
			model: definition.model,
			effort: definition.thinking ?? "default",
			tokens: 0,
			turns: 0,
			cost: 0,
			startedAt: now,
			thread: [],
		};
		this.meta.set(id, { mode: params.mode, prompt: promptText({ task: params.task, context: params.context }) });
		this.definitions.set(id, definition);
		this.store.upsert(task);
		if (this.active.size < this.options.maxConcurrency) {
			this.active.add(id);
			this.launch(id);
		} else {
			this.parked.push(id);
		}
		return task;
	}

	/** Resolve when the task reaches a terminal status; undefined for unknown ids. */
	waitFor(id: string): Promise<AgentTask | undefined> {
		const task = this.store.get(id);
		if (!task || isFinished(task.status)) return Promise.resolve(task);
		return new Promise((resolve) => {
			const unsubscribe = this.store.subscribe((changed) => {
				if (changed.id !== id || !isFinished(changed.status)) return;
				unsubscribe();
				resolve(changed);
			});
		});
	}

	cancel(id: string): boolean {
		const task = this.store.get(id);
		if (!task || isFinished(task.status)) return false;
		if (task.status === "queued") {
			const index = this.parked.indexOf(id);
			if (index >= 0) this.parked.splice(index, 1);
			this.finish(id, "aborted", { error: "cancelled before start" });
			return true;
		}
		const live = this.live.get(id);
		if (!live) return false;
		this.finish(id, "aborted", { error: "cancelled" });
		this.signal(live.child, "SIGTERM");
		this.escalate(live, () => this.signal(live.child, "SIGKILL"), this.options.graceMs);
		return true;
	}

	cancelAll(): number {
		return this.store.cancelAll();
	}

	activeCount(): number {
		return this.store.activeCount();
	}

	/** Force-kill everything: the session shutdown and process exit path. */
	killAll(): void {
		for (const id of [...this.parked, ...this.active]) {
			const task = this.store.get(id);
			if (task && !isFinished(task.status)) this.finish(id, "aborted", { error: "shutting down" });
		}
		for (const live of this.live.values()) {
			live.escalation?.();
			live.escalation = undefined;
			this.signal(live.child, "SIGKILL");
		}
	}

	private escalate(live: LiveTask, fn: () => void, ms: number): void {
		live.escalation?.();
		live.escalation = this.options.schedule(() => {
			live.escalation = undefined;
			fn();
		}, ms);
	}

	private launch(id: string): void {
		const meta = this.meta.get(id);
		const definition = this.definitions.get(id);
		if (!meta || !definition) return;
		const args = ["--mode", "rpc", "--no-session", "--model", definition.model];
		if (definition.thinking) args.push("--thinking", definition.thinking);
		if (definition.tools.length > 0) args.push("--tools", definition.tools.join(","));
		let promptDir: string | undefined;
		try {
			// The system prompt travels as a file: argv limits and shell quoting
			// never enter the picture, whatever the definition says.
			promptDir = mkdtempSync(join(tmpdir(), "violeta-agent-"));
			writeFileSync(join(promptDir, "system-prompt.md"), definition.prompt);
			args.push("--append-system-prompt", join(promptDir, "system-prompt.md"));
		} catch {
			promptDir = undefined;
		}
		let child: ChildProcess;
		try {
			// The CLI is a JS entry: run it with the same node as this process,
			// never through the shebang (node may not be on the child's PATH).
			child = this.spawnFn(process.execPath, [this.options.cliPath, ...args], {
				cwd: this.options.cwd,
				// Recursion guard: the violeta package is loaded in spawned children
				// too, so every child announces itself and its own extension
				// registers no subagent tools (no grandchildren).
				env: { ...process.env, VIOLETA_AGENTS_CHILD: "1", ...this.options.env },
				detached: process.platform !== "win32",
				windowsHide: true,
				stdio: ["pipe", "pipe", "pipe"],
			});
		} catch (error) {
			if (promptDir) rmSync(promptDir, { recursive: true, force: true });
			this.finish(id, "failed", { error: `could not start pi: ${error instanceof Error ? error.message : String(error)}` });
			return;
		}
		const task = this.store.get(id)!;
		const live: LiveTask = {
			child,
			reducer: createReducer(this.store, task),
			cancelStall: () => {},
			escalation: undefined,
			terminal: false,
			overBudget: undefined,
			wrapUpStage: "none",
			promptDir,
			stderrTail: "",
			responseWaiters: new Map(),
		};
		this.live.set(id, live);
		this.store.update(id, { status: "running" });
		const lines = new JsonLines((record) => this.receive(id, live, record));
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => lines.push(chunk));
		child.stderr?.setEncoding("utf8");
		child.stderr?.on("data", (chunk: string) => {
			live.stderrTail = (live.stderrTail + chunk).slice(-STDERR_TAIL_MAX);
		});
		child.on("error", (error) => {
			if (!live.terminal) this.finish(id, "failed", { error: `pi process error: ${error.message}` });
		});
		child.on("exit", (code, signal) => {
			if (live.promptDir) rmSync(live.promptDir, { recursive: true, force: true });
			const tail = live.stderrTail.replace(/\s+/g, " ").trim();
			this.live.delete(id);
			if (!live.terminal) {
				this.finish(id, "failed", {
					error: `pi exited with ${code === null ? `signal ${signal}` : `code ${code}`} before settling${tail ? `; stderr: ${tail}` : ""}`,
				});
			}
		});
		child.stdin?.on("error", () => {});
		this.armStall(id, live);
		// Subscribe (the request registers its waiter) before prompting, per the
		// RPC docs, so a fast completion cannot slip past us.
		void this.request(live, { type: "prompt", message: meta.prompt }).then((response) => {
			if (response.success === false && !live.terminal) {
				this.finish(id, "failed", { error: `prompt rejected: ${String(response.error ?? "unknown error")}` });
			}
		});
	}

	/** Send one command and await its correlated response. */
	private request(live: LiveTask, command: Record<string, unknown>): Promise<{ success?: boolean; error?: unknown }> {
		return new Promise((resolve) => {
			const id = `r${Math.random().toString(36).slice(2)}`;
			let settled = false;
			live.responseWaiters.set(id, (response) => {
				if (settled) return;
				settled = true;
				resolve(response);
			});
			this.write(live, { id, ...command });
			this.options.schedule(() => {
				if (settled) return;
				settled = true;
				resolve({ success: false, error: `no response within ${Math.round(RESPONSE_TIMEOUT_MS / 1000)}s` });
			}, RESPONSE_TIMEOUT_MS);
		});
	}

	private write(live: LiveTask, payload: Record<string, unknown>): void {
		try {
			live.child.stdin?.write(`${JSON.stringify(payload)}\n`);
		} catch {
			// child is gone; the exit handler settles the task
		}
	}

	private receive(id: string, live: LiveTask, value: unknown): void {
		if (live.terminal || !value || typeof value !== "object") return;
		const record = value as Record<string, unknown>;
		if (record.type === "response") {
			const waiter = typeof record.id === "string" ? live.responseWaiters.get(record.id) : undefined;
			if (waiter) {
				live.responseWaiters.delete(record.id);
				waiter(record);
			}
			this.armStall(id, live);
			return;
		}
		// The child's own UI dialogs must never hang it: dismiss everything.
		if (record.type === "extension_ui_request" && typeof record.id === "string") {
			this.write(live, { type: "extension_ui_response", id: record.id, cancelled: true });
			this.armStall(id, live);
			return;
		}
		const task = this.store.get(id);
		if (!task) return;
		const result = live.reducer.apply(record);
		if (result.activity) this.armStall(id, live);
		if (result.settled) {
			// Settling is not the same as answering. A child that ends with nothing to
			// say did not do its job, and reporting that as "completed" invites the
			// caller to assume success and move on.
			const answered = typeof task.result === "string" && task.result.trim() !== "";
			if (result.aborted) this.finish(id, "aborted");
			else if (answered) this.finish(id, "completed");
			else this.finish(id, "failed", { error: "settled without an answer" });
			return;
		}
		// A ceiling is acted on when the child tries to do MORE, not the instant it
		// is touched: a run whose next record is settlement finished its work on
		// budget and is completed. Cutting at the touch would label finished work as
		// a partial handoff and send the caller to redo it.
		if (live.overBudget) {
			this.stopForBudget(id, live, live.overBudget);
			return;
		}
		live.overBudget = this.exceeded(id, task);
		if (!live.overBudget) this.maybeWrapUp(id, live, task);
	}

	/** Which stage of the wrap-up a run's usage has reached, or none. Pure, so
	 * the thresholds can be checked without a child process. */
	private wrapUpStageFor(id: string, task: AgentTask): "none" | "warned" | "ordered" {
		const definition = this.definitions.get(id);
		const maxTurns = this.options.maxTurns ?? definition?.maxTurns;
		const maxTokens = this.options.maxTokens ?? definition?.maxTokens;
		const turnsCount = maxTurns !== undefined && maxTurns >= WRAP_UP_MIN_TURNS;
		const share = (ratio: number) =>
			(turnsCount && task.turns >= Math.ceil(maxTurns! * ratio)) ||
			(maxTokens !== undefined && task.tokens >= maxTokens * ratio);
		if (share(WRAP_UP_FINAL_RATIO)) return "ordered";
		if (share(WRAP_UP_RATIO)) return "warned";
		return "none";
	}

	/** What is left of the ceiling that is closest to being spent. */
	private budgetLeft(id: string, task: AgentTask): string {
		const definition = this.definitions.get(id);
		const maxTurns = this.options.maxTurns ?? definition?.maxTurns;
		const maxTokens = this.options.maxTokens ?? definition?.maxTokens;
		if (maxTurns !== undefined && maxTurns >= WRAP_UP_MIN_TURNS) {
			return `${maxTurns - task.turns} turns left of ${maxTurns}`;
		}
		if (maxTokens !== undefined) {
			return `${Math.round(100 - (task.tokens / maxTokens) * 100)}% of the token budget left`;
		}
		return "budget nearly spent";
	}

	/** Two notices, because one was read as a stop sign. At 75% the run is told
	 * the end is near and to KEEP WORKING; at 90% it is told to report now.
	 * Delivered as `steer` messages, which Pi queues before the next model call.
	 * Each stage goes out at most once, and never to a run that has settled. */
	private maybeWrapUp(id: string, live: LiveTask, task: AgentTask): void {
		const stage = this.wrapUpStageFor(id, task);
		if (stage === "none") return;
		// Never go backwards, and never repeat a stage. A run that jumps straight
		// past 90% (a single expensive turn) gets the order and skips the warning.
		if (live.wrapUpStage === "ordered") return;
		if (live.wrapUpStage === "warned" && stage === "warned") return;
		live.wrapUpStage = stage;
		this.write(live, { type: "steer", message: budgetNotice(stage, this.budgetLeft(id, task)) });
	}

	/** The ceiling this run has reached, if any. An explicit runner option wins
	 * over the definition, so ceilings can be retuned without editing files. */
	private exceeded(id: string, task: AgentTask): BudgetLimit | undefined {
		const definition = this.definitions.get(id);
		const maxTurns = this.options.maxTurns ?? definition?.maxTurns;
		const maxTokens = this.options.maxTokens ?? definition?.maxTokens;
		if (maxTurns !== undefined && task.turns >= maxTurns) return "maxTurns";
		if (maxTokens !== undefined && task.tokens >= maxTokens) return "maxTokens";
		return undefined;
	}

	/** A ceiling is a planned stop, not a failure: the child's last answer stays
	 * as the handoff the caller continues from, and teardown matches cancel. */
	private stopForBudget(id: string, live: LiveTask, limit: BudgetLimit): void {
		this.finish(id, "budget", { stoppedBy: limit });
		this.signal(live.child, "SIGTERM");
		this.escalate(live, () => this.signal(live.child, "SIGKILL"), this.options.graceMs);
	}

	/** Renewable silence budget: an in-flight tool call gets the tool ceiling. */
	private armStall(id: string, live: LiveTask): void {
		live.cancelStall();
		const budget = live.reducer.inFlightCount() > 0
			? Math.max(this.options.toolStallTimeoutMs, this.options.stallTimeoutMs)
			: this.options.stallTimeoutMs;
		live.cancelStall = this.options.schedule(() => {
			if (live.terminal) return;
			this.finish(id, "failed", { error: `stalled: no activity for ${Math.round(budget / 60_000)} min` });
		}, budget);
	}

	private finish(id: string, status: AgentTask["status"], patch: Partial<AgentTask> = {}): void {
		const task = this.store.get(id);
		if (!task || isFinished(task.status)) return;
		const live = this.live.get(id);
		if (live) live.terminal = true;
		live?.cancelStall();
		// The one-line summary: the result handoff's summary (or first line) for
		// completed tasks, the first line of the error/abort reason otherwise.
		const reason = patch.error ?? task.error;
		// A budget stop keeps its partial answer for the same reason a completed one
		// does: that text is the handoff. Only failures discard it.
		const keepsResult = status === "completed" || status === "budget";
		const summary = keepsResult ? extractSummary(task.result) : firstLine(reason);
		this.store.update(id, {
			status,
			endedAt: this.options.now(),
			summary: summary ?? undefined,
			...(keepsResult ? {} : { result: undefined }),
			...patch,
		});
		if (this.options.agentDir) saveTaskToHistory(join(this.options.agentDir, HISTORY_SUBDIR), this.store.get(id)!);
		const settled = this.store.get(id)!;
		const mode = this.meta.get(id)?.mode ?? "task";
		this.release(id);
		this.meta.delete(id);
		this.definitions.delete(id);
		if (live && live.child.exitCode === null && live.child.signalCode === null) {
			try {
				live.child.stdin?.end();
			} catch {
				this.signal(live.child, "SIGTERM");
			}
			// Bounded escalation in case the child ignores the orderly shutdown.
			this.escalate(live, () => this.signal(live.child, "SIGKILL"), this.options.graceMs * 4);
		}
		this.options.onSettled?.(settled, mode);
	}

	/** Free a slot and promote the next still-queued parked task, if any. */
	private release(id: string): void {
		this.active.delete(id);
		while (this.parked.length > 0 && this.active.size < this.options.maxConcurrency) {
			const next = this.parked.shift()!;
			const task = this.store.get(next);
			if (!task || isFinished(task.status)) continue;
			if (!this.definitions.has(next) || !this.meta.has(next)) continue;
			this.active.add(next);
			this.launch(next);
			return;
		}
	}

	private signal(child: ChildProcess, signal: NodeJS.Signals): void {
		// Children start detached (own process group), so the negative PID kills
		// the whole tree; fall back to the handle when the group is already gone.
		if (typeof child.pid === "number" && child.pid > 0 && process.platform !== "win32") {
			try {
				process.kill(-child.pid, signal);
				return;
			} catch {
				// group gone; the handle may still be killable
			}
		}
		try {
			child.kill(signal);
		} catch {
			// already gone
		}
	}
}
