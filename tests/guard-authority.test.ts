// S5 (authority): the guard applies the decision in the single `tool_call` it
// already owns. A refused write comes back as a blocked tool call whose reason
// names the rule id — the string to look up in the estatuto (D3) — and the
// concrete exit (D5). An allowed write takes the permission path of today.
//
// The guard reads VIOLETA_AGENTS_CHILD on every call: a suite started from
// inside a subagent would take the no-UI branch everywhere. This file asserts
// the session's behaviour, so it drops the variable explicitly and sets it back
// only in the one test that is about a subagent.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import guardExtension from "../extensions/violeta-guard.ts";

delete process.env.VIOLETA_AGENTS_CHILD;

type Handler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>;

function loadGuard(): Handler {
	let toolCall: Handler | undefined;
	guardExtension({
		on: (name: string, fn: Handler) => {
			if (name === "tool_call") toolCall = fn;
		},
		registerCommand: () => {},
	} as never);
	if (!toolCall) throw new Error("the guard extension did not register its tool_call handler");
	return toolCall;
}

const CONTRACT = (tasks: string) => `# demo
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

const PENDING = CONTRACT("T1. Pendiente. — specs: S1 — test: required — riesgo: no — commit: -");

/** A project on disk with its contract at the convention path. */
function project(contract: string | undefined): string {
	const root = mkdtempSync(join(tmpdir(), "violeta-authority-"));
	mkdirSync(join(root, "tasks"), { recursive: true });
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "tests"), { recursive: true });
	if (contract !== undefined) writeFileSync(join(root, "tasks", "estado-de-tareas.md"), contract);
	return root;
}

const ctxFor = (root: string) => ({
	cwd: root,
	hasUI: true,
	sessionManager: { getSessionId: () => "s-auth", getBranch: () => [] },
	ui: {
		select: async () => "Sí",
		confirm: async () => {
			throw new Error("the authority block must never open a dialog");
		},
		notify: () => {},
	},
});

test("a write into the project is blocked while the contract has pending work", async () => {
	const root = project(PENDING);
	const result = await loadGuard()({ toolName: "write", input: { path: join(root, "src", "thing.ts") } }, ctxFor(root));
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.write-lock/, "the reason names the rule id (D3)");
	assert.match(result!.reason!, /quién: Jarvis/, "and the declared exit (D5)");
});

test("a relative path is resolved before it is judged", async () => {
	const root = project(PENDING);
	const result = await loadGuard()({ toolName: "edit", input: { path: "src/thing.ts" } }, ctxFor(root));
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.write-lock/);
});

test("a write under tests/ is refused as a test write, not as the generic lock", async () => {
	const root = project(PENDING);
	const result = await loadGuard()({ toolName: "write", input: { path: join(root, "tests", "x.test.ts") } }, ctxFor(root));
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.tests-readonly/);
});

test("tests stay locked even with no contract at all", async () => {
	const root = project(undefined);
	const result = await loadGuard()({ toolName: "write", input: { path: join(root, "tests", "x.test.ts") } }, ctxFor(root));
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.tests-readonly/);
});

test("the contract itself stays writable: keeping it current is the job", async () => {
	const root = project(PENDING);
	const result = await loadGuard()({ toolName: "edit", input: { path: join(root, "tasks", "estado-de-tareas.md") } }, ctxFor(root));
	assert.equal(result, undefined);
});

test("with no contract on disk a source write passes", async () => {
	const root = project(undefined);
	const result = await loadGuard()({ toolName: "write", input: { path: join(root, "src", "thing.ts") } }, ctxFor(root));
	assert.equal(result, undefined);
});

test("a declared `quién: Jarvis` task lets the write through", async () => {
	const root = project(CONTRACT("T1. Spike con credenciales. — specs: S1 — test: n/a — riesgo: sí — quién: Jarvis — commit: -"));
	const result = await loadGuard()({ toolName: "write", input: { path: join(root, "src", "thing.ts") } }, ctxFor(root));
	assert.equal(result, undefined);
});

test("reading is never touched by the authority", async () => {
	const root = project(PENDING);
	const result = await loadGuard()({ toolName: "read", input: { path: join(root, "src", "thing.ts") } }, ctxFor(root));
	assert.equal(result, undefined);
});

test("a subagent is not bound by either rule (D4)", async () => {
	const root = project(PENDING);
	process.env.VIOLETA_AGENTS_CHILD = "1";
	try {
		const guard = loadGuard();
		assert.equal(await guard({ toolName: "write", input: { path: join(root, "src", "thing.ts") } }, ctxFor(root)), undefined);
		assert.equal(await guard({ toolName: "write", input: { path: join(root, "tests", "x.test.ts") } }, ctxFor(root)), undefined);
	} finally {
		delete process.env.VIOLETA_AGENTS_CHILD;
	}
});
