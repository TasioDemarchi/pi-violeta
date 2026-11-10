/** `jarvis.tests-readonly` — the session the owner talks to never writes under
 * `tests/`.
 *
 * AGENTS.md's hardest rule is "if an existing test goes red, stop and report —
 * never weaken it to get green", and it lived only in prose. In the measured
 * window the session wrote seven test files by hand, among them the migration
 * of a spike's test during a task a builder had handed off.
 *
 * Absolute on purpose: no contract state, no `quién: Jarvis` escape. A test is
 * the only thing that says the code works, so the one who wrote the code must
 * never be the one who moves the goalposts. The exit is not a field, it is
 * delegation — writing a test is a builder's task — which is why this rule
 * needs no declaration to stay honest.
 *
 * It goes first in the table: it is the more specific of the two, and the
 * owner should read this reason rather than the generic lock. */

import { join } from "node:path";
import { isInside } from "../guard/paths.ts";
import { SHELL_COMMAND_TOOLS } from "../guard/command-guard.ts";
import { type Rule, WRITE_TOOLS } from "./rules.ts";

export const testsReadonly: Rule = {
	id: "jarvis.tests-readonly",
	check(request) {
		if (request.caller !== "session") return undefined;
		// Both doors: weakening a test with `sed -i` is the same act as
		// weakening it with `edit`.
		if (!WRITE_TOOLS.has(request.tool) && !SHELL_COMMAND_TOOLS.has(request.tool)) return undefined;
		// `isInside` demands a separator, so `testsuite/` and `tests-helper.ts`
		// are not the test folder.
		const tests = join(request.root, "tests");
		return request.paths.find((path) => isInside(path, tests));
	},
};
