// S8 (estado-de-tareas): the session knows which contract is active, and still
// knows it after `/compact` and after resuming.
//
// The active contract is session state, not a constant: the model names a
// contract once — `contract_check` passing the lint is that moment — the session
// records it as a custom entry on the branch, and every consumer reads it from
// there: the Todo panel, the writer of `estado:` rows, and the verifier behind
// it. After a compaction the branch is replayed, so the panel still shows the
// same contract without the model naming it again.
//
// Driven through the extensions against a fake Pi whose branch behaves like the
// real one (`appendEntry` appends, `getBranch` reads). Every assertion is
// observable: the rows the panel publishes to the shared hub, and the contract
// file on disk. The fallback is asserted too: with no contract adopted the panel
// behaves exactly as it did for S3.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ACTIVE_CONTRACT_ENTRY_TYPE, DEFAULT_CONTRACT, activeContract, replayActiveContract } from "../src/contract/active.ts";
import { getShared } from "../src/shared-hub.ts";
import contractExtension from "../extensions/violeta-contract.ts";
import taskStateExtension from "../extensions/violeta-task-state.ts";
import todoExtension from "../extensions/violeta-todo.ts";

// A subagent exports this and the extensions then install nothing; the guard
// trap of this repo. The test must not inherit it.
delete process.env.VIOLETA_AGENTS_CHILD;

const OTHER_PATH = "tasks/otro-contrato.md";

/** A contract that passes the lint, with one task whose title is unmistakable. */
function contract(name: string, task: string): string {
	return `# ${name}
El panel muestra este contrato cuando la sesión lo adopta.
Runner: node --test tests/active-contract.test.ts
Externo: no

## No-objetivos
- Ninguno: este archivo existe para el test.

## Specs
S1. El contrato tiene una tarea legible.
    Accept: el panel muestra la fila de T1.
    Check: manual: mirar el panel

## Tasks
T1. ${task} — specs: S1 — test: n/a — riesgo: no — commit: -

## Log
L1. Adoptá este contrato.
`;
}

const DEFAULT_MD = contract("estado-de-tareas", "Fila del contrato por defecto");
const OTHER_MD = contract("otro-contrato", "Fila del otro contrato");
const DEFAULT_TITLE = "Fila del contrato por defecto";
const OTHER_TITLE = "Fila del otro contrato";

type Handler = (event: unknown, ctx: unknown) => unknown;
type ToolExecute = (id: string, params: unknown, signal: unknown, onUpdate: unknown, ctx: unknown) => Promise<unknown>;

interface Harness {
	handlers: Map<string, Handler[]>;
	tools: Map<string, { execute: ToolExecute; parameters?: unknown }>;
	/** The session branch: what `appendEntry` appends and `getBranch` replays. */
	branch: unknown[];
	ctx: { cwd: string; mode: string; hasUI: boolean; sessionManager: { getBranch: () => unknown[] } };
	cwd: string;
}

/** A project with (maybe) the default contract and (maybe) the other one. */
function project(files: { default?: string; other?: string } = {}): string {
	const dir = mkdtempSync(join(tmpdir(), "violeta-active-contract-"));
	if (files.default !== undefined || files.other !== undefined) mkdirSync(join(dir, "tasks"), { recursive: true });
	if (files.default !== undefined) writeFileSync(join(dir, DEFAULT_CONTRACT), files.default);
	if (files.other !== undefined) writeFileSync(join(dir, OTHER_PATH), files.other);
	return dir;
}

/** A fake Pi over `cwd`, with an `existing` branch (what a resumed session has). */
function harness(cwd: string, existing: unknown[] = []): Harness {
	const handlers = new Map<string, Handler[]>();
	const tools = new Map<string, { execute: ToolExecute; parameters?: unknown }>();
	const branch: unknown[] = [...existing];
	const sessionManager = { getBranch: () => [...branch] };
	return {
		handlers,
		tools,
		branch,
		cwd,
		ctx: { cwd, mode: "json", hasUI: false, sessionManager },
	};
}

/** Load an extension against a harness, the way Pi loads it. */
function load(h: Harness, extension: unknown): void {
	(extension as (pi: unknown) => void)({
		on: (name: string, fn: Handler) => h.handlers.set(name, [...(h.handlers.get(name) ?? []), fn]),
		registerTool: (definition: { name: string; execute: ToolExecute; parameters?: unknown }) => h.tools.set(definition.name, definition),
		registerCommand: () => {},
		registerShortcut: () => {},
		registerMessageRenderer: () => {},
		appendEntry: (customType: string, data: unknown) => {
			h.branch.push({ type: "custom", customType, data });
		},
		sendMessage: () => {},
		getThinkingLevel: () => "medium",
	});
}

async function fire(h: Harness, name: string, event: unknown): Promise<void> {
	for (const fn of h.handlers.get(name) ?? []) await fn(event, h.ctx);
}

/** `contract_check` on a path, as the model calls it. */
async function check(h: Harness, path: string): Promise<{ details?: { ok?: boolean }; isError?: boolean }> {
	return (await h.tools.get("contract_check")!.execute("c1", { path }, undefined, undefined, h.ctx)) as {
		details?: { ok?: boolean };
		isError?: boolean;
	};
}

/** The panel's rows as the hub has them: `[id, title, status]`. */
function panelRows(): Array<[number, string, string]> {
	return (getShared().todoState?.tasks ?? []).map((task) => [task.id, task.title, task.status]);
}

/** The derivation lands on the extension's own tick, not on a tool call. */
async function waitFor(check: () => boolean, ms = 2_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return check();
}

/** Run a panel session and make sure its tick stops, so one test cannot leak
 * its contract into the next one. */
async function withPanel<T>(h: Harness, body: () => Promise<T>, reason = "startup"): Promise<T> {
	load(h, todoExtension);
	await fire(h, "session_start", { type: "session_start", reason });
	try {
		return await body();
	} finally {
		await fire(h, "session_shutdown", { type: "session_shutdown", reason: "quit" });
	}
}

// --- pure: which contract does the branch say is active? ---------------------

test("the entry type is namespaced for violeta", () => {
	assert.equal(ACTIVE_CONTRACT_ENTRY_TYPE, "violeta-active-contract");
});

test("with no adoption the session falls back to the conventional path", () => {
	assert.equal(DEFAULT_CONTRACT, "tasks/estado-de-tareas.md");
	assert.equal(replayActiveContract([]), undefined);
	assert.equal(activeContract([]), DEFAULT_CONTRACT);
});

test("the last adoption on the branch wins, and junk is ignored", () => {
	const adopted = (path: unknown) => ({ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path } });
	const entries = [
		{ type: "message", message: { role: "user" } },
		{ type: "custom", customType: "other-extension", data: { path: "tasks/nada.md" } },
		adopted(OTHER_PATH),
		{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: "  " } },
		{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: "junk" },
		{ type: "message", message: { role: "assistant" } },
	];
	assert.equal(replayActiveContract(entries), OTHER_PATH);
	assert.equal(activeContract(entries.slice(0, 2)), DEFAULT_CONTRACT);
});

// --- adopting a contract -----------------------------------------------------

test("a lint-clean contract_check makes that contract the session's active one", async () => {
	const dir = project({ default: DEFAULT_MD, other: OTHER_MD });
	const h = harness(dir);
	await withPanel(h, async () => {
		// S3's behaviour, kept: no adoption yet, the panel reads the convention
		assert.deepEqual(panelRows(), [[1, DEFAULT_TITLE, "pending"]]);

		load(h, contractExtension);
		const result = await check(h, OTHER_PATH);
		assert.equal(result.details?.ok, true);
		assert.equal(replayActiveContract(h.branch), OTHER_PATH);

		// the panel follows the session, with no second `contract_check` call
		assert.ok(await waitFor(() => panelRows()[0]?.[1] === OTHER_TITLE), `panel did not follow the adoption: ${JSON.stringify(panelRows())}`);
	});
});

test("a contract that fails the lint is not adopted", async () => {
	const broken = project({ default: DEFAULT_MD });
	writeFileSync(join(broken, OTHER_PATH), "# otro\nsin secciones\n");
	const h = harness(broken);
	await withPanel(h, async () => {
		load(h, contractExtension);
		const result = await check(h, OTHER_PATH);
		assert.equal(result.details?.ok, false);
		assert.equal(replayActiveContract(h.branch), undefined);
		assert.deepEqual(panelRows(), [[1, DEFAULT_TITLE, "pending"]]);
	});
});

test("a contract_check on a file that is not there adopts nothing", async () => {
	const dir = project({ default: DEFAULT_MD });
	const h = harness(dir);
	await withPanel(h, async () => {
		load(h, contractExtension);
		const result = await check(h, "tasks/no-existe.md");
		assert.equal(result.isError, true);
		assert.equal(replayActiveContract(h.branch), undefined);
	});
});

// --- surviving /compact and /resume ------------------------------------------

test("after a compaction and a resume the active contract is still the adopted one", async () => {
	const dir = project({ default: DEFAULT_MD, other: OTHER_MD });
	// What the session file holds after the model adopted the other contract and
	// the context was compacted: the adoption entry, a compaction entry, and the
	// messages around them.
	const entries = [
		{ type: "message", message: { role: "user", content: "adoptalo" } },
		{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: OTHER_PATH } },
		{ type: "compaction", id: "k1", summary: "the model adopted tasks/otro-contrato.md", firstKeptEntryId: "x", tokensBefore: 10_000 },
		{ type: "message", message: { role: "user", content: "seguí" } },
	];
	const h = harness(dir, entries);
	await withPanel(
		h,
		async () => {
			// the panel shows the adopted contract, not the conventional one
			assert.deepEqual(panelRows(), [[1, OTHER_TITLE, "pending"]]);
		},
		"resume",
	);
});

test("the state writer writes the session's active contract, not the constant", async () => {
	const dir = project({ default: DEFAULT_MD, other: OTHER_MD });
	const h = harness(dir, [{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: OTHER_PATH } }]);
	load(h, taskStateExtension);
	await fire(h, "tool_call", { type: "tool_call", toolName: "subagent_run", toolCallId: "c1", input: { agent: "coder", task: "do it", contractTask: 1 } });
	assert.match(readFileSync(join(dir, OTHER_PATH), "utf8"), /^T1\..*— estado: en curso$/m);
	// the conventional contract is not the session's: it must be untouched
	assert.equal(readFileSync(join(dir, DEFAULT_CONTRACT), "utf8"), DEFAULT_MD);
});

// --- no contract adopted: the panel behaves as before ------------------------

test("with no contract adopted the panel still derives from the conventional file", async () => {
	const dir = project({ default: DEFAULT_MD });
	const h = harness(dir);
	await withPanel(h, async () => {
		assert.deepEqual(panelRows(), [[1, DEFAULT_TITLE, "pending"]]);
	});
});

test("with no contract at all the panel keeps the list the model maintains", async () => {
	const dir = project();
	const h = harness(dir);
	await withPanel(h, async () => {
		await h.tools.get("todo")!.execute("c1", { action: "add", title: "Solo del modelo" }, undefined, undefined, h.ctx);
		assert.deepEqual(panelRows(), [[1, "Solo del modelo", "pending"]]);
	});
});