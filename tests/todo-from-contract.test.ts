// S3 (estado-de-tareas): the Todo panel is a view of the active contract, not
// a second list the model has to keep current. The panel extension is driven
// against a fake Pi (same shape as contract-state-spike.test.ts /
// ui-extension-smoke.test.ts) and every assertion reads what the panel
// publishes to the shared hub — never an internal.
//
// The contract path is spelled out here on purpose: `tasks/<name>.md` is the
// convention T5 rides on, so the test and the extension must agree on the file
// the panel watches. T9 owns "which contract is active".
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTaskStatus } from "../src/contract/state.ts";
import { getShared } from "../src/shared-hub.ts";
import extension from "../extensions/violeta-todo.ts";

// A subagent exports this and the extension then installs nothing; the guard
// trap of this repo. The test must not inherit it.
delete process.env.VIOLETA_AGENTS_CHILD;

const CONTRACT_PATH = "tasks/estado-de-tareas.md";

const CONTRACT = `# estado-de-tareas
Runner: node --test tests/todo-from-contract.test.ts

## Specs
S3. El panel Todo es una vista del contrato activo.

## Tasks
T1. Derivar el panel del contrato — specs: S3 — test: required — riesgo: no — commit: -
T2. Escritor ya cerrado — specs: S7 — test: required — riesgo: sí — commit: e3a2621
`;

type Handler = (event: unknown, ctx: unknown) => unknown;
type ToolExecute = (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;

interface Harness {
	handlers: Map<string, Handler[]>;
	tools: Map<string, { execute: ToolExecute }>;
	ctx: { cwd: string; mode: string; hasUI: boolean; sessionManager: { getBranch: () => unknown[] } };
}

/** A temp project whose only content is (maybe) the contract file. */
function project(md?: string): string {
	const dir = mkdtempSync(join(tmpdir(), "violeta-todo-from-contract-"));
	mkdirSync(join(dir, dirname(CONTRACT_PATH)), { recursive: true });
	if (md !== undefined) writeFileSync(join(dir, CONTRACT_PATH), md);
	return dir;
}

function setup(cwd: string): Harness {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, { execute: ToolExecute }>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		registerTool: (definition: { name: string; execute: ToolExecute }) => tools.set(definition.name, definition),
		registerCommand: () => {},
		appendEntry: () => {},
	});
	return {
		handlers,
		tools,
		ctx: { cwd, mode: "json", hasUI: false, sessionManager: { getBranch: () => [] } },
	};
}

async function fire(h: Harness, name: string, event: unknown): Promise<void> {
	for (const fn of h.handlers.get(name) ?? []) await fn(event, h.ctx);
}

/** The panel's list as the hub has it: `[id, title, status]` per row. */
function panelRows(): Array<[number, string, string]> {
	return (getShared().todoState?.tasks ?? []).map((task) => [task.id, task.title, task.status]);
}

/** Wait until the panel catches up with the file (the derivation is not
 * triggered by a tool call, so it lands on the extension's own tick). */
async function waitFor(check: () => boolean, ms = 2_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return check();
}

async function withPanel<T>(dir: string, body: (h: Harness) => Promise<T>): Promise<T> {
	const h = setup(dir);
	await fire(h, "session_start", { type: "session_start", reason: "startup" });
	try {
		return await body(h);
	} finally {
		// stops the extension's tick so one test's panel cannot leak into the next
		await fire(h, "session_shutdown", { type: "session_shutdown", reason: "quit" });
	}
}

test("with a contract, the panel is derived from the file on start", async () => {
	const dir = project(CONTRACT);
	await withPanel(dir, async () => {
		assert.deepEqual(panelRows(), [
			[1, "Derivar el panel del contrato", "pending"],
			[2, "Escritor ya cerrado", "done"],
		]);
	});
});

test("with a contract, changing `commit:` in the file marks the row done with no tool call", async () => {
	const dir = project(CONTRACT);
	await withPanel(dir, async (h) => {
		assert.equal(panelRows()[0]?.[2], "pending");
		// The model edits the field it owns, with its editor. No todo call, no
		// dispatch: only the file changes.
		writeFileSync(join(dir, CONTRACT_PATH), CONTRACT.replace("riesgo: no — commit: -", "riesgo: no — commit: 9f8e7d6"));
		assert.ok(await waitFor(() => panelRows()[0]?.[2] === "done"), `panel did not follow the file: ${JSON.stringify(panelRows())}`);
		// the tool exists but was never used to get there
		assert.equal(h.tools.has("todo"), true);
	});
});

test("the harness's `estado: en curso` shows up as in_progress", async () => {
	const dir = project(setTaskStatus(CONTRACT, 1, "en curso"));
	await withPanel(dir, async () => {
		assert.deepEqual(panelRows(), [
			[1, "Derivar el panel del contrato", "in_progress"],
			[2, "Escritor ya cerrado", "done"],
		]);
	});
});

test("without a contract file the panel keeps the list the model maintains", async () => {
	const dir = project();
	await withPanel(dir, async (h) => {
		await h.tools.get("todo")!.execute(
			"c1",
			{ action: "write", tasks: [{ title: "Write the parser" }, { title: "Run tests", status: "in_progress" }] },
			undefined,
			undefined,
			h.ctx,
		);
		assert.deepEqual(panelRows(), [
			[1, "Write the parser", "pending"],
			[2, "Run tests", "in_progress"],
		]);
	});
});

test("a contract without `## Tasks` also leaves the model's list alone", async () => {
	const dir = project("# otro\nRunner: none\n\n## Specs\nS1. algo\n");
	await withPanel(dir, async (h) => {
		await h.tools.get("todo")!.execute("c1", { action: "add", title: "Solo del modelo" }, undefined, undefined, h.ctx);
		assert.deepEqual(panelRows(), [[1, "Solo del modelo", "pending"]]);
	});
});

test("while a contract is active the todo tool does not replace the panel's view", async () => {
	const dir = project(CONTRACT);
	await withPanel(dir, async (h) => {
		const result = (await h.tools.get("todo")!.execute("c1", { action: "add", title: "Lista paralela" }, undefined, undefined, h.ctx)) as {
			content: Array<{ text: string }>;
		};
		// the tool still answers as it always did: its own list, its own text
		assert.match(result.content[0]!.text, /Lista paralela/);
		// but the panel keeps showing the contract: one derivation, not two
		assert.deepEqual(panelRows(), [
			[1, "Derivar el panel del contrato", "pending"],
			[2, "Escritor ya cerrado", "done"],
		]);
	});
});
