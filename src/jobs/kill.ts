/**
 * Process-tree kill for background jobs, pure helpers.
 *
 * Jobs spawn detached (their own process group), so the whole tree — children
 * and grandchildren — dies with one group signal. `killTree` falls back to the
 * process handle when the group is already gone; `killTreeEscalating` adds the
 * bounded SIGKILL follow-up. The caller owns the clock via `schedule`.
 */

export type ScheduleFn = (fn: () => void, ms: number) => () => void;

/** Send one signal to the whole process group. True when it was delivered. */
export function killTree(pid: number, signal: NodeJS.Signals): boolean {
	if (!Number.isInteger(pid) || pid <= 0 || process.platform === "win32") return false;
	try {
		process.kill(-pid, signal);
		return true;
	} catch {
		// group gone: the handle may still be killable
		try {
			process.kill(pid, signal);
			return true;
		} catch {
			return false;
		}
	}
}

/**
 * SIGTERM the group now and SIGKILL it after `graceMs`. Returns the cancel
 * function for the escalation timer.
 */
export function killTreeEscalating(pid: number, schedule: ScheduleFn, graceMs: number): () => void {
	killTree(pid, "SIGTERM");
	const cancel = schedule(() => killTree(pid, "SIGKILL"), graceMs);
	return cancel;
}
