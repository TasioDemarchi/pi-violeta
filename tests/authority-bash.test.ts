// S3 (authority-bash): `jarvis.bash-write`. The same lock as `jarvis.write-lock`,
// over the other door. It judges the paths the command would write — which
// `bash-writes.ts` works out — so the question it answers is identical and only
// the id and the tool differ: the owner must be able to tell a refused `sed -i`
// from a refused `edit` by reading the reason.
//
// `tests/` keeps its own rule over the shell too: weakening a test with `sed -i`
// is the same act as weakening it with `edit`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/authority/decide.ts";
import { bashWrite } from "../src/authority/write-lock.ts";
import { testsReadonly } from "../src/authority/tests-readonly.ts";
import { writePaths } from "../src/authority/request.ts";
import type { AuthorityRequest } from "../src/authority/rules.ts";

const ROOT = "/home/u/proj";
const HOME = "/home/u";
const CONTRACT_PATH = `${ROOT}/tasks/demo.md`;

const contract = (tasks: string) => `# demo
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

const PENDING = contract("T1. Pendiente. — specs: S1 — test: required — riesgo: no — commit: -");

/** A bash request whose paths come from the real detector, as the guard builds it. */
function bash(command: string, over: Partial<AuthorityRequest> = {}): AuthorityRequest {
	return {
		tool: "bash",
		caller: "session",
		paths: writePaths("bash", { command }, ROOT, HOME),
		root: ROOT,
		scratch: `${ROOT}/.violeta/scratch`,
		contract: { path: CONTRACT_PATH, text: PENDING },
		...over,
	};
}

const run = (command: string, over?: Partial<AuthorityRequest>) => decide(bash(command, over), [testsReadonly, bashWrite]);

test("a redirection into the project is refused while work is pending", () => {
	const decision = run("echo hola > src/x.ts");
	assert.equal(decision.allowed, false);
	assert.equal(decision.allowed === false && decision.rule, "jarvis.bash-write");
	assert.equal(decision.allowed === false && decision.path, `${ROOT}/src/x.ts`);
});

test("`sed -i` over a source file is refused", () => {
	assert.equal(run("sed -i 's/a/b/' src/x.ts").allowed, false);
});

test("a heredoc into a source file is refused", () => {
	assert.equal(run("cat > src/x.ts <<'EOF'\nhola\nEOF").allowed, false);
});

test("`bash_background` and `monitor` are the same door", () => {
	for (const tool of ["bash_background", "monitor"]) {
		assert.equal(run("echo x > src/x.ts", { tool, paths: writePaths(tool, { command: "echo x > src/x.ts" }, ROOT, HOME) }).allowed, false, tool);
	}
});

test("the verification commands the orchestrator must keep running pass", () => {
	for (const command of ["npm test 2>&1 | tail -9", "git status --short", "node --test tests/x.test.ts", "grep -rn 'a' src/", "cat src/x.ts"]) {
		assert.deepEqual(run(command), { allowed: true }, command);
	}
});

test("writing the contract itself is the job, not a violation", () => {
	assert.deepEqual(run(`echo x > ${CONTRACT_PATH}`), { allowed: true });
});

test("scratch stays open over the shell too", () => {
	assert.deepEqual(run("echo x > .violeta/scratch/nota.md"), { allowed: true });
});

test("a declared `quién: Jarvis` task opens this door as well", () => {
	const field = contract("T1. Spike. — specs: S1 — test: n/a — riesgo: sí — quién: Jarvis — commit: -");
	assert.deepEqual(run("sed -i 's/a/b/' src/x.ts", { contract: { path: CONTRACT_PATH, text: field } }), { allowed: true });
});

test("outside the project it is the grant system's business", () => {
	assert.deepEqual(run("echo x > /tmp/out"), { allowed: true });
});

test("with every task done the lock lifts", () => {
	const done = contract("T1. Lista. — specs: S1 — test: required — riesgo: no — commit: 9f8e7d6");
	assert.deepEqual(run("echo x > src/x.ts", { contract: { path: CONTRACT_PATH, text: done } }), { allowed: true });
});

test("a subagent is not bound (D4)", () => {
	assert.deepEqual(run("sed -i 's/a/b/' src/x.ts", { caller: "subagent" }), { allowed: true });
});

test("a test weakened by shell is refused as a test write, with no contract needed", () => {
	const decision = run("sed -i 's/assert/\\/\\/assert/' tests/x.test.ts", { contract: undefined });
	assert.equal(decision.allowed, false);
	assert.equal(decision.allowed === false && decision.rule, "jarvis.tests-readonly");
});

test("writePaths gives the file tools their own paths and ignores a read", () => {
	assert.deepEqual(writePaths("write", { path: "src/x.ts" }, ROOT, HOME), [`${ROOT}/src/x.ts`]);
	assert.deepEqual(writePaths("edit", { path: `${ROOT}/src/x.ts` }, ROOT, HOME), [`${ROOT}/src/x.ts`]);
	assert.deepEqual(writePaths("read", { path: "src/x.ts" }, ROOT, HOME), []);
	assert.deepEqual(writePaths("grep", { path: "src/" }, ROOT, HOME), []);
});
