// S4 (estado-de-tareas): the harness records the task state on its own, from
// real events. Two halves, both observed from outside:
//
//   - the dispatch carries the task id as data (`contractTask` on the
//     `subagent_run` call), never deduced from prose (D4). A label that spells
//     "T1" must do nothing; the parameter is what writes.
//   - the writer turns the events into the file: `estado: en curso` when the
//     worker is dispatched, verified (or `fallada` / `por verificar`) when it
//     finishes — never taken on its word (S5/D7) — and `commit:` (the model's
//     field, S7) is never touched.
//
// The extension is driven against a fake Pi, the same shape
// contract-state-spike.test.ts and agents-breaker-extension.test.ts use, and
// every assertion reads the contract file on disk: that is the public
// interface here (D2).
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-task-state.ts";

// A subagent exports this and the extension then installs nothing; the guard
// trap of this repo. The test must not inherit it.
delete process.env.VIOLETA_AGENTS_CHILD;

const CONTRACT_PATH = "tasks/estado-de-tareas.md";

const CONTRACT = `# estado-de-tareas
Runner: node --test tests/task-events.test.ts

## Specs
S4. El harness registra solo.

## Tasks
T1. Enganchar los eventos reales — specs: S4 — test: required — riesgo: sí — commit: -
T2. Otra tarea abierta — specs: S4 — test: required — riesgo: no — commit: -
`;

type Handler = (event: unknown, ctx: unknown) => unknown;

interface Harness {
	handlers: Map<string, Handler[]>;
	ctx: { cwd: string };
	file: string;
}

/** A temp project whose only content is the contract file at the active path. */
function project(md: string | null = CONTRACT): Harness {
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-events-"));
	mkdirSync(join(dir, "tasks"), { recursive: true });
	const file = join(dir, CONTRACT_PATH);
	if (md !== null) writeFileSync(file, md);
	const handlers = new Map<string, Handler[]>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
	});
	return { handlers, ctx: { cwd: dir }, file };
}

async function fire(h: Harness, name: string, event: unknown): Promise<void> {
	for (const fn of h.handlers.get(name) ?? []) await fn(event, h.ctx);
}

/** A dispatch as the model writes it: the id, when there is one, is data. */
const dispatch = (extra: Record<string, unknown>) => ({ agent: "coder", task: "do the thing", label: "do the thing", ...extra });

async function call(h: Harness, input: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<void> {
	await fire(h, "tool_call", { type: "tool_call", toolName: "subagent_run", toolCallId: "c1", input, ...extra });
}

async function result(h: Harness, input: Record<string, unknown>, isError: boolean, extra: Record<string, unknown> = {}): Promise<void> {
	await fire(h, "tool_result", {
		type: "tool_result",
		toolName: "subagent_run",
		toolCallId: "c1",
		input,
		isError,
		content: [{ type: "text", text: isError ? "boom" : "done" }],
		...extra,
	});
}

const read = (h: Harness) => readFileSync(h.file, "utf8");

test("a dispatch that carries contractTask marks that row en curso", async () => {
	const h = project();
	await call(h, dispatch({ contractTask: 1 }));
	const md = read(h);
	assert.match(md, /^T1\..*— commit: - — estado: en curso$/m);
	// the neighbour row is untouched, and the model's field keeps its value
	assert.match(md, /^T2\..*— commit: -$/m);
});

test("a dispatch without contractTask does not touch the file", async () => {
	const h = project();
	const input = dispatch({ label: "T1 hacer la cosa", task: "cerrar T1 por favor" });
	await call(h, input);
	await result(h, input, false);
	await result(h, input, true);
	assert.equal(read(h), CONTRACT);
});

test("a worker that finishes well gets verified, not taken on its word", async () => {
	const h = project();
	const input = dispatch({ contractTask: 1 });
	await call(h, input);
	assert.match(read(h), /— estado: en curso/m);
	await result(h, input, false);
	// S5/D7: finishing is not being done. S4 in this fixture has no `Check:`,
	// so the harness asks for manual verification instead of clearing the row.
	assert.match(read(h), /^T1\..*— estado: por verificar$/m);
});

test("a worker that fails leaves estado: fallada on the row", async () => {
	const h = project();
	const input = dispatch({ contractTask: 1 });
	await call(h, input);
	await result(h, input, true);
	const md = read(h);
	assert.match(md, /^T1\..*— commit: - — estado: fallada$/m);
	assert.match(md, /^T2\..*— commit: -$/m);
});

test("the harness never writes the model's commit: field", async () => {
	const h = project();
	const input = dispatch({ contractTask: 1 });
	await call(h, input);
	await result(h, input, true);
	// only `estado:` moved; the done marker is still exactly what the model wrote
	assert.match(read(h), /— test: required — riesgo: sí — commit: - — estado: fallada/m);

	// the model then marks the task done with its own tool; the next dispatch
	// and the verification that follows it must preserve that edit byte for byte
	const edited = CONTRACT.replace("riesgo: sí — commit: -", "riesgo: sí — commit: 9f8e7d6");
	writeFileSync(h.file, edited);
	await call(h, dispatch({ contractTask: 1 }));
	await result(h, dispatch({ contractTask: 1 }), false);
	// S5/D7: the harness answers in its own field only. S4 has no `Check:` here,
	// so the row is left for manual verification and `commit:` is untouched.
	assert.match(read(h), /riesgo: sí — commit: 9f8e7d6 — estado: por verificar/m);
});

test("a nested call (parentToolCallId) is ignored", async () => {
	const h = project();
	const input = dispatch({ contractTask: 2 });
	await call(h, input, { toolCallId: "t9/1", parentToolCallId: "t9" });
	await result(h, input, true, { toolCallId: "t9/1", parentToolCallId: "t9" });
	assert.equal(read(h), CONTRACT);
});

test("a contractTask that is not an integer is not a task id", async () => {
	const h = project();
	await call(h, dispatch({ contractTask: "1" }));
	assert.equal(read(h), CONTRACT);
});

test("an unknown task id and a missing contract leave the world alone", async () => {
	const known = project();
	await call(known, dispatch({ contractTask: 9 }));
	assert.equal(read(known), CONTRACT);

	const missing = project(null);
	await call(missing, dispatch({ contractTask: 1 }));
	assert.equal(existsSync(missing.file), false);
});

test("only subagent_run dispatches write state", async () => {
	const h = project();
	await fire(h, "tool_call", { type: "tool_call", toolName: "bash", toolCallId: "c1", input: { command: "ls", contractTask: 1 } });
	await fire(h, "tool_result", { type: "tool_result", toolName: "bash", toolCallId: "c1", input: { command: "ls", contractTask: 1 }, isError: true, content: [] });
	assert.equal(read(h), CONTRACT);
});

test("subagent_run declares contractTask as an optional integer parameter", async () => {
	delete process.env.VIOLETA_AGENTS_CHILD;
	const prevDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "violeta-task-events-agents-"));
	const tools = new Map<string, { parameters?: { properties?: Record<string, { type?: string }>; required?: string[] } }>();
	try {
		const agents = (await import("../extensions/violeta-agents.ts")).default;
		(agents as unknown as (pi: unknown) => void)({
			on: () => {},
			registerTool: (tool: { name: string }) => tools.set(tool.name, tool as never),
			registerCommand: () => {},
			registerShortcut: () => {},
			registerMessageRenderer: () => {},
			sendMessage: () => {},
			getThinkingLevel: () => "medium",
		});
	} finally {
		if (prevDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prevDir;
	}
	const schema = tools.get("subagent_run")?.parameters;
	assert.equal(schema?.properties?.contractTask?.type, "integer");
	// most dispatches carry no contract task, so it must stay optional
	assert.equal(schema?.required?.includes("contractTask") ?? false, false);
});
