// T2 spike (estado-de-tareas), reduced by T5: the event → file half of the
// loop. The pure transforms are tested directly; the wiring is driven against
// a fake Pi the same way agents-breaker-extension.test.ts does it: a
// `subagent_run` tool_call writes `estado: en curso` into the contract file.
// The panel half moved to the one derivation in `src/todo/source.ts` and is
// covered by tests/todo-from-contract.test.ts (S3), so it is no longer asserted
// here.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-task-state.ts";
import { parseContractTasks, setTaskStatus, todoFromContract } from "../src/contract/state.ts";

const CONTRACT = `# contrato
Runner: none

## No-objetivos
- nada

## Specs
S1. algo
    Accept: visible

## Tasks
T1. Hacer la cosa — specs: S1 — test: required — riesgo: no — commit: -
T2. Otra cosa ya hecha — specs: S1 — test: required — riesgo: sí — commit: abc1234
`;

test("a contract without ## Tasks yields an empty list", () => {
	assert.deepEqual(parseContractTasks("# algo\n\nsin seccion\n"), []);
	assert.deepEqual(todoFromContract("# algo\n\nsin seccion\n"), []);
});

test("setTaskStatus writes the estado field and preserves the rest of the row", () => {
	const next = setTaskStatus(CONTRACT, 1, "en curso");
	assert.match(next, /T1\..*— estado: en curso$/m);
	// commit: and the row above/below are untouched
	assert.match(next, /— test: required — riesgo: no — commit: - — estado: en curso/m);
	assert.match(next, /T2\..*— commit: abc1234\n$/m);
});

test("setTaskStatus clears the field and ignores unknown ids", () => {
	const marked = setTaskStatus(CONTRACT, 1, "en curso");
	assert.equal(setTaskStatus(marked, 1, undefined), CONTRACT);
	assert.equal(setTaskStatus(CONTRACT, 9, "en curso"), CONTRACT);
});

test("todoFromContract: commit content is done, en curso is in_progress, else pending", () => {
	const list = todoFromContract(setTaskStatus(CONTRACT, 1, "en curso"));
	assert.deepEqual(
		list.map((task) => ({ id: task.id, status: task.status })),
		[
			{ id: 1, status: "in_progress" },
			{ id: 2, status: "done" },
		],
	);
	assert.equal(list[0].title, "Hacer la cosa");
});

test("the loop: a subagent_run dispatch writes the estado into the contract file", async () => {
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-state-"));
	const file = join(dir, "tasks", "estado-de-tareas.md");
	mkdirSync(join(dir, "tasks"));
	writeFileSync(file, CONTRACT);

	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) =>
			handlers.set(name, [...(handlers.get(name) ?? []), fn]),
	});

	// dispatch start → the row reads en curso; the panel reads it from the file
	for (const fn of handlers.get("tool_call") ?? [])
		await fn({ type: "tool_call", toolName: "subagent_run", toolCallId: "x", input: { contractTask: 1 } }, { cwd: dir });
	assert.match(readFileSync(file, "utf8"), /T1\..*— estado: en curso/m);

	// dispatch end → verified, not taken on its word: S1 here has no `Check:`,
	// so the harness leaves the row for manual verification (S5/D7)
	for (const fn of handlers.get("tool_result") ?? [])
		await fn({ type: "tool_result", toolName: "subagent_run", toolCallId: "x", input: { contractTask: 1 }, isError: false }, { cwd: dir });
	assert.match(readFileSync(file, "utf8"), /^T1\..*— estado: por verificar$/m);
});

test("the loop ignores dispatches with no contractTask", async () => {
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-state-"));
	mkdirSync(join(dir, "tasks"));
	writeFileSync(join(dir, "tasks", "estado-de-tareas.md"), CONTRACT);
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) =>
			handlers.set(name, [...(handlers.get(name) ?? []), fn]),
	});
	for (const fn of handlers.get("tool_call") ?? [])
		await fn({ type: "tool_call", toolName: "subagent_run", toolCallId: "x", input: { label: "T1 pero sin contractTask" } }, { cwd: dir });
	assert.equal(readFileSync(join(dir, "tasks", "estado-de-tareas.md"), "utf8"), CONTRACT);
});
