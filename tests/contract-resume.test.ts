// S9 (estado-de-tareas): a task that already has proof of being built is not
// built again. This file pins the DECISION, not the wiring (that is
// task-resume-brake.test.ts): given the contract text and the commits that
// cover it, does task N already exist?
//
// Two kinds of proof, and nothing else:
//   - a commit SUBJECT that names the task (`T2(spike): ...`, `contrato: T2
//     cerrado`): the work landed, whatever the panel or a resumed session
//     believes;
//   - the row the harness itself wrote as `verificada`: its Check ran and
//     passed.
// A `commit:` field is NOT proof here — that is the model's own marker, and the
// model is exactly what got this wrong (a resumed session trusted its belief
// over git). Prose and memory are not evidence.
import assert from "node:assert/strict";
import { test } from "node:test";
import { namesTask, parseGitLog, priorWork } from "../src/contract/resume.ts";

const CONTRACT = `# demo
Runner: node --test tests/contract-resume.test.ts

## Specs
S1. Algo.

## Tasks
T1. Nunca construida — specs: S1 — test: required — riesgo: no — commit: -
T2. Construida y commiteada — specs: S1 — test: required — riesgo: no — commit: -
T3. Verificada por el harness — specs: S1 — test: required — riesgo: no — commit: - — estado: verificada
T4. Fallada, se puede reintentar — specs: S1 — test: required — riesgo: no — commit: - — estado: fallada
T5. Marcada con commit por el modelo — specs: S1 — test: required — riesgo: no — commit: 9f8e7d6
`;

const commits = (...subjects: string[]) => subjects.map((subject, i) => ({ hash: `${i}a2b3c4`, subject }));

test("parseGitLog reads the hash/tab/subject git prints, and skips junk", () => {
	const out = parseGitLog("011f9f5\tmodes(jarvis): checkpoint\n\n9b1c2d3\tfix(estado-de-tareas): la carrera\nsin tabulador\n");
	assert.deepEqual(out, [
		{ hash: "011f9f5", subject: "modes(jarvis): checkpoint" },
		{ hash: "9b1c2d3", subject: "fix(estado-de-tareas): la carrera" },
	]);
});

test("a subject that names the task is proof, and a longer id is not", () => {
	assert.equal(namesTask("T2(spike): el cache", 2), true);
	assert.equal(namesTask("contrato(estado-de-tareas): T2 cerrado", 2), true);
	assert.equal(namesTask("T2: cerrar el spike", 2), true);
	// T12 is task 12, and T21 is task 21: neither is task 2
	assert.equal(namesTask("T12: el panel", 2), false);
	assert.equal(namesTask("T21: otra cosa", 12), false);
	// a number glued to letters is not a task id
	assert.equal(namesTask("T2b: el borde", 2), false);
	assert.equal(namesTask("fixt2: arreglo", 2), false);
	// and a lower-case t is not the T# row
	assert.equal(namesTask("t2: minúscula", 2), false);
});

test("a commit that names the task is proof", () => {
	const proof = priorWork(CONTRACT, 2, commits("T2(spike): el cache", "T9(estado-de-tareas): otra cosa"));
	assert.equal(proof?.kind, "commit");
	assert.deepEqual(proof?.kind === "commit" ? proof.commit : undefined, { hash: "0a2b3c4", subject: "T2(spike): el cache" });
});

test("the row the harness verified is proof, with no commit at all", () => {
	assert.deepEqual(priorWork(CONTRACT, 3, []), { kind: "estado" });
});

test("a commit wins over the row: the refusal names the commit", () => {
	const proof = priorWork(CONTRACT, 3, commits("T3: la verificación"));
	assert.equal(proof?.kind, "commit");
});

test("a task nobody built is not proof", () => {
	assert.equal(priorWork(CONTRACT, 1, commits("T7: otra tarea", "fix: nada que ver")), undefined);
});

test("a failed row is a task still open, not a task already built", () => {
	assert.equal(priorWork(CONTRACT, 4, []), undefined);
});

test("the model's own commit field is not evidence", () => {
	// `commit: 9f8e7d6` is the model agreeing with itself; the incident was a
	// session that believed a row over the repository.
	assert.equal(priorWork(CONTRACT, 5, []), undefined);
});

test("an unknown task id proves nothing", () => {
	assert.equal(priorWork(CONTRACT, 99, commits("T99: fantasma")), undefined);
});
