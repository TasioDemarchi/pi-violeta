// S2 (authority): the pure decision behind every harness-enforced rule.
// It receives the tool, the resolved paths, who is calling and the active
// contract's text, and answers allowed or blocked. It never touches the
// filesystem, a terminal or a model: the extension reads the file and resolves
// the paths, this module only decides. The rule table is injectable so the
// framework can be tested without depending on which rules ship today.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/authority/decide.ts";
import type { AuthorityRequest, Rule } from "../src/authority/rules.ts";

const ROOT = "/home/u/proj";

const OPEN_CONTRACT = `# demo
Runner: npm test

## No-objetivos
- nada

## Specs
S1. Algo.
    Accept: se ve
    Check: npm test

## Tasks
T1. Pendiente. — specs: S1 — test: required — riesgo: no — commit: -

## Log
L1. "lo pedí yo"
`;

function request(over: Partial<AuthorityRequest> = {}): AuthorityRequest {
	return {
		tool: "write",
		caller: "session",
		paths: [`${ROOT}/src/thing.ts`],
		root: ROOT,
		scratch: `${ROOT}/.violeta/scratch`,
		contract: { path: `${ROOT}/tasks/demo.md`, text: OPEN_CONTRACT },
		...over,
	};
}

/** A rule that always blocks, to exercise the framework without the real ones. */
const always: Rule = { id: "jarvis.write-lock", check: (r) => r.paths[0] };
/** A rule that never blocks. */
const never: Rule = { id: "jarvis.tests-readonly", check: () => undefined };

test("a rule that blocks returns its id and the offending path", () => {
	const decision = decide(request(), [always]);
	assert.equal(decision.allowed, false);
	assert.equal(decision.allowed === false && decision.rule, "jarvis.write-lock");
	assert.equal(decision.allowed === false && decision.path, `${ROOT}/src/thing.ts`);
});

test("with no rule blocking, the request is allowed", () => {
	assert.deepEqual(decide(request(), [never]), { allowed: true });
});

test("the first rule that blocks wins, so the table's order is the priority", () => {
	const first: Rule = { id: "jarvis.tests-readonly", check: () => "/a" };
	const second: Rule = { id: "jarvis.write-lock", check: () => "/b" };
	const decision = decide(request(), [first, second]);
	assert.equal(decision.allowed === false && decision.rule, "jarvis.tests-readonly");
});

test("an empty table allows everything: no rule, no block", () => {
	assert.deepEqual(decide(request(), []), { allowed: true });
});

test("a call with no paths is allowed even by a rule that blocks on sight", () => {
	assert.deepEqual(decide(request({ paths: [] }), [always]), { allowed: true });
});

test("a contract that is not a contract decides instead of throwing", () => {
	const junk = request({ contract: { path: `${ROOT}/tasks/demo.md`, text: "\u0000 not markdown" } });
	assert.doesNotThrow(() => decide(junk, [never]));
	assert.deepEqual(decide(junk, [never]), { allowed: true });
});

test("no active contract is a valid state, not an error", () => {
	const none = request({ contract: undefined });
	assert.deepEqual(decide(none, [never]), { allowed: true });
});
