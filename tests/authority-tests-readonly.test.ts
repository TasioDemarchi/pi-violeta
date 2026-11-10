// S4 (authority): `jarvis.tests-readonly`. The session the owner talks to never
// writes under `tests/`. AGENTS.md's hardest rule — "if an existing test goes
// red, stop and report, never weaken it to get green" — lived only in prose,
// and the session wrote seven test files by hand during the measured window.
//
// This one is absolute: no contract state, no declared escape. The exit is not
// a field, it is delegation — a test is a builder's task. The session that
// wrote the code must never be the one that moves the goalposts.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/authority/decide.ts";
import { testsReadonly } from "../src/authority/tests-readonly.ts";
import type { AuthorityRequest } from "../src/authority/rules.ts";

const ROOT = "/home/u/proj";

function request(over: Partial<AuthorityRequest> = {}): AuthorityRequest {
	return {
		tool: "write",
		caller: "session",
		paths: [`${ROOT}/tests/thing.test.ts`],
		root: ROOT,
		scratch: `${ROOT}/.violeta/scratch`,
		...over,
	};
}

const run = (over?: Partial<AuthorityRequest>) => decide(request(over), [testsReadonly]);

test("the session may not write a test file", () => {
	const decision = run();
	assert.equal(decision.allowed, false);
	assert.equal(decision.allowed === false && decision.rule, "jarvis.tests-readonly");
	assert.equal(decision.allowed === false && decision.path, `${ROOT}/tests/thing.test.ts`);
});

test("`edit` is locked too: weakening an existing test is the case that matters", () => {
	assert.equal(run({ tool: "edit" }).allowed, false);
});

test("a test in a subdirectory is still a test", () => {
	assert.equal(run({ paths: [`${ROOT}/tests/guard/paths.test.ts`] }).allowed, false);
});

test("with no contract open the rule still holds: it has no state", () => {
	assert.equal(run({ contract: undefined }).allowed, false);
});

test("a builder writes its own tests: a subagent is not bound", () => {
	assert.deepEqual(run({ caller: "subagent" }), { allowed: true });
});

test("a tool that reads is never bound: it produces no written path", () => {
	for (const tool of ["read", "grep", "find", "ls"]) {
		assert.deepEqual(run({ tool }), { allowed: true }, tool);
	}
});

// `paths` means "what this call would WRITE", so a shell tool only arrives here
// carrying a test file when the command actually writes it (`writePaths` works
// that out from the command). Reading a test with `cat` yields no path at all
// and never reaches a rule; writing one with `sed -i` is the same act as `edit`.
test("the shell is bound too: a test written by command is still a test write", () => {
	const decision = run({ tool: "bash" });
	assert.equal(decision.allowed, false);
	assert.equal(decision.allowed === false && decision.rule, "jarvis.tests-readonly");
});

test("a directory that merely starts with `tests` is not the test folder", () => {
	assert.deepEqual(run({ paths: [`${ROOT}/testsuite/x.ts`] }), { allowed: true });
});

test("a source file whose name starts with `tests` is source", () => {
	assert.deepEqual(run({ paths: [`${ROOT}/src/tests-helper.ts`] }), { allowed: true });
});

test("another project's `tests/` is not this project's", () => {
	assert.deepEqual(run({ paths: ["/home/u/otro/tests/x.test.ts"] }), { allowed: true });
});

test("among several paths, the test file is the one reported", () => {
	const decision = run({ paths: [`${ROOT}/src/a.ts`, `${ROOT}/tests/a.test.ts`] });
	assert.equal(decision.allowed === false && decision.path, `${ROOT}/tests/a.test.ts`);
});
