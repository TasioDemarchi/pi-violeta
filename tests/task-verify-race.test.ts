// S7 and D9 (estado-de-tareas), the two holes a judge found in the event
// wiring. Both are about WHEN the harness writes, not about what it writes:
//
//   (a) the harness reads the contract, waits for the Check (up to ten minutes,
//       or however long the guard's dialog takes), and only then writes. Any
//       edit the model made in that window must survive (S7), so the write is a
//       fresh read + the pure transforms, never a rewrite of the old snapshot.
//   (b) a `background` dispatch returns its `tool_result` before the work ends
//       (D9), so the row is `en curso` and NOTHING closes it when the child
//       really settles. Here the settlement is driven through the agents
//       extension's own tools: a background dispatch carrying `contractTask`,
//       then the task is settled, and the row must end up verified — with the
//       Check actually run, and on the session's active contract.
//
// Everything is observed on disk: the contract file is the single source of
// truth (D2), and `check.log` is the proof that the Check ran.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import agentsExtension from "../extensions/violeta-agents.ts";
import { verifyDispatch } from "../extensions/violeta-task-state.ts";
import type { CheckExecutor } from "../src/contract/verify.ts";
import { setLanguage } from "../src/i18n.ts";
import { setShared } from "../src/shared-hub.ts";

// A subagent exports this and both extensions then install nothing, and the
// guard answers "no UI" (repo trap). The test must not inherit it.
delete process.env.VIOLETA_AGENTS_CHILD;

const ROOT = join(import.meta.dirname, "..");

const CONTRACT = `# estado-de-tareas
Runner: node --test tests/task-verify-race.test.ts

## No-objetivos
- no tocar el campo commit

## Specs
S1. Un Check que tarda.
    Accept: la fila queda verificada.
    Check: printf 'ran\\n' >> check.log; exit 0
S2. Un spec sin Check.
    Accept: nada observable.

## Tasks
T1. La tarea que se verifica — specs: S1 — test: required — riesgo: sí — commit: -
T2. La tarea que el modelo edita — specs: S2 — test: required — riesgo: no — commit: -
`;

/** A temp project holding `CONTRACT` at `path`, and nothing else. */
function project(path = "tasks/estado-de-tareas.md"): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-verify-race-"));
	const file = join(dir, path);
	mkdirSync(join(dir, "tasks"), { recursive: true });
	writeFileSync(file, CONTRACT);
	return { dir, file };
}

const read = (file: string) => readFileSync(file, "utf8");
const linesOf = (md: string) => md.split("\n");

test("a model edit made while the Check runs survives the harness write (S7)", async () => {
	const { dir, file } = project();
	// The window the judge found: the Check is slow (or the guard is waiting for
	// the owner), and the model keeps working in the meantime.
	const slowCheck: CheckExecutor = async () => {
		const during = read(file);
		writeFileSync(
			file,
			during
				.replace(
					"T2. La tarea que el modelo edita — specs: S2 — test: required — riesgo: no — commit: -",
					"T2. La tarea que el modelo edita — specs: S2 — test: required — riesgo: no — commit: 9f8e7d6",
				)
				.replace(/^$/m, "    nota del modelo escrita mientras corría el Check\n\n"),
		);
		return { ok: true, output: "" };
	};

	await verifyDispatch(dir, "tasks/estado-de-tareas.md", 1, slowCheck);

	const md = read(file);
	// the harness's own field landed…
	assert.match(md, /^T1\..*— commit: - — estado: verificada$/m);
	// …without eating what the model wrote in that window
	assert.match(md, /^T2\..*— commit: 9f8e7d6$/m, "the model's commit edit was overwritten by the stale snapshot");
	assert.match(md, /nota del modelo escrita mientras corría el Check/, "the model's prose was overwritten by the stale snapshot");
});

/** The fake Pi the agents extension is installed against (same shape
 * tests/agents-breaker-extension.test.ts uses), plus its `subagent_run` and
 * `subagent_cancel` tools. */
function agentsSetup() {
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-verify-bg-"));
	mkdirSync(join(dir, "agents"));
	mkdirSync(join(dir, "tasks"), { recursive: true });
	// A model that does not exist: the child dies on the unknown model before any
	// request, so the suite spends no quota. The settlement the test drives comes
	// from `subagent_cancel`, so the child's own timing never matters.
	const scout = readFileSync(join(ROOT, "agents", "scout.md"), "utf8").replace(/^model:.*$/m, "model: nope/none");
	writeFileSync(join(dir, "agents", "scout.md"), scout);
	process.env.PI_CODING_AGENT_DIR = dir;
	setLanguage("es");
	setShared({ unattended: false });

	type Tool = {
		name: string;
		execute: (
			id: string,
			params: Record<string, unknown>,
			signal: undefined,
			onUpdate: undefined,
			ctx: unknown,
		) => Promise<{ content: Array<{ text: string }>; isError?: boolean; details?: Record<string, unknown> }>;
	};
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const pi = {
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		registerTool: (tool: Tool) => tools.set(tool.name, tool),
		registerCommand: () => {},
		registerShortcut: () => {},
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		getThinkingLevel: () => "medium",
	};
	(agentsExtension as unknown as (pi: unknown) => void)(pi);
	// The session adopted this contract (`contract_check` adopted it earlier);
	// the state writer must follow the session, not a hardcoded path (S8).
	const ACTIVE = "tasks/mi-contrato.md";
	const ctx = {
		cwd: dir,
		hasUI: false,
		mode: "tui",
		ui: { confirm: async () => false, notify: () => {}, setWidget: () => {} },
		sessionManager: {
			getBranch: () => [{ type: "custom", customType: "violeta-active-contract", data: { path: ACTIVE } }],
		},
	};
	const stop = async () => {
		for (const fn of handlers.get("session_shutdown") ?? []) await fn({}, ctx);
	};
	return { dir, active: join(dir, ACTIVE), tools, stop, ctx };
}

/** Wait (bounded) for a condition on disk, since settlement is asynchronous. */
async function until(what: string, condition: () => boolean, ms = 5000): Promise<void> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise((done) => setTimeout(done, 25));
	}
	assert.fail(`timed out waiting for ${what}`);
}

test("a background dispatch verifies when the work settles (D9)", async () => {
	const env = agentsSetup();
	writeFileSync(env.active, CONTRACT);

	const dispatched = await env.tools.get("subagent_run")!.execute(
		"1",
		{ agent: "scout", task: "do the thing", label: "do the thing", mode: "background", contractTask: 1 },
		undefined,
		undefined,
		env.ctx,
	);
	assert.equal(dispatched.isError, undefined);
	const id = String(dispatched.details?.taskId);
	assert.notEqual(id, "", "a background dispatch returns the runner task id");

	// The `tool_result` of a background dispatch is not the end of the work (D9):
	// the row is only closed when the runner says the task settled.
	await env.tools.get("subagent_cancel")!.execute("2", { id }, undefined, undefined, env.ctx);
	await until("the row to be verified on settle", () => /— estado: verificada$/m.test(read(env.active)));

	const md = read(env.active);
	assert.match(md, /^T1\..*— estado: verificada$/m);
	// the Check really ran, in the project, on the session's active contract
	assert.equal(readFileSync(join(env.dir, "check.log"), "utf8"), "ran\n");
	// and the model's field is still the model's
	assert.match(md, /^T2\..*— commit: -$/m);
	assert.equal(linesOf(md).length, linesOf(CONTRACT).length, "no note was written for a green Check");
	assert.equal(existsSync(join(env.dir, "tasks", "estado-de-tareas.md")), false, "the convention path was not used");
	await env.stop();
});

test("a dispatch with no contractTask settles without touching the contract", async () => {
	const env = agentsSetup();
	writeFileSync(env.active, CONTRACT);

	const dispatched = await env.tools.get("subagent_run")!.execute(
		"1",
		{ agent: "scout", task: "look around", label: "look around", mode: "background" },
		undefined,
		undefined,
		env.ctx,
	);
	const id = String(dispatched.details?.taskId);
	await env.tools.get("subagent_cancel")!.execute("2", { id }, undefined, undefined, env.ctx);
	// Give the settlement every chance to (wrongly) write something.
	await new Promise((done) => setTimeout(done, 300));
	assert.equal(read(env.active), CONTRACT, "a dispatch with no contractTask writes no state (D4)");
	await env.stop();
});
