/** ¿Esto es una entrega, o alguien dijo que terminó?
 *
 * `modes/jarvis.md` §4 ya lo pide —*"a worker whose answer has no `status:`
 * line did not finish"*— y hasta hoy eso lo tenía que mirar el orquestador, que
 * es la misma prosa sin nadie que la imponga. Lo medido el 10/11: de 38
 * corridas, ninguna se rechazó por forma.
 *
 * Este módulo mira **sólo la forma**: que estén los campos que el contrato de
 * retorno de cada agente exige. Nunca juzga la calidad de un hallazgo ni del
 * código — eso lo decide el `Check`, que el harness ya corre él mismo, y el
 * hecho observado gana sobre lo que alguien diga de sí mismo (D2).
 *
 * Es total: un texto vacío, truncado a la mitad por el techo de turnos, o con
 * basura binaria, devuelve un problema en vez de romper. Una entrega cortada al
 * cumplirse el techo es justamente el caso que más importa. */

/** Los estados que los contratos de retorno declaran. Cualquier otra palabra es
 * tan inútil como no haber dicho nada. */
const STATES = ["completed", "partial", "blocked", "interaction_required"] as const;

/** Los agentes cuyo contrato de retorno tiene `remaining:`: lo que un trabajador
 * fresco continúa. `critic` y `judge` no lo tienen y no se les exige. */
const WITH_REMAINING = new Set(["builder", "scout", "tester"]);

export type HandoffProblem =
	| { kind: "missing-status" }
	| { kind: "partial-without-remaining" }
	| { kind: "missing-extras" }
	| { kind: "required-test-skipped" };

/** El texto sin los bloques cercados: un builder que pega su propio contrato de
 * retorno como ejemplo no está entregando nada (D3). */
function withoutFences(text: string): string {
	return text.replace(/^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm, "");
}

/** El valor de un campo al principio de una línea, o `undefined` si no está.
 * Devuelve la cadena vacía cuando el campo existe sin valor en su línea, que es
 * la forma normal de `remaining:` seguida de una lista. */
function field(text: string, name: string): string | undefined {
	const match = text.match(new RegExp(`^[ \\t]*${name}:[ \\t]*(.*)$`, "im"));
	return match ? match[1]!.trim() : undefined;
}

/** Lo que sigue a `name:` hasta la próxima clave de primer nivel: su valor en la
 * misma línea, o los renglones indentados de abajo. */
function block(text: string, name: string): string {
	const match = text.match(new RegExp(`^[ \\t]*${name}:[ \\t]*(.*(?:\\n(?:[ \\t]+.*|[ \\t]*))*)`, "im"));
	return (match?.[1] ?? "").trim();
}

/** El campo `test:` de una fila `T#` del contrato, cuando se la pasaron. */
function requiredTest(row: string | undefined): boolean {
	if (!row) return false;
	const match = row.match(/(?:^|[\s—])test:\s*([^\s—]*)/i);
	return (match?.[1] ?? "").toLowerCase() === "required";
}

/** El problema de forma de esta entrega, o `undefined` si cumple. */
export function inspectHandoff(agent: string, text: string, taskRow?: string): HandoffProblem | undefined {
	const body = withoutFences(typeof text === "string" ? text : "");

	const status = field(body, "status");
	if (status === undefined || !STATES.some((state) => status.toLowerCase().startsWith(state))) {
		return { kind: "missing-status" };
	}
	const state = STATES.find((candidate) => status.toLowerCase().startsWith(candidate))!;

	// Un trabajador que no llegó a trabajar no se juzga por sus campos: su
	// respuesta ES el problema que está reportando.
	if (state === "blocked" || state === "interaction_required") return undefined;

	if (state === "partial" && WITH_REMAINING.has(agent) && block(body, "remaining") === "") {
		return { kind: "partial-without-remaining" };
	}

	if (agent === "builder") {
		// `extras` nunca se omite y "none" es la respuesta esperada: existe para
		// que el padre rechace trabajo no pedido en un turno en vez de
		// descubrirlo en revisión.
		if (field(body, "extras") === undefined) return { kind: "missing-extras" };
		if (requiredTest(taskRow)) {
			const red = field(body, "RED") ?? field(body, "- RED");
			if (red === undefined || red === "" || /^n\/?a\b/i.test(red)) return { kind: "required-test-skipped" };
		}
	}

	return undefined;
}
