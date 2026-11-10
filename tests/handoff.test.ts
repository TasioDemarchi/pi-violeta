// S1-S4 (authority-handoff): una entrega no se interpreta.
//
// jarvis.md §4 ya lo dice —"a worker whose answer has no `status:` line did not
// finish"— y hasta hoy eso lo tenía que mirar el orquestador, que es la misma
// prosa sin nadie que la imponga. Este módulo sólo mira la FORMA: que estén los
// campos que el contrato de retorno de cada agente exige. La calidad del trabajo
// la decide el `Check`, que el harness ya corre él mismo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inspectHandoff } from "../src/authority/handoff.ts";

const ok = (agent: string, text: string, row?: string) =>
	assert.equal(inspectHandoff(agent, text, row), undefined, text.slice(0, 40));
const falla = (agent: string, text: string, kind: string, row?: string) => {
	const problem = inspectHandoff(agent, text, row);
	assert.ok(problem, `esperaba un problema en: ${text.slice(0, 50)}`);
	assert.equal(problem.kind, kind);
};

const BUILDER_OK = `status: completed
summary: hecho
specs_covered: S1
files_changed:
  - src/x.ts: nuevo
extras:
  - none
tests:
  - RED: assert.equal falló con 1 !== 2
  - GREEN: 3/3
`;

// --- S2: la línea status: ---------------------------------------------------

test("sin `status:` no hay entrega, sea quien sea", () => {
	for (const agent of ["builder", "scout", "judge", "tester", "critic"]) {
		falla(agent, "Listo, quedó todo bien.", "missing-status");
	}
});

test("los cuatro estados del contrato de retorno se aceptan", () => {
	for (const estado of ["completed", "partial", "blocked", "interaction_required"]) {
		const texto = estado === "partial" ? `status: ${estado}\nremaining:\n  - falta T2\n` : `status: ${estado}\n`;
		ok("scout", texto);
	}
});

test("un `status:` desconocido es tan malo como ninguno", () => {
	falla("scout", "status: listo\n", "missing-status");
});

test("un `status:` dentro de un bloque citado no es el propio (D3)", () => {
	const pegado = ["Mi contrato de retorno es así:", "```text", "status: completed | partial", "```", "y terminé."].join("\n");
	falla("builder", pegado, "missing-status");
});

test("el `status:` real después de un bloque citado sí cuenta", () => {
	const texto = ["```text", "status: completed | partial", "```", BUILDER_OK].join("\n");
	ok("builder", texto);
});

test("una respuesta vacía o basura decide en vez de romper", () => {
	falla("builder", "", "missing-status");
	falla("builder", "\u0000\u0000", "missing-status");
	assert.doesNotThrow(() => inspectHandoff("builder", "status: completed", undefined));
});

// --- S3: partial sin remaining ----------------------------------------------

test("`partial` sin `remaining:` no deja a nadie continuar", () => {
	falla("builder", "status: partial\nsummary: a medias\nextras:\n  - none\n", "partial-without-remaining");
	falla("scout", "status: partial\nsummary: a medias\n", "partial-without-remaining");
});

test("`partial` con `remaining:` vacío es lo mismo que sin él", () => {
	falla("scout", "status: partial\nremaining:\n", "partial-without-remaining");
	falla("scout", "status: partial\nremaining: \n", "partial-without-remaining");
});

test("`partial` con contenido en `remaining:` pasa", () => {
	ok("scout", "status: partial\nremaining:\n  - falta mapear el guard\n");
	ok("scout", "status: partial\nremaining: falta el guard\n");
});

test("`completed` no necesita `remaining:`", () => {
	ok("scout", "status: completed\nsummary: todo mapeado\n");
});

test("critic y judge no tienen `remaining:` en su contrato: no se les exige", () => {
	ok("critic", "status: partial\nverdict: questions\n");
	ok("judge", "status: partial\nverdict: clean\n");
});

// --- S4: lo propio del builder ----------------------------------------------

test("el builder declara `extras:`, y `none` es la respuesta esperada", () => {
	ok("builder", BUILDER_OK);
	falla("builder", BUILDER_OK.replace(/extras:\n {2}- none\n/, ""), "missing-extras");
});

test("a los demás no se les exige `extras:`", () => {
	for (const agent of ["scout", "judge", "tester", "critic"]) ok(agent, "status: completed\n");
});

test("una fila `test: required` no se cierra con un RED en `n/a`", () => {
	const fila = "T3. Algo. — specs: S1 — test: required — riesgo: no — commit: -";
	falla("builder", BUILDER_OK.replace("RED: assert.equal falló con 1 !== 2", "RED: n/a"), "required-test-skipped", fila);
	falla("builder", BUILDER_OK.replace(/ {2}- RED: .*\n/, ""), "required-test-skipped", fila);
	ok("builder", BUILDER_OK, fila);
});

test("con `test: n/a` o `recommended` en la fila, el RED no se exige", () => {
	const sinRed = BUILDER_OK.replace("RED: assert.equal falló con 1 !== 2", "RED: n/a");
	ok("builder", sinRed, "T3. Algo. — specs: S1 — test: n/a — riesgo: no — commit: -");
	ok("builder", sinRed, "T3. Algo. — specs: S1 — test: recommended — riesgo: no — commit: -");
	ok("builder", sinRed);
});

test("un `blocked` o `interaction_required` no se juzga por sus campos: no llegó a trabajar", () => {
	ok("builder", "status: blocked\nsummary: no pude leer el contrato\n");
	ok("builder", "status: interaction_required\nsummary: ¿A o B?\n");
});
