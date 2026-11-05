// S5 (estado-de-tareas): no delivery is accepted on trust. When a worker
// finishes and says it is done, the harness runs the task's `Check` — the one
// in the block of the spec the row cites, never one written on the row — and
// the row's `estado:` carries the real result (D7):
//
//   Check passes        → `verificada` (the panel counts it as done)
//   Check fails         → `fallada` + the clipped output on an indented
//                         continuation line under the row (D8)
//   `manual: ...`, or no Check at all → `por verificar`
//
// D9: a `background` dispatch returns immediately, so nothing is verified and
// the row stays `en curso`. A dispatch that failed is `fallada` without any
// Check (there is no delivery to verify).
//
// The Check commands here are real shell commands run in the temp project, so
// "did the harness run it?" is a file on disk, not an internal call. Every
// assertion reads the contract file (D2).
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
Runner: node --test tests/task-verify.test.ts

## No-objetivos
- no tocar el campo commit

## Specs
S1. Un Check que pasa.
    Accept: la fila queda verificada.
    Check: printf 'ran\\n' >> check.log; exit 0
S2. Un Check que falla.
    Accept: la fila queda fallada con la salida recortada.
    Check: printf 'boom: 1 failed\\nboom second\\nboom third\\nboom fourth\\nboom fifth\\n'; exit 1
S3. Un Check manual.
    Accept: la fila queda por verificar.
    Check: manual: mirar el panel del dueño
S4. Un spec sin Check.
    Accept: nada observable.

## Tasks
T1. Verde — specs: S1 — test: required — riesgo: sí — commit: -
T2. Rojo — specs: S2 — test: required — riesgo: no — commit: -
T3. Manual — specs: S3 — test: required — riesgo: no — commit: -
T4. Sin Check — specs: S4 — test: required — riesgo: no — commit: -
T5. Background — specs: S1 — test: required — riesgo: sí — commit: -
T6. La fila no manda — specs: S2 — test: required — riesgo: no — commit: - — Check: exit 0
`;

type Handler = (event: unknown, ctx: unknown) => unknown;

interface Harness {
	handlers: Map<string, Handler[]>;
	ctx: { cwd: string };
	dir: string;
	file: string;
}

/** A temp project whose only content is the contract file at the active path. */
function project(md: string | null = CONTRACT): Harness {
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-verify-"));
	mkdirSync(join(dir, "tasks"), { recursive: true });
	const file = join(dir, CONTRACT_PATH);
	if (md !== null) writeFileSync(file, md);
	const handlers = new Map<string, Handler[]>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
	});
	return { handlers, ctx: { cwd: dir }, dir, file };
}

async function fire(h: Harness, name: string, event: unknown): Promise<void> {
	for (const fn of h.handlers.get(name) ?? []) await fn(event, h.ctx);
}

const dispatch = (extra: Record<string, unknown>) => ({ agent: "coder", task: "do the thing", label: "do the thing", ...extra });

async function call(h: Harness, input: Record<string, unknown>): Promise<void> {
	await fire(h, "tool_call", { type: "tool_call", toolName: "subagent_run", toolCallId: "c1", input });
}

async function result(h: Harness, input: Record<string, unknown>, isError = false): Promise<void> {
	await fire(h, "tool_result", {
		type: "tool_result",
		toolName: "subagent_run",
		toolCallId: "c1",
		input,
		isError,
		content: [{ type: "text", text: isError ? "boom" : "done" }],
	});
}

/** A whole dispatch: the call that marks the row, then the result that verifies. */
async function dispatchAndFinish(h: Harness, input: Record<string, unknown>, isError = false): Promise<void> {
	await call(h, input);
	await result(h, input, isError);
}

const read = (h: Harness) => readFileSync(h.file, "utf8");
const ranCheck = (h: Harness) => existsSync(join(h.dir, "check.log"));
const linesOf = (md: string) => md.split("\n");
const rowAt = (md: string, id: string) => linesOf(md).findIndex((line) => line.startsWith(`T${id}. `));

test("a passing Check marks the row verificada", async () => {
	const h = project();
	const input = dispatch({ contractTask: 1 });
	await call(h, input);
	assert.match(read(h), /— estado: en curso/m);
	await result(h, input);

	const md = read(h);
	assert.match(md, /^T1\..*— commit: - — estado: verificada$/m);
	// the Check ran for real, in the contract's project
	assert.equal(readFileSync(join(h.dir, "check.log"), "utf8"), "ran\n");
	// and no other row moved
	assert.match(md, /^T2\..*— commit: -$/m);
	assert.match(md, /^T3\..*— commit: -$/m);
});

test("a failing Check marks the row fallada and writes the clipped output under it", async () => {
	const h = project();
	await dispatchAndFinish(h, dispatch({ contractTask: 2 }));

	const md = read(h);
	const row = rowAt(md, "2");
	assert.match(linesOf(md)[row]!, /— commit: - — estado: fallada$/);
	// D8: one indented continuation line, right under the row, with the real output
	const note = linesOf(md)[row + 1]!;
	assert.match(note, /^ {4}Check falló: .*boom: 1 failed/);
	assert.match(note, /boom second/);
	// clipped: the first lines only, never the tail of the output
	assert.doesNotMatch(note, /boom fourth/);
	assert.doesNotMatch(note, /boom fifth/);
	// exactly one line was added to the file
	assert.equal(linesOf(md).length, linesOf(CONTRACT).length + 1);
	assert.equal(linesOf(md).filter((line) => line.includes("Check falló")).length, 1);
	// the model's field and the neighbour rows are untouched
	assert.match(md, /^T1\..*— commit: -$/m);
	assert.match(md, /^T3\..*— commit: -$/m);
});

test("a `manual:` Check leaves the row por verificar and runs nothing", async () => {
	const h = project();
	await dispatchAndFinish(h, dispatch({ contractTask: 3 }));
	assert.match(read(h), /^T3\..*— commit: - — estado: por verificar$/m);
	assert.equal(ranCheck(h), false);
});

test("a spec with no Check at all leaves the row por verificar", async () => {
	const h = project();
	await dispatchAndFinish(h, dispatch({ contractTask: 4 }));
	assert.match(read(h), /^T4\..*— commit: - — estado: por verificar$/m);
});

test("the Check comes from the spec the row cites, never from the row", async () => {
	// T6 cites S2 (a Check that fails) and its own text says `Check: exit 0`.
	// Reading the row would verify; reading the spec fails it.
	const h = project();
	await dispatchAndFinish(h, dispatch({ contractTask: 6 }));
	assert.match(read(h), /^T6\..*— estado: fallada$/m);
});

test("a dispatch with no contractTask verifies nothing", async () => {
	const h = project();
	const input = dispatch({ label: "T1 hacer la cosa" });
	await dispatchAndFinish(h, input);
	assert.equal(read(h), CONTRACT);
	assert.equal(ranCheck(h), false);
});

test("a background dispatch neither verifies nor clears: the row stays en curso", async () => {
	const h = project();
	const input = dispatch({ contractTask: 5, mode: "background" });
	await dispatchAndFinish(h, input);
	assert.match(read(h), /^T5\..*— commit: - — estado: en curso$/m);
	assert.equal(ranCheck(h), false);
});

test("a failed dispatch is fallada with no Check run and no output line", async () => {
	const h = project();
	await dispatchAndFinish(h, dispatch({ contractTask: 1 }), true);
	const md = read(h);
	assert.match(md, /^T1\..*— estado: fallada$/m);
	assert.doesNotMatch(md, /Check falló/);
	assert.equal(ranCheck(h), false);
});

test("a later green Check replaces the failure and removes the output line", async () => {
	const h = project();
	await dispatchAndFinish(h, dispatch({ contractTask: 2 }));
	assert.match(read(h), /Check falló/);
	// the model fixes the work and re-points the row at a spec whose Check passes
	writeFileSync(h.file, read(h).replace("T2. Rojo — specs: S2", "T2. Rojo — specs: S1"));
	await dispatchAndFinish(h, dispatch({ contractTask: 2 }));

	const md = read(h);
	assert.match(md, /^T2\..*— estado: verificada$/m);
	assert.doesNotMatch(md, /Check falló/);
	assert.equal(linesOf(md).length, linesOf(CONTRACT).length);
});
