// S5 (authority-handoff): el harness le agrega su veredicto a la entrega.
//
// `jarvis.md` §4 dice "a worker whose answer has no `status:` line did not
// finish", y hasta hoy eso lo tenía que mirar el orquestador. Ahora el
// resultado del despacho vuelve marcado como error cuando la entrega no cumple
// su contrato de retorno, así que una entrega mal formada no se puede leer
// como un éxito.
//
// El texto del trabajador NO se reemplaza (D1): el orquestador lo necesita para
// continuar, y borrárselo convertiría un problema de forma en pérdida de
// trabajo. El veredicto va al final.
//
// Y el estado de la fila lo sigue decidiendo el `Check` observado, no la
// autoevaluación del trabajador (D2).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-task-state.ts";

delete process.env.VIOLETA_AGENTS_CHILD;

const CONTRACT = `# estado-de-tareas
Runner: none

## Specs
S1. Algo.

## Tasks
T1. Con test exigido — specs: S1 — test: required — riesgo: no — commit: -
T2. Sin test — specs: S1 — test: n/a — riesgo: no — commit: -
`;

type Handler = (event: unknown, ctx: unknown) => unknown;

function project() {
	const dir = mkdtempSync(join(tmpdir(), "violeta-handoff-"));
	mkdirSync(join(dir, "tasks"), { recursive: true });
	const file = join(dir, "tasks/estado-de-tareas.md");
	writeFileSync(file, CONTRACT);
	const handlers = new Map<string, Handler[]>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
	});
	return { handlers, ctx: { cwd: dir }, file };
}

type Harness = ReturnType<typeof project>;

/** Dispara y DEVUELVE lo que el enganche contestó: eso es lo que se prueba acá. */
async function result(h: Harness, agent: string, text: string, taskId?: number) {
	const input = { agent, task: "hacelo", ...(taskId !== undefined ? { contractTask: taskId } : {}) };
	let answer: unknown;
	for (const fn of h.handlers.get("tool_result") ?? []) {
		answer = await fn(
			{ type: "tool_result", toolName: "subagent_run", toolCallId: "c1", input, isError: false, content: [{ type: "text", text }] },
			h.ctx,
		);
	}
	return answer as { isError?: boolean; content?: Array<{ type: string; text: string }> } | undefined;
}

const BIEN = `status: completed
summary: hecho
extras:
  - none
tests:
  - RED: assert falló con 1 !== 2
  - GREEN: 3/3
`;

test("una entrega sin `status:` vuelve marcada como error", async () => {
	const h = project();
	const answer = await result(h, "builder", "Listo, quedó andando.", 2);
	assert.equal(answer?.isError, true);
});

test("el texto del trabajador sigue entero y primero (D1)", async () => {
	const h = project();
	const dicho = "Toqué src/x.ts y src/y.ts, y el build pasa.";
	const answer = await result(h, "builder", dicho, 2);
	assert.equal(answer?.content?.[0]?.text, dicho, "el original va primero y sin tocar");
	assert.ok((answer?.content?.length ?? 0) > 1, "y el veredicto se agrega al final");
});

test("el veredicto nombra qué faltó y qué hacer", async () => {
	const h = project();
	const answer = await result(h, "builder", "Listo.", 2);
	const veredicto = answer!.content!.at(-1)!.text;
	assert.match(veredicto, /status:/, "dice qué campo faltó");
	assert.match(veredicto, /no termin|did not finish/i, "y qué significa");
});

test("una entrega que cumple vuelve tal cual", async () => {
	const h = project();
	assert.equal(await result(h, "builder", BIEN, 2), undefined);
});

test("la fila de la tarea entra en el juicio: `test: required` sin RED no pasa", async () => {
	const h = project();
	const sinRed = BIEN.replace("RED: assert falló con 1 !== 2", "RED: n/a");
	assert.equal((await result(h, "builder", sinRed, 1))?.isError, true, "T1 dice required");
	assert.equal(await result(h, "builder", sinRed, 2), undefined, "T2 dice n/a");
});

test("un despacho sin id de tarea igual se juzga por su forma", async () => {
	const h = project();
	assert.equal((await result(h, "scout", "mapeé todo"))?.isError, true);
	assert.equal(await result(h, "scout", "status: completed\nsummary: mapeado\n"), undefined);
});

test("el estado de la fila lo sigue decidiendo el Check, no la forma de la entrega (D2)", async () => {
	const h = project();
	await result(h, "builder", "Listo, sin status.", 2);
	const md = readFileSync(h.file, "utf8");
	assert.match(md, /^T2\..*— estado: por verificar$/m, "sin Check ejecutable queda por verificar, no fallada");
});
