/** `jarvis.close-needs-tester` — a risky contract does not close without a
 * tester report (contrato-aprobado, pieza 2).
 *
 * jarvis.md §5 already asks for it: when every task passed and some task is
 * `riesgo: sí`, dispatch `tester` once. Measured on 2026-11-15 with three
 * Jarvis on the same job: two dispatched it and one (GLM) closed without it.
 * The tester of one of the other two found the only bug that could delete the
 * owner's data. A sentence the cheapest model skips is a rule for the harness.
 *
 * Pure: given the contract text and the session branch, say whether this is a
 * close that still owes a tester. The extension decides what to do with it
 * (one more model request, then a warning to the owner — never a loop).
 *
 * "A close" means every task is finished: committed, or `estado: verificada`,
 * or `estado: por verificar` (its Check is manual: the harness has nothing
 * left to run). A `fallada` or unmarked task is pending work, not a close.
 *
 * "A tester report" means a `subagent_run` of `tester` that was not refused,
 * AFTER the last `builder` dispatch: a report on code that changed since is a
 * report on other code. */

import { readContractTasks } from "./tasks.ts";
import { parseContractTasks, readTaskStatus } from "./state.ts";
import { inlineField } from "./lint.ts";

export const CLOSE_GATE_ENTRY_TYPE = "violeta-close-gate";

const FINISHED = new Set(["verificada", "por verificar"]);
const RISKY = new Set(["sí", "si", "yes"]);

interface BranchEntry {
	type?: string;
	customType?: string;
	data?: unknown;
	message?: {
		role?: string;
		toolCallId?: string;
		isError?: boolean;
		content?: Array<{ type?: string; id?: string; name?: string; arguments?: { agent?: unknown } }>;
	};
}

/** Index of the last successful dispatch of each agent on the branch. */
function lastDispatches(branch: readonly unknown[]): Map<string, number> {
	const pending = new Map<string, { agent: string; index: number }>();
	const last = new Map<string, number>();
	(branch as BranchEntry[]).forEach((entry, index) => {
		const message = entry?.type === "message" ? entry.message : undefined;
		if (!message) return;
		if (message.role === "assistant") {
			for (const part of message.content ?? []) {
				if (part?.type !== "toolCall" || part.name !== "subagent_run" || typeof part.id !== "string") continue;
				const agent = part.arguments?.agent;
				if (typeof agent === "string") pending.set(part.id, { agent, index });
			}
		} else if (message.role === "toolResult" && typeof message.toolCallId === "string") {
			const call = pending.get(message.toolCallId);
			if (call && message.isError !== true) last.set(call.agent, call.index);
		}
	});
	return last;
}

/** The risky task ids still owed a tester, and a key for "this same close"
 * (it changes when a new builder runs), or undefined when nothing is owed. */
export function closeGate(contract: string, branch: readonly unknown[]): { risky: number[]; key: string } | undefined {
	const tasks = readContractTasks(contract);
	if (tasks.length === 0) return undefined;
	const finished = tasks.every((task) => task.done || FINISHED.has((readTaskStatus(contract, task.id) ?? "").toLowerCase()));
	if (!finished) return undefined;

	const risky = parseContractTasks(contract)
		.filter((row) => RISKY.has((inlineField(row.line, "riesgo") ?? inlineField(row.line, "risk") ?? "").toLowerCase()))
		.map((row) => row.id);
	if (risky.length === 0) return undefined;

	const last = lastDispatches(branch);
	const builder = last.get("builder") ?? -1;
	const tester = last.get("tester");
	if (tester !== undefined && tester > builder) return undefined;
	return { risky, key: `builder@${builder}` };
}

/** Whether the owner was already nudged for this same close. */
export function alreadyNudged(branch: readonly unknown[], key: string): boolean {
	return (branch as BranchEntry[]).some(
		(entry) => entry?.type === "custom" && entry.customType === CLOSE_GATE_ENTRY_TYPE && (entry.data as { key?: unknown })?.key === key,
	);
}
