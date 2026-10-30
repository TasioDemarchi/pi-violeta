/**
 * Output lines for background jobs and monitors, pure logic.
 *
 * Two concerns live here: the bounded tail of a job's output (kept in memory
 * for the exit notice and the job list), and monitor event batching — lines
 * arriving within the window share one notice, each notice is bounded, and a
 * stream that floods is stopped instead of burning the model's turns.
 * No timers, no processes: the caller supplies the clock.
 */

/** Lines kept for the exit notice and job listings. */
export const TAIL_LINES = 20;
/** Characters kept per tail line, after an ellipsis, for endless lines. */
export const MAX_LINE_CHARS = 2000;

/** Collects the last `maxLines` lines of a stream of output chunks. */
export function createTail(maxLines = TAIL_LINES, maxLineChars = MAX_LINE_CHARS) {
	const complete: string[] = [];
	let partial = "";
	let partialTruncated = false;
	const bound = (line: string, truncated: boolean): string => {
		const cut = line.length > maxLineChars;
		const kept = cut ? line.slice(-maxLineChars) : line;
		return cut || truncated ? `…${kept}` : kept;
	};
	return {
		push(text: string): void {
			const parts = (partial + text).split("\n");
			partial = parts.pop() ?? "";
			for (const [index, part] of parts.entries()) {
				complete.push(bound(part.endsWith("\r") ? part.slice(0, -1) : part, index === 0 && partialTruncated));
				if (complete.length > maxLines) complete.shift();
				if (index === 0) partialTruncated = false;
			}
			if (partial.length > maxLineChars) {
				partial = partial.slice(-maxLineChars);
				partialTruncated = true;
			}
		},
		/** Every line kept so far, including the unterminated partial, if any. */
		lines(): string[] {
			const all = partial.length > 0 ? [...complete, bound(partial.endsWith("\r") ? partial.slice(0, -1) : partial, partialTruncated)] : [...complete];
			return all.slice(-maxLines);
		},
	};
}

/** Lines arriving within this window share one notice. */
export const MONITOR_BATCH_MS = 200;
/** Lines kept per notice; the rest are only counted. */
export const MONITOR_LINES_PER_NOTICE = 20;
/** More lines than this within MONITOR_FLOOD_WINDOW_MS is a flood. */
export const MONITOR_FLOOD_LINES = 120;
export const MONITOR_FLOOD_WINDOW_MS = 60_000;
/** The mandatory monitor timeout is capped at 30 minutes. */
export const MONITOR_MAX_TIMEOUT_SECONDS = 1800;

export interface MonitorBatch {
	lines: string[];
	/** Lines beyond MONITOR_LINES_PER_NOTICE in this window, dropped. */
	dropped: number;
}

export function createEventBatcher() {
	let batch: MonitorBatch | undefined;
	let total = 0;
	// Arrival times inside the current flood window, oldest first.
	const recent: number[] = [];
	return {
		/**
		 * Records one output line. `opensBatch` asks the caller to schedule a
		 * flush; `flood` asks it to stop the monitor.
		 */
		pushLine(line: string, now: number): { opensBatch: boolean; flood: boolean } {
			if (line.trim().length === 0) return { opensBatch: false, flood: false };
			total += 1;
			recent.push(now);
			while (recent.length > 0 && now - recent[0]! >= MONITOR_FLOOD_WINDOW_MS) recent.shift();
			const opensBatch = batch === undefined;
			batch ??= { lines: [], dropped: 0 };
			if (batch.lines.length < MONITOR_LINES_PER_NOTICE) batch.lines.push(line);
			else batch.dropped += 1;
			return { opensBatch, flood: recent.length > MONITOR_FLOOD_LINES };
		},
		/** Takes the current batch, or undefined when no line arrived. */
		flush(): MonitorBatch | undefined {
			const taken = batch;
			batch = undefined;
			return taken;
		},
		/** Every event line seen so far, blank lines excluded. */
		total: () => total,
	};
}
