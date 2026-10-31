/**
 * session-filter — keeps the agents view (card, overlay and the model-facing
 * list) inside the current session, so finished tasks from earlier sessions do
 * not pile up in front of the user.
 *
 * Rules:
 * - No session id known (older Pi) => every task passes, nothing is hidden.
 * - A task belongs to the current session when its `sessionId` matches.
 * - A task with no `sessionId` (written before this existed) belongs to no
 *   session and stays out of a scoped view.
 */

import type { AgentTask } from "./store.ts";

export function sessionTasks(tasks: readonly AgentTask[], sessionId: string | undefined): AgentTask[] {
	if (!sessionId) return [...tasks];
	return tasks.filter((task) => task.sessionId === sessionId);
}
