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

// --- S4 (authority-bash): the same door over the shell -----------------------
// The authority answers before the destructive dialog, so a refused command
// never opens one: the owner is not woken up for something the model can fix
// by writing one line in the contract.

test("a redirection into the project is blocked, and no dialog is opened", async () => {
	const root = project(PENDING);
	const ctx = ctxFor(root);
	let asked = 0;
	ctx.ui.select = async () => {
		asked++;
		return "Sí";
	};
	const result = await loadGuard()({ toolName: "bash", input: { command: `echo hola > ${join(root, "src", "x.ts")}` } }, ctx);
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.bash-write/);
	assert.match(result!.reason!, /quién: Jarvis/);
	assert.equal(asked, 0, "the authority must refuse before the destructive dialog");
});

test("`sed -i` over a source file is blocked", async () => {
	const root = project(PENDING);
	const result = await loadGuard()({ toolName: "bash", input: { command: `sed -i 's/a/b/' ${join(root, "src", "x.ts")}` } }, ctxFor(root));
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.bash-write/);
});

test("a test weakened by shell is refused as a test write, with no contract", async () => {
	const root = project(undefined);
	const result = await loadGuard()({ toolName: "bash", input: { command: `sed -i 's/assert//' ${join(root, "tests", "x.test.ts")}` } }, ctxFor(root));
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.tests-readonly/);
});

test("the verification commands still run with the contract open", async () => {
	const root = project(PENDING);
	const guard = loadGuard();
	for (const command of ["npm test 2>&1 | tail -9", "git status --short", "node --test tests/x.test.ts", "cat src/x.ts"]) {
		assert.equal(await guard({ toolName: "bash", input: { command } }, ctxFor(root)), undefined, command);
	}
});

test("a subagent's shell is not bound either", async () => {
	const root = project(PENDING);
	process.env.VIOLETA_AGENTS_CHILD = "1";
	try {
		const result = await loadGuard()({ toolName: "bash", input: { command: `echo x > ${join(root, "src", "x.ts")}` } }, ctxFor(root));
		assert.equal(result, undefined);
	} finally {
		delete process.env.VIOLETA_AGENTS_CHILD;
	}
});

// --- S6 (authority-agents): el alcance de cada agente ------------------------
// El guard corre DENTRO del hijo, así que lee del entorno quién es. Cada test
// pone las dos variables y las saca, porque la suite entera depende de que
// VIOLETA_AGENTS_CHILD no quede puesta (la trampa de AGENTS.md).

async function comoAgente(agente: string, event: unknown, root: string) {
	process.env.VIOLETA_AGENTS_CHILD = "1";
	process.env.VIOLETA_AGENT_NAME = agente;
	try {
		return await loadGuard()(event, ctxFor(root));
	} finally {
		delete process.env.VIOLETA_AGENTS_CHILD;
		delete process.env.VIOLETA_AGENT_NAME;
	}
}

for (const agente of ["scout", "judge"]) {
	test(`${agente} no escribe por shell: su prosa ya lo decía`, async () => {
		const root = project(undefined);
		const result = await comoAgente(agente, { toolName: "bash", input: { command: `echo roto > ${join(root, "src", "x.ts")}` } }, root);
		assert.equal(result?.block, true);
		assert.match(result!.reason!, /agent\.read-only/);
	});

	test(`${agente} mira sin trabas`, async () => {
		const root = project(undefined);
		assert.equal(await comoAgente(agente, { toolName: "bash", input: { command: "git log --oneline -5" } }, root), undefined);
		assert.equal(await comoAgente(agente, { toolName: "read", input: { path: join(root, "src", "x.ts") } }, root), undefined);
	});
}

test("tester escribe en scratch y en ningún otro lado", async () => {
	const root = project(undefined);
	assert.equal(await comoAgente("tester", { toolName: "write", input: { path: join(root, ".violeta", "scratch", "probe", "informe.md") } }, root), undefined);
	const fuera = await comoAgente("tester", { toolName: "write", input: { path: join(root, "src", "x.ts") } }, root);
	assert.equal(fuera?.block, true);
	assert.match(fuera!.reason!, /agent\.scratch-only/);
});

test("critic lee el contrato, no el repositorio", async () => {
	const root = project(PENDING);
	assert.equal(await comoAgente("critic", { toolName: "read", input: { path: join(root, "tasks", "estado-de-tareas.md") } }, root), undefined);
	const repo = await comoAgente("critic", { toolName: "read", input: { path: join(root, "src", "x.ts") } }, root);
	assert.equal(repo?.block, true);
	assert.match(repo!.reason!, /critic\.contract-only/);
});

test("builder sigue sin ataduras nuevas: su alcance es otra deuda (D2)", async () => {
	const root = project(PENDING);
	assert.equal(await comoAgente("builder", { toolName: "write", input: { path: join(root, "src", "x.ts") } }, root), undefined);
	assert.equal(await comoAgente("builder", { toolName: "bash", input: { command: `echo x > ${join(root, "src", "x.ts")}` } }, root), undefined);
});

test("un subagente sin nombre no cae en ninguna regla de agente", async () => {
	const root = project(undefined);
	process.env.VIOLETA_AGENTS_CHILD = "1";
	try {
		assert.equal(await loadGuard()({ toolName: "write", input: { path: join(root, "src", "x.ts") } }, ctxFor(root)), undefined);
	} finally {
		delete process.env.VIOLETA_AGENTS_CHILD;
	}
});
