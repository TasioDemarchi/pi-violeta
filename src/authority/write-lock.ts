/** `jarvis.write-lock` — with a contract open and work still pending, the
 * session the owner talks to does not write the project's files.
 *
 * Why it is a rule and not a sentence: §4 of the philosophy already forbids
 * this, five times over, and all five are written about a `worker`. Jarvis is
 * not a worker, so none of them applied, and the measurement says so — 51 code
 * writes by the session against 30 builder runs, 34 of them onto files a
 * builder was already working on, and four tasks of `estado-de-tareas.md`
 * closed by Jarvis after a budget handoff, declared in their own `commit:`
 * field. AGENTS.md: what must always hold is enforced by the harness.
 *
 * The escape is declared, never asked for (D5). A task row that carries
 * `— quién: Jarvis` is field work no subagent can reach — the case §3 already
 * describes, used twice in eighteen contracts — and it opens the lock. The
 * owner never has to answer a dialog: the model writes one line in the
 * contract, which stays there to be argued with afterwards.
 *
 * Known looseness, on purpose: one pending `quién: Jarvis` row opens the lock
 * for every path, because a task row declares `specs:`, `test:`, `riesgo:` and
 * `commit:` — never files (D2). The alternative, a new `archivos:` field,
 * would make the model guess its own files before starting and be wrong often.
 * A loose lock that gets used beats a strict one that gets switched off, and
 * what it converts is the silence: an intervention is now written down. */

import { parseContractTasks } from "../contract/state.ts";
import { readContractTasks } from "../contract/tasks.ts";
import { inlineField } from "../contract/lint.ts";
import { isInside } from "../guard/paths.ts";
import { type AuthorityRequest, type Rule, WRITE_TOOLS } from "./rules.ts";

/** The owner of a task row, read through both spellings so a later move of the
 * contract's vocabulary to English does not invalidate the contracts already
 * written (D1). */
function ownerOf(row: string): string | undefined {
	return inlineField(row, "quién") ?? inlineField(row, "quien") ?? inlineField(row, "who");
}

function isJarvis(row: string): boolean {
	return (ownerOf(row) ?? "").trim().toLowerCase() === "jarvis";
}

/** The paths the session may always write, contract or no contract: the
 * contract it has to keep current, and the scratch space it owns. */
function alwaysWritable(path: string, request: AuthorityRequest): boolean {
	return path === request.contract?.path || isInside(path, request.scratch);
}

export const writeLock: Rule = {
	id: "jarvis.write-lock",
	check(request) {
		if (request.caller !== "session") return undefined;
		if (!WRITE_TOOLS.has(request.tool)) return undefined;
		const contract = request.contract;
		if (!contract) return undefined;

		// `done` is defined once, by the task reader, so this rule cannot drift
		// from the panel's idea of what is finished.
		const pending = readContractTasks(contract.text).filter((task) => !task.done);
		if (pending.length === 0) return undefined;

		const rows = new Map(parseContractTasks(contract.text).map((row) => [row.id, row.line]));
		if (pending.some((task) => isJarvis(rows.get(task.id) ?? ""))) return undefined;

		for (const path of request.paths) {
			if (alwaysWritable(path, request)) continue;
			if (!isInside(path, request.root)) continue;
			return path;
		}
		return undefined;
	},
};
