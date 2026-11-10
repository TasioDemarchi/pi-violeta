/** The one place that answers "is this allowed?".
 *
 * `decide` walks the rule table in order and returns the first refusal, so the
 * table's order IS the priority: the most specific rule goes first, and the
 * owner reads one reason instead of a list. An empty table allows everything,
 * which is what makes the framework testable before any rule exists.
 *
 * A rule that throws is a bug in the rule, not a reason to block the owner's
 * work: it is swallowed and treated as "this rule has no opinion". The harness
 * failing closed on its own defect would be worse than the behaviour it guards
 * against — the owner would be locked out of their own repo by a typo. */

import { type AuthorityRequest, type Decision, type Rule } from "./rules.ts";
import { testsReadonly } from "./tests-readonly.ts";
import { agentNoDelivery, agentNoSecrets, agentReadOnly, agentScratchOnly, criticContractOnly } from "./agent-scope.ts";
import { bashWrite, writeLock } from "./write-lock.ts";

/** The rules this harness ships, most specific first: a test write should be
 * refused as a test write, not as the generic lock.
 *
 * The agent rules come first because they bind a narrower caller — a `scout`
 * that writes is refused as a scout, not as a generic session lock that does
 * not even apply to it. */
export const RULES: readonly Rule[] = [
	agentNoSecrets,
	agentNoDelivery,
	agentReadOnly,
	agentScratchOnly,
	criticContractOnly,
	testsReadonly,
	writeLock,
	bashWrite,
];

export function decide(request: AuthorityRequest, rules: readonly Rule[] = RULES): Decision {
	for (const rule of rules) {
		let path: string | undefined;
		try {
			path = rule.check(request);
		} catch {
			continue;
		}
		if (path !== undefined) return { allowed: false, rule: rule.id, path };
	}
	return { allowed: true };
}
