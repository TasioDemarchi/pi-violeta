/** `jarvis.contract-frozen` — once the owner approved a contract, nobody
 * rewrites what they approved without asking them again.
 *
 * Why it is a rule and not a sentence: "a change of requirement goes back to
 * the contract, with the user" was already in jarvis.md §3, and on 2026-11-15
 * a Jarvis refused by the write lock added "— quién: Jarvis" to an approved row
 * and built the task itself. The contract was the one file the lock always let
 * through, so the declared exit (D5, tasks/authority.md) could be declared
 * after the fact.
 *
 * What is frozen and what stays open is defined once, in
 * `src/contract/approval.ts`. The rule only compares: the frozen view the owner
 * approved (`request.approved`, replayed from the session) against the frozen
 * view of the text the write would leave (`request.contractAfter`). A shell
 * write to the contract is refused outright: its result is not in its
 * arguments, and `edit` does the same job in a form the harness can read.
 *
 * The exit is never a line the model writes: it is `contract_approve`, which
 * asks the owner in a dialog. */

import { frozenView } from "../contract/approval.ts";
import { SHELL_COMMAND_TOOLS } from "../guard/command-guard.ts";
import type { Rule, RuleId } from "./rules.ts";

export const contractFrozen: Rule = {
	id: "jarvis.contract-frozen" satisfies RuleId,
	check(request) {
		const contract = request.contract;
		if (!contract || request.approved === undefined) return undefined;
		if (!request.paths.includes(contract.path)) return undefined;
		if (SHELL_COMMAND_TOOLS.has(request.tool)) return contract.path;
		const after = request.contractAfter;
		if (after === undefined) return contract.path;
		return frozenView(after) === request.approved ? undefined : contract.path;
	},
};
