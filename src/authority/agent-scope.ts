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
import { type Token, executable, headCursor, segments } from "../guard/command-guard.ts";
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

/** Secretos: archivos cuyo contenido no debería pasar por ningún modelo.
 * `builder.md:91` lo pide para sí —*"Never read secrets, credentials, tokens,
 * private keys or `.env` files"*— y vale para todos. Se compara el nombre del
 * archivo, no la ruta entera, para que `docs/credentials.md` no se confunda con
 * un `credentials`. */
const SECRETS: readonly RegExp[] = [
	/^\.env(\.[^.]*)?$/i, // .env, .env.local — pero no .env.example
	/^id_(rsa|dsa|ecdsa|ed25519)$/i,
	/\.(pem|key|p12|pfx)$/i,
	/^credentials$/i,
	/^auth\.json$/i,
	/^\.(npmrc|netrc|git-credentials|pgpass)$/i,
];

const EXAMPLE = /\.(example|sample|template|dist)$/i;

function isSecret(path: string): boolean {
	const name = path.split("/").at(-1) ?? path;
	if (EXAMPLE.test(name)) return false;
	return SECRETS.some((pattern) => pattern.test(name));
}

/** Las palabras de un comando que podrían ser un archivo: todo lo que no es una
 * opción. Hace falta mirarlas directamente porque `bashPathTargets` sólo busca
 * rutas que necesitan permiso FUERA del proyecto y devuelve vacío para `.env`.
 * Lo encontró la prueba por prompt, con un `cat .env` que pasó limpio. */
function commandWords(command: string): string[] {
	const words: string[] = [];
	for (const tokens of segments(command)) {
		for (const token of tokens) {
			if (!token.operator && !token.value.startsWith("-")) words.push(token.value);
		}
	}
	return words;
}

/** Ningún subagente toca un secreto, lo lea o lo escriba, adentro o afuera del
 * proyecto. No ata a la sesión: el dueño lee lo suyo (D5).
 *
 * Un comando se juzga por lo que NOMBRA. Que mencione un secreto dentro de una
 * cadena y no vaya a abrirlo es posible; frenarlo igual cuesta una vuelta, y
 * dejarlo pasar cuesta la clave. */
export const agentNoSecrets: Rule = {
	id: "agent.no-secrets" satisfies RuleId,
	check(request) {
		if (request.caller !== "subagent") return undefined;
		const named = request.command ? commandWords(request.command) : [];
		return [...(request.touches ?? []), ...(request.reads ?? []), ...request.paths, ...named].find(isSecret);
	},
};

/** Las formas de entregar. `builder.md:96`: *"Never `git add`, `commit`,
 * `push`, publish or release. Delivery is the user's."* Y jarvis.md §5 cierra
 * con lo mismo: la aprobación 2 es el dueño probando el resultado. */
const DELIVERY: Record<string, readonly string[]> = {
	git: ["add", "commit", "push", "tag", "am", "cherry-pick", "revert"],
	npm: ["publish"],
	pnpm: ["publish"],
	yarn: ["publish"],
	gh: ["pr", "release"],
};

/** La primera palabra que no es una opción: el subcomando. */
function subcommand(args: readonly Token[]): string | undefined {
	return args.find((token) => !token.operator && !token.value.startsWith("-"))?.value.toLowerCase();
}

export const agentNoDelivery: Rule = {
	id: "agent.no-delivery" satisfies RuleId,
	check(request) {
		if (request.caller !== "subagent") return undefined;
		const command = request.command;
		if (!command) return undefined;
		for (const tokens of segments(command)) {
			const cursor = headCursor(tokens);
			const head = tokens[cursor];
			if (!head || head.operator) continue;
			const verbs = DELIVERY[executable(head.value)];
			if (!verbs) continue;
			const verb = subcommand(tokens.slice(cursor + 1));
			if (verb !== undefined && verbs.includes(verb)) return `${executable(head.value)} ${verb}`;
		}
		return undefined;
	},
};
