/**
 * Subagent task store — the exact contract the violeta views (T2: card above
 * the editor and the alt+a overlay) consume. Neutral engine data only: no
 * roles, no ODD, no philosophy.
 *
 * CONTRACT
 * ========
 * Types:
 * - `TaskStatus` = "queued" | "running" | "completed" | "failed" | "aborted"
 *   | "budget"
 * - `BudgetLimit` = "maxTurns" | "maxTokens"
 * - `ThreadKind` = "thinking" | "text" | "tool" | "info"
 * - `ThreadItem` = { kind: ThreadKind, text: string, toolName?: string,
 *   toolStatus?: "running" | "done" | "error" }
 * - `AgentTask` = {
 *     id: string                unique per launch (survives persistence)
 *     name: string              agent definition name (not a role)
 *     label: string             short display label (task text or explicit label)
 *     title: string             display title shown as the primary text in views:
 *                               the label when present, else the task's first
 *                               sentence (≤ 60 chars, never empty for real tasks)
 *     status: TaskStatus
 *     model: string             model id from the definition
 *     effort: string            thinking level from the definition, or "default"
 *     tokens: number            total input + output tokens across the run
 *     turns: number             assistant messages completed across the run
 *     cost: number              total cost in USD across the run
 *     stoppedBy?: BudgetLimit   which ceiling ended the run (status "budget")
 *     startedAt: number         epoch ms, set when the task is created (queued)
 *     endedAt?: number          epoch ms, set once the task is finished
 *     result?: string           final assistant text (completed tasks)
 *     error?: string            failure reason (failed/aborted tasks)
 *     summary?: string          one-line summary computed when the task finishes:
 *                               the `summary:` line of the result handoff, else
 *                               the first non-empty result line (≤ 200 chars);
 *                               failed/aborted tasks use the first error line
 *     thread: ThreadItem[]      bounded child transcript, oldest first
 *   }
 *
 * `AgentStore` (module singleton via `getAgentStore()`):
 * - `list(): AgentTask[]`            insertion order; copies are NOT made, treat as read-only
 * - `get(id): AgentTask | undefined`
 * - `subscribe(listener: (task: AgentTask) => void): () => void`
 *     Called once per delta with the changed task (cheap); returns unsubscribe.
 * - `cancel(id): boolean`            queued → aborted locally; running → child
 *     SIGTERM/SIGKILL through the runner; finished/unknown → false
 * - `cancelAll(): number`            number of active tasks cancelled
 * - `activeCount(): number`          queued + running tasks
 *
 * Engine-only methods (used by the runner and history loader, not by views):
 * `upsert`, `update`, `pushThreadItem`, `appendThreadText`, `setCancelHandler`,
 * `history`.
 *
 * Bounds: a task keeps at most `MAX_THREAD_ITEMS` (200) thread items (oldest
 * dropped) and each item's text is capped at `MAX_ITEM_TEXT` (8000 chars), so
 * listeners stay cheap on long child runs.
 */

/** A run stops at a ceiling declared by its definition. This is a planned stop
 * with a usable partial handoff, never a failure: the engine stays neutral and
 * only reports which ceiling was reached: the caller decides what to do next. */
export type BudgetLimit = "maxTurns" | "maxTokens";

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "aborted" | "budget";
export type ThreadKind = "thinking" | "text" | "tool" | "info";
export type ThreadToolStatus = "running" | "done" | "error";

export interface ThreadItem {
	kind: ThreadKind;
	text: string;
	toolName?: string;
	toolStatus?: ThreadToolStatus;
}

export interface AgentTask {
	id: string;
	name: string;
	label: string;
	title: string;
	/** Session that launched it; history is filtered by it. */
	sessionId?: string;
	status: TaskStatus;
	model: string;
	effort: string;
	tokens: number;
	turns: number;
	cost: number;
	startedAt: number;
	endedAt?: number;
	result?: string;
	error?: string;
	summary?: string;
	stoppedBy?: BudgetLimit;
	thread: ThreadItem[];
}

export const MAX_THREAD_ITEMS = 200;
export const MAX_ITEM_TEXT = 8000;

export type TaskListener = (task: AgentTask) => void;
export type CancelHandler = (id: string) => boolean;

const FINISHED: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "aborted", "budget"]);

export function isFinished(status: TaskStatus): boolean {
	return FINISHED.has(status);
}

/** Truncate text to `max` characters. */
export function capText(text: string, max = MAX_ITEM_TEXT): string {
	return text.length > max ? text.slice(0, max) : text;
}

export class AgentStore {
	private tasks = new Map<string, AgentTask>();
	private listeners = new Set<TaskListener>();
	private cancelHandler: CancelHandler | undefined;

	/** Register or replace a task. Notifies listeners (history load included). */
	upsert(task: AgentTask): void {
		this.tasks.set(task.id, task);
		this.notify(task);
	}

	list(): AgentTask[] {
		return [...this.tasks.values()];
	}

	get(id: string): AgentTask | undefined {
		return this.tasks.get(id);
	}

	/** Merge a patch into a task and notify listeners. */
	update(id: string, patch: Partial<AgentTask>): AgentTask | undefined {
		const task = this.tasks.get(id);
		if (!task) return undefined;
		Object.assign(task, patch);
		this.notify(task);
		return task;
	}

	subscribe(listener: TaskListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Append one thread item, dropping the oldest beyond the cap. */
	pushThreadItem(id: string, item: ThreadItem): void {
		const task = this.tasks.get(id);
		if (!task) return;
		task.thread.push({ ...item, text: capText(item.text) });
		if (task.thread.length > MAX_THREAD_ITEMS) task.thread.splice(0, task.thread.length - MAX_THREAD_ITEMS);
		this.notify(task);
	}

	/** Append text to the last item of the same kind, or push a new one. */
	appendThreadText(id: string, kind: ThreadKind, delta: string): void {
		const task = this.tasks.get(id);
		if (!task) return;
		const last = task.thread[task.thread.length - 1];
		if (last && last.kind === kind && !last.toolName) {
			last.text = capText(last.text + delta);
		} else {
			this.pushThreadItem(id, { kind, text: capText(delta) });
			return;
		}
		this.notify(task);
	}

	/** Merge a patch into one thread item by index and notify listeners. */
	updateThreadItem(id: string, index: number, patch: Partial<ThreadItem>): void {
		const task = this.tasks.get(id);
		const item = task?.thread[index];
		if (!task || !item) return;
		Object.assign(item, patch);
		if (patch.text !== undefined) item.text = capText(item.text);
		this.notify(task);
	}

	setCancelHandler(handler: CancelHandler): void {
		this.cancelHandler = handler;
	}

	/** Cancel a task: queued tasks abort immediately; running tasks delegate to
	 * the runner's cancel handler (SIGTERM then SIGKILL). */
	cancel(id: string): boolean {
		const task = this.tasks.get(id);
		if (!task || isFinished(task.status)) return false;
		if (task.status === "queued") {
			this.update(id, { status: "aborted", endedAt: Date.now() });
			return true;
		}
		return this.cancelHandler ? this.cancelHandler(id) : false;
	}

	cancelAll(): number {
		let count = 0;
		for (const task of this.tasks.values()) {
			if (isFinished(task.status)) continue;
			if (this.cancel(task.id)) count++;
		}
		return count;
	}

	activeCount(): number {
		let count = 0;
		for (const task of this.tasks.values()) {
			if (task.status === "queued" || task.status === "running") count++;
		}
		return count;
	}

	/** Load finished tasks (e.g. from agents-history). Present ids and unfinished
	 * records are skipped, so a live task never gets clobbered by history. */
	history(tasks: AgentTask[]): void {
		for (const task of tasks) {
			if (!isFinished(task.status) || this.tasks.has(task.id)) continue;
			this.upsert(task);
		}
	}

	private notify(task: AgentTask): void {
		for (const listener of [...this.listeners]) {
			try {
				listener(task);
			} catch {
				// a broken view must never break the engine
			}
		}
	}
}

let singleton: AgentStore | undefined;

/** The process-wide store; views and tools share this one instance. */
export function getAgentStore(): AgentStore {
	singleton ??= new AgentStore();
	return singleton;
}
