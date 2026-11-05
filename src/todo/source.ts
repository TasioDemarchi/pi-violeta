/** Where the Todo panel gets its list (S3, estado-de-tareas).
 *
 * Two sources, one panel:
 *
 *   - an ACTIVE CONTRACT, i.e. a `tasks/<name>.md` on disk: the panel is a
 *     view of that file (D2). A task is done when its `commit:` holds content
 *     (S2) and in progress while the harness's `estado: en curso` is on the
 *     row — both read by `src/contract/state.ts`, which is the only definition
 *     of what a task row means. The panel never keeps a second copy, so an
 *     edit to the file shows up on the panel with no tool call in between.
 *   - no contract, or a contract with no `## Tasks` section: the panel keeps
 *     the list the `todo` tool maintains, exactly as it did before this
 *     feature. Most projects have no contract at all.
 *
 * The choice is a pure function of the file's text and the model's list, so the
 * whole rule is testable without a terminal or a model. */
import { todoFromContract } from "../contract/state.ts";
import type { TodoState, TodoTask } from "./store.ts";

/** The contract the panel reads. T5 rides on the convention `tasks/<name>.md`
 * and this one file is the whole of it: there is no detection and no setting.
 * T9 (S8) owns "which contract is active"; when it lands, this constant is the
 * single line that becomes the session's answer. */
export const ACTIVE_CONTRACT = "tasks/estado-de-tareas.md";

/** Ids come from the file (`T#`), so the next one is past the highest. */
function nextIdOf(tasks: readonly TodoTask[]): number {
	return tasks.reduce((max, task) => Math.max(max, task.id), 0) + 1;
}

/** The list the panel shows: the contract's rows when there are any, the
 * model's list otherwise. */
export function panelTodo(contractMd: string | undefined, model: TodoState): TodoState {
	if (contractMd === undefined) return model;
	const tasks = todoFromContract(contractMd);
	// An empty derivation means "this file is not a contract with tasks": fall
	// back rather than blanking the panel the model is using.
	if (tasks.length === 0) return model;
	return { tasks, nextId: nextIdOf(tasks) };
}
