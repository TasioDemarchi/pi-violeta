/** Finished-task persistence: one JSON file per task in
 * `${PI_CODING_AGENT_DIR}/agents-history/`, capped at the newest 200 files
 * (oldest dropped). Reading tolerates corrupt or malformed files by skipping
 * them, so one bad write never hides the rest of the history. */

import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { displayTitle } from "./summary.ts";
import { isFinished, type AgentTask } from "./store.ts";

export const HISTORY_CAP = 200;

const ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function validTask(value: unknown): value is AgentTask {
	if (!value || typeof value !== "object") return false;
	const task = value as Record<string, unknown>;
	return (
		typeof task.id === "string" && task.id !== "" &&
		typeof task.name === "string" &&
		typeof task.label === "string" &&
		typeof task.status === "string" && isFinished(task.status as AgentTask["status"]) &&
		typeof task.model === "string" &&
		typeof task.effort === "string" &&
		typeof task.tokens === "number" &&
		typeof task.cost === "number" &&
		typeof task.startedAt === "number" &&
		Array.isArray(task.thread)
	);
}

function safeId(id: string): string | undefined {
	return ID_PATTERN.test(id) ? id : undefined;
}

/** Write one task as `<id>.json` and apply the history cap. */
export function saveTaskToHistory(dir: string, task: AgentTask): void {
	const id = safeId(task.id);
	if (!id) return;
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${id}.json`), JSON.stringify(task, null, "\t") + "\n");
	capTaskHistory(dir, HISTORY_CAP);
}

/** Keep the newest `cap` history files, deleting the oldest by mtime. */
export function capTaskHistory(dir: string, cap: number): void {
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	} catch {
		return;
	}
	if (files.length <= cap) return;
	const withTimes: Array<{ file: string; mtime: number }> = [];
	for (const file of files) {
		try {
			withTimes.push({ file, mtime: statSync(join(dir, file)).mtimeMs });
		} catch {
			// vanished concurrently; nothing to delete
		}
	}
	withTimes.sort((a, b) => a.mtime - b.mtime);
	for (const { file } of withTimes.slice(0, withTimes.length - cap)) {
		try {
			unlinkSync(join(dir, file));
		} catch {
			// best effort
		}
	}
}

/** Old history files predate `title`/`summary`/`turns`: restore the title from
 * the label (or name), default the turn counter so views never read undefined,
 * and drop empty summaries so the views always have a title. */
function withTitleFallback(task: AgentTask): AgentTask {
	const restored: AgentTask = { ...task, title: displayTitle(task), turns: typeof task.turns === "number" ? task.turns : 0 };
	if (typeof restored.summary !== "string" || restored.summary.trim() === "") delete restored.summary;
	return restored;
}

/** Load every valid persisted task, oldest first. Corrupt files are skipped.
 * With `sessionId`, only that session's tasks load (legacy entries without one
 * belong to no session and stay out of a scoped view). */
export function loadTaskHistory(dir: string, sessionId?: string): AgentTask[] {
	let files: string[];
	try {
		files = readdirSync(dir).filter((f) => f.endsWith(".json"));
	} catch {
		return [];
	}
	const tasks: AgentTask[] = [];
	for (const file of files) {
		try {
			const parsed: unknown = JSON.parse(readFileSync(join(dir, file), "utf8"));
			if (!validTask(parsed)) continue;
			if (sessionId && parsed.sessionId !== sessionId) continue;
			tasks.push(withTitleFallback(parsed));
		} catch {
			// corrupt file: skip it, keep the rest
		}
	}
	tasks.sort((a, b) => a.startedAt - b.startedAt);
	return tasks;
}
