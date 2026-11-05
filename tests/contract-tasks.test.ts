// S2 (estado-de-tareas): the pure reader of a contract's `## Tasks` section.
// Every task row becomes `{ id, title, done }`; `commit:` is the model's done
// marker (D3), and a contract with no `## Tasks` yields an empty list instead of
// throwing. The reader never touches the filesystem: the caller reads the file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readContractTasks } from "../src/contract/tasks.ts";

const CONTRACT = `# estado-de-tareas
Runner: node --test tests/contract-tasks.test.ts

## No-objetivos
- no tocar la rama main

## Specs
S1. Algo.
    Accept: se ve
    Check: node --test tests/contract-tasks.test.ts

## Tasks
T1. Crear la copia aislada — specs: S1 — test: n/a — riesgo: sí — commit: 6863b38
T2. Lector puro de \`## Tasks\` — specs: S1 — test: required — riesgo: no — commit: -
T3. Solo un título, sin campos — specs: S1 — test: required — riesgo: no

## Decisiones
D1. El archivo del contrato es la única fuente de verdad.
D2. Una tarea se da por hecha solo con su \`Check\` en verde.

## Log
L1. Quiero que el harness lleve el estado.
`;

test("every `T#.` row becomes a task with its id and title, in file order", () => {
	assert.deepEqual(
		readContractTasks(CONTRACT).map((task) => ({ id: task.id, title: task.title })),
		[
			{ id: 1, title: "Crear la copia aislada" },
			{ id: 2, title: "Lector puro de `## Tasks`" },
			{ id: 3, title: "Solo un título, sin campos" },
		],
	);
});

test("a task is done only when its `commit:` field holds something other than `-`", () => {
	assert.deepEqual(
		readContractTasks(CONTRACT).map((task) => task.done),
		[true, false, false],
	);
});

test("done needs content: an empty or dash-only `commit:` is not done", () => {
	const text = (commit: string) => `## Tasks\nT1. Algo — specs: S1 — test: n/a — riesgo: no — commit: ${commit}\n`;
	for (const pending of ["-", "", " - "]) {
		assert.equal(readContractTasks(text(pending))[0]?.done, false, `commit:${pending}`);
	}
	for (const done of ["abc1234", "6863b38 (Check en verde)", "0"]) {
		assert.equal(readContractTasks(text(done))[0]?.done, true, `commit:${done}`);
	}
});

test("other fields never mark a task done", () => {
	const text = `## Tasks\nT1. Algo — specs: S1 — test: required — riesgo: sí — estado: fin\n`;
	assert.deepEqual(readContractTasks(text), [{ id: 1, title: "Algo", done: false }]);
});

test("a contract without `## Tasks` yields an empty list instead of throwing", () => {
	assert.deepEqual(readContractTasks("# algo\n\n## Specs\nS1. x\n"), []);
	assert.deepEqual(readContractTasks(""), []);
});

test("an empty `## Tasks` section yields an empty list", () => {
	assert.deepEqual(readContractTasks("# x\n\n## Tasks\n\n## Log\nL1. hola\n"), []);
});

test("the section ends at the next heading, so `## Decisiones` rows are not tasks", () => {
	const ids = readContractTasks(CONTRACT).map((task) => task.id);
	assert.deepEqual(ids, [1, 2, 3]);
	assert.equal(
		readContractTasks(CONTRACT).some((task) => task.title.includes("única fuente de verdad")),
		false,
	);
});

test("the real contract in this repo reads as a task list without breaking", () => {
	const md = `## Tasks\nT1. Uno — specs: S1 — test: n/a — riesgo: no — commit: abc\nT2. Dos — specs: S1 — test: required — riesgo: no — commit: -\n`;
	assert.equal(readContractTasks(md).length, 2);
});
