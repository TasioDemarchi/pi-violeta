/** Lo que un agente promete en su prosa, impuesto por el harness.
 *
 * El inventario del 10/11 (`~/dev/pi-violeta-inventario.md` §1) encontró la
 * falla de Jarvis repetida, al revés: prosa que promete "nunca escribo" en
 * agentes que pueden escribir.
 *
 *   scout   "never edit source, never create or delete a project file"
 *   judge   "You read; you never write"
 *   tester  "never fix anything, never edit the project, never edit the contract"
 *   critic  "Read only the contract file you were given"
 *
 * El runner pasa `--tools`, así que `edit` y `write` están realmente fuera del
 * alcance de scout y judge — D4 de `authority-bash` no era falso del todo. Pero
 * `bash` escribe igual, y `tester` tiene `write` sobre todo el proyecto.
 *
 * No se les saca `bash` (D3): los cuatro lo usan para mirar —`git log`,
 * `git diff`, correr un test y observar su salida— y quitarlo rompería su
 * trabajo. Lo que se impone es exactamente lo que ya prometen.
 *
 * Un bloqueo acá no ofrece declarar nada (D6): un subagente no tiene contrato
 * que firmar ni usuario a quien avisar. La salida es la de su propia prosa —
 * reportarlo como hallazgo, o escribir en scratch. */

import { join } from "node:path";
import { isInside } from "../guard/paths.ts";
import type { AuthorityRequest, Rule, RuleId } from "./rules.ts";

/** Ata una regla a una lista cerrada de agentes. Sin nombre no aplica: "no sé
 * quién sos" nunca significa "te aplico todo". */
function boundTo(agents: readonly string[], request: AuthorityRequest): boolean {
	return request.caller === "subagent" && request.agent !== undefined && agents.includes(request.agent);
}

/** `scout` y `judge`: miran y no escriben, en ningún lado. Ni siquiera en
 * scratch — no tienen nada que dejar ahí, y permitirlo sería abrir la forma
 * (una redirección) que justamente queremos que no usen. */
export const agentReadOnly: Rule = {
	id: "agent.read-only" satisfies RuleId,
	check(request) {
		if (!boundTo(["scout", "judge"], request)) return undefined;
		return request.paths[0];
	},
};

/** `tester` corre una copia del programa y escribe su informe: todo eso vive
 * bajo `.violeta/scratch/`, y nada más. */
export const agentScratchOnly: Rule = {
	id: "agent.scratch-only" satisfies RuleId,
	check(request) {
		if (!boundTo(["tester"], request)) return undefined;
		return request.paths.find((path) => !isInside(path, request.scratch));
	},
};

/** `critic` lee contratos, no el repositorio. Se expresa como "bajo `tasks/`"
 * y no como "exactamente el archivo que le dieron" (D4): el harness no recibe
 * esa ruta, y pasársela sería más maquinaria para una diferencia que al critic
 * no le cambia nada. Su prosa dice *do not open the repository*, y `tasks/` es
 * justo lo que no es el repositorio. */
export const criticContractOnly: Rule = {
	id: "critic.contract-only" satisfies RuleId,
	check(request) {
		if (!boundTo(["critic"], request)) return undefined;
		const contracts = join(request.root, "tasks");
		return (request.reads ?? []).find((path) => !isInside(path, contracts));
	},
};
