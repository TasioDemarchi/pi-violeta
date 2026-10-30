/** Concurrency admission for subagent tasks: at most `limit` running at once,
 * the rest wait in FIFO order. Pure logic; the runner drives the launches. */

export interface ConcurrencyQueue {
	/** Take a slot if one is free. */
	admit(id: string): boolean;
	/** Park a task until a slot frees. */
	enqueue(id: string): void;
	/** Remove a waiting task (e.g. it was cancelled). */
	drop(id: string): void;
	/** Free a slot and return the next waiting id (now running), if any. */
	release(id: string): string | undefined;
	running(): string[];
	waiting(): string[];
}

export function createConcurrencyQueue(limit: number): ConcurrencyQueue {
	const active = new Set<string>();
	const parked: string[] = [];
	const max = Number.isFinite(limit) && limit >= 1 ? Math.floor(limit) : 1;
	return {
		admit(id) {
			if (active.size >= max) return false;
			active.add(id);
			return true;
		},
		enqueue(id) {
			parked.push(id);
		},
		drop(id) {
			const index = parked.indexOf(id);
			if (index >= 0) parked.splice(index, 1);
		},
		release(id) {
			active.delete(id);
			while (parked.length > 0) {
				const next = parked.shift()!;
				if (active.has(next)) continue;
				active.add(next);
				return next;
			}
			return undefined;
		},
		running: () => [...active],
		waiting: () => [...parked],
	};
}
