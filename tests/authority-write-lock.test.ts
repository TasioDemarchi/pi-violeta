// S3 (authority): `jarvis.write-lock`. With a contract open and work still
// pending, the session the owner talks to does not write the project's files.
// Measured 10/11/2026: Jarvis wrote code 51 times against 30 builder runs, 34
// of those onto files a builder was already working, and closed four tasks of
// `estado-de-tareas.md` itself after a budget handoff. Every guardrail in §4
// of the philosophy is written about a `worker`, so none of them applied.
//
// The escape is declared, never silent (D5): a task row that says
// `— quién: Jarvis` is field work the subagents cannot reach, and it unlocks.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/authority/decide.ts";
import { writeLock } from "../src/authority/write-lock.ts";
import type { AuthorityRequest } from "../src/authority/rules.ts";

const ROOT = "/home/u/proj";
const CONTRACT_PATH = `${ROOT}/tasks/demo.md`;

function contract(tasks: string): string {
	return `# demo
Runner: npm test

## No-objetivos
- nada

## Specs
S1. Algo.
    Accept: se ve
    Check: npm test

## Tasks
${tasks}

## Log
L1. "lo pedí yo"
`;
}

const PENDING = contract("T1. Pendiente. — specs: S1 — test: required — riesgo: no — commit: -");
const DONE = contract("T1. Lista. — specs: S1 — test: required — riesgo: no — commit: 9f8e7d6");

function request(over: Partial<AuthorityRequest> = {}): AuthorityRequest {
	return {
		tool: "write",
		caller: "session",
		paths: [`${ROOT}/src/thing.ts`],
		root: ROOT,
		scratch: `${ROOT}/.violeta/scratch`,
		contract: { path: CONTRACT_PATH, text: PENDING },
		...over,
	};
}

const blocked = (over?: Partial<AuthorityRequest>) => decide(request(over), [writeLock]);

test("with a task still pending, the session may not write a project file", () => {
	const decision = blocked();
	assert.equal(decision.allowed, false);
	assert.equal(decision.allowed === false && decision.rule, "jarvis.write-lock");
	assert.equal(decision.allowed === false && decision.path, `${ROOT}/src/thing.ts`);
});

test("`edit` is locked too, not only `write`", () => {
	assert.equal(blocked({ tool: "edit" }).allowed, false);
});

test("the contract itself is always writable: keeping it current is the job", () => {
	assert.deepEqual(blocked({ paths: [CONTRACT_PATH] }), { allowed: true });
});

test("scratch is the model's own space and stays open", () => {
	assert.deepEqual(blocked({ paths: [`${ROOT}/.violeta/scratch/probe/informe.md`] }), { allowed: true });
});

test("a declared `quién: Jarvis` task unlocks the write", () => {
	const field = contract("T1. Spike con credenciales reales. — specs: S1 — test: n/a — riesgo: sí — quién: Jarvis — commit: -");
	assert.deepEqual(blocked({ contract: { path: CONTRACT_PATH, text: field } }), { allowed: true });
});

test("the English spelling `who: Jarvis` unlocks the same way (D1)", () => {
	const field = contract("T1. Spike. — specs: S1 — test: n/a — riesgo: sí — who: Jarvis — commit: -");
	assert.deepEqual(blocked({ contract: { path: CONTRACT_PATH, text: field } }), { allowed: true });
});

test("a `quién: Jarvis` task already done unlocks nothing: the escape is for pending work", () => {
	const closed = contract("T1. Spike. — specs: S1 — test: n/a — riesgo: sí — quién: Jarvis — commit: 9f8e7d6\nT2. Otra. — specs: S1 — test: required — riesgo: no — commit: -");
	assert.equal(blocked({ contract: { path: CONTRACT_PATH, text: closed } }).allowed, false);
});

test("`quién:` naming anyone else does not unlock", () => {
	const other = contract("T1. Algo. — specs: S1 — test: n/a — riesgo: no — quién: builder — commit: -");
	assert.equal(blocked({ contract: { path: CONTRACT_PATH, text: other } }).allowed, false);
});

test("with every task done the contract is closed and the lock lifts", () => {
	assert.deepEqual(blocked({ contract: { path: CONTRACT_PATH, text: DONE } }), { allowed: true });
});

test("with no active contract there is nothing to protect", () => {
	assert.deepEqual(blocked({ contract: undefined }), { allowed: true });
});

test("a subagent is not bound: it has ceilings, a tool scope and a verifier (D4)", () => {
	assert.deepEqual(blocked({ caller: "subagent" }), { allowed: true });
});

test("reading is never locked", () => {
	for (const tool of ["read", "grep", "find", "ls", "bash"]) {
		assert.deepEqual(blocked({ tool }), { allowed: true }, tool);
	}
});

test("a path outside the project root is the grant system's business, not this rule's", () => {
	assert.deepEqual(blocked({ paths: ["/home/u/notes/diario.md"] }), { allowed: true });
});

test("a contract with no `## Tasks` section locks nothing", () => {
	const empty = `# demo\nRunner: npm test\n\n## Log\nL1. "x"\n`;
	assert.deepEqual(blocked({ contract: { path: CONTRACT_PATH, text: empty } }), { allowed: true });
});

test("several paths at once: the first refused is the one reported", () => {
	const decision = blocked({ paths: [CONTRACT_PATH, `${ROOT}/src/a.ts`, `${ROOT}/src/b.ts`] });
	assert.equal(decision.allowed === false && decision.path, `${ROOT}/src/a.ts`);
});
