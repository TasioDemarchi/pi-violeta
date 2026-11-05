// S7 (estado-de-tareas): one writer per field. The harness owns `— estado:`,
// the model owns everything else (`commit:`, the title, its own prose), and
// neither write clobbers the other. The module is pure: the caller reads the
// contract file, hands the text over, and writes the result back.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readTaskStatus, setTaskStatus, todoFromContract } from "../src/contract/state.ts";

const CONTRACT = `# estado-de-tareas
Runner: node --test tests/contract-write.test.ts

## No-objetivos
- no tocar la rama main

## Specs
S7. Un solo escritor por campo.
    Accept: una escritura del harness conserva el texto del modelo.
    Check: node --test tests/contract-write.test.ts

## Tasks
T1. Escribir el estado — specs: S7 — test: required — riesgo: sí — commit: -
    Texto que el modelo agregó debajo de su tarea.
T2. Ya hecha — specs: S7 — test: required — riesgo: no — commit: abc1234

## Decisiones
D1. El archivo del contrato es la única fuente de verdad.

## Log
L1. Pedido del dueño, con prosa suelta adentro.
`;

const ROW_T1 = "T1. Escribir el estado — specs: S7 — test: required — riesgo: sí — commit: -";

/** The T1 row, verbatim; every other line of the file, joined. */
const rowOf = (md: string): string => md.split("\n").find((line) => line.startsWith("T1. "))!;
const restOf = (md: string): string => md.split("\n").filter((line) => !line.startsWith("T1. ")).join("\n");

test("writing estado touches only that row: title, commit and the model's own text survive", () => {
	const next = setTaskStatus(CONTRACT, 1, "en curso");
	assert.equal(rowOf(next), `${ROW_T1} — estado: en curso`);
	assert.equal(restOf(next), restOf(CONTRACT));
	// the model's continuation line under the task is still there
	assert.match(next, /^ {4}Texto que el modelo agregó debajo de su tarea\.$/m);
});

test("clearing the estado restores the row exactly as the model left it", () => {
	const marked = setTaskStatus(CONTRACT, 1, "en curso");
	assert.equal(setTaskStatus(marked, 1, undefined), CONTRACT);
	// clearing a row that was never marked is a no-op, not a rewrite
	assert.equal(setTaskStatus(CONTRACT, 1, undefined), CONTRACT);
});

test("writing twice replaces the field instead of duplicating it", () => {
	const twice = setTaskStatus(setTaskStatus(CONTRACT, 1, "en curso"), 1, "fallada");
	assert.equal(twice.match(/— estado:/g)?.length, 1);
	assert.equal(rowOf(twice), `${ROW_T1} — estado: fallada`);
	assert.equal(setTaskStatus(twice, 1, undefined), CONTRACT);
});

test("a model edit to `commit:` neither erases the estado nor gets erased by clearing it", () => {
	const marked = setTaskStatus(CONTRACT, 1, "en curso");
	// the model, through its own edit tool, changes the field it owns
	const modelEdited = marked.replace("riesgo: sí — commit: -", "riesgo: sí — commit: 9f8e7d6");
	assert.equal(readTaskStatus(modelEdited, 1), "en curso");
	// clearing the harness field keeps the model's new commit: the harness
	// removes its own field, it never restores a remembered row
	assert.equal(
		setTaskStatus(modelEdited, 1, undefined),
		CONTRACT.replace("riesgo: sí — commit: -", "riesgo: sí — commit: 9f8e7d6"),
	);
	// and the model's edit is what makes the task done, in the same file
	assert.match(modelEdited, /— commit: 9f8e7d6 — estado: en curso$/m);
});

test("a contract without `## Tasks` returns the text unchanged", () => {
	const noSection = "# x\n\n## Specs\nS1. algo\n";
	assert.equal(setTaskStatus(noSection, 1, "en curso"), noSection);
	assert.equal(readTaskStatus(noSection, 1), undefined);
	// a `T1.` line outside the section is prose, not a row this module owns
	const logOnly = "# x\n\n## Log\nL1. hola\nT1. esto es prosa del log — commit: -\n";
	assert.equal(setTaskStatus(logOnly, 1, "en curso"), logOnly);
});

test("an unknown task id returns the text unchanged", () => {
	assert.equal(setTaskStatus(CONTRACT, 9, "en curso"), CONTRACT);
	assert.equal(setTaskStatus(CONTRACT, 9, undefined), CONTRACT);
	assert.equal(readTaskStatus(CONTRACT, 9), undefined);
});

test("a row with no estado reads as undefined and reads back what was written", () => {
	assert.equal(readTaskStatus(CONTRACT, 1), undefined);
	assert.equal(readTaskStatus(setTaskStatus(CONTRACT, 2, "fallada"), 2), "fallada");
});

test("the panel projection keeps its previous behaviour: commit is done, en curso is in progress", () => {
	assert.deepEqual(
		todoFromContract(setTaskStatus(CONTRACT, 1, "en curso")).map((task) => ({ id: task.id, status: task.status })),
		[
			{ id: 1, status: "in_progress" },
			{ id: 2, status: "done" },
		],
	);
});
