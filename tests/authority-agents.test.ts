// S2-S5 (authority-agents): lo que un agente promete en su prosa, impuesto.
//
// El inventario del 10/11 encontró la falla de Jarvis repetida tres veces, al
// revés: prosa que dice "nunca escribo" en agentes que pueden escribir.
//
//   scout   "never edit source, never create or delete a project file"  -> bash
//   judge   "You read; you never write"                                 -> bash
//   tester  "never edit the project, never edit the contract"           -> write + bash
//   critic  "Read only the contract file you were given"                -> read sin alcance
//
// `--tools` les quita `edit` y `write` de verdad (por eso D4 de authority-bash
// no era del todo falso), pero `bash` escribe igual, y `tester` ni la necesita.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/authority/decide.ts";
import { agentReadOnly, agentScratchOnly, criticContractOnly } from "../src/authority/agent-scope.ts";
import { readPaths, writePaths } from "../src/authority/request.ts";
import type { AuthorityRequest } from "../src/authority/rules.ts";

const ROOT = "/home/u/proj";
const HOME = "/home/u";
const SCRATCH = `${ROOT}/.violeta/scratch`;
const RULES = [agentReadOnly, agentScratchOnly, criticContractOnly];

function request(over: Partial<AuthorityRequest> = {}): AuthorityRequest {
	return { tool: "bash", caller: "subagent", paths: [], root: ROOT, scratch: SCRATCH, ...over };
}

/** Lo que el guard arma de verdad para un comando de shell. */
function shell(agent: string, command: string): AuthorityRequest {
	return request({ agent, tool: "bash", paths: writePaths("bash", { command }, ROOT, HOME) });
}
const run = (r: AuthorityRequest) => decide(r, RULES);

// --- S2: la petición conoce al agente ---------------------------------------

test("una regla atada a unos agentes no toca a los demás ni a la sesión", () => {
	const escritura = { tool: "write", paths: [`${ROOT}/src/x.ts`] };
	assert.equal(run(request({ agent: "scout", ...escritura })).allowed, false);
	assert.deepEqual(run(request({ agent: "builder", ...escritura })), { allowed: true });
	assert.deepEqual(run(request({ caller: "session", ...escritura })), { allowed: true });
});

test("un subagente sin nombre no cae en ninguna regla de agente", () => {
	assert.deepEqual(run(request({ tool: "write", paths: [`${ROOT}/src/x.ts`] })), { allowed: true });
});

// --- S3: agent.read-only ----------------------------------------------------

for (const agent of ["scout", "judge"]) {
	test(`${agent} no escribe por shell, que es el agujero que tenía`, () => {
		const decision = run(shell(agent, "echo roto > src/x.ts"));
		assert.equal(decision.allowed, false);
		assert.equal(decision.allowed === false && decision.rule, "agent.read-only");
		assert.equal(decision.allowed === false && decision.path, `${ROOT}/src/x.ts`);
	});

	test(`${agent} tampoco escribe fuera del proyecto ni en scratch`, () => {
		assert.equal(run(shell(agent, "echo x > /tmp/nota")).allowed, false);
		assert.equal(run(shell(agent, `echo x > ${SCRATCH}/nota`)).allowed, false);
	});

	test(`${agent} mira sin trabas: eso es para lo que tiene bash`, () => {
		for (const command of ["git log --oneline -5", "git diff HEAD~1", "npm test 2>&1 | tail -5", "cat src/x.ts", "ls -la"]) {
			assert.deepEqual(run(shell(agent, command)), { allowed: true }, command);
		}
	});
}

test("scout clona una referencia adentro del proyecto: sigue siendo escritura", () => {
	// Su prosa la autoriza, pero `git clone` no es una forma que el detector
	// reconozca, así que no la frena. Queda escrito para que nadie lo lea como
	// una garantía: lo que se impone son las formas de escritura conocidas.
	assert.deepEqual(run(shell("scout", "git clone --depth 1 https://x/y .violeta/reference/y")), { allowed: true });
});

// --- S4: agent.scratch-only -------------------------------------------------

test("tester escribe en scratch, que es donde corre la copia", () => {
	assert.deepEqual(run(shell("tester", `echo x > ${SCRATCH}/probe/informe.md`)), { allowed: true });
	assert.deepEqual(run(request({ agent: "tester", tool: "write", paths: [`${SCRATCH}/probe/app/x.ts`] })), { allowed: true });
});

test("tester no toca el proyecto real, ni con write ni por comando", () => {
	const porHerramienta = run(request({ agent: "tester", tool: "write", paths: [`${ROOT}/src/x.ts`] }));
	assert.equal(porHerramienta.allowed, false);
	assert.equal(porHerramienta.allowed === false && porHerramienta.rule, "agent.scratch-only");
	assert.equal(run(shell("tester", "sed -i 's/a/b/' src/x.ts")).allowed, false);
});

test("tester no edita el contrato, que su prosa prohíbe expresamente", () => {
	assert.equal(run(request({ agent: "tester", tool: "edit", paths: [`${ROOT}/tasks/demo.md`] })).allowed, false);
});

test("tester copia el proyecto a scratch, que es su primer paso obligatorio", () => {
	assert.deepEqual(run(shell("tester", `cp -r src ${SCRATCH}/probe/app`)), { allowed: true });
});

test("tester mira sin trabas", () => {
	assert.deepEqual(run(shell("tester", "ss -ltn")), { allowed: true });
	assert.deepEqual(run(shell("tester", "curl -s localhost:4000/api")), { allowed: true });
});

// --- S5: critic.contract-only -----------------------------------------------

const lee = (agent: string, path: string) =>
	run(request({ agent, tool: "read", paths: [], reads: readPaths("read", { path }, ROOT, HOME) }));

test("critic lee el contrato, que es su único trabajo", () => {
	assert.deepEqual(lee("critic", "tasks/demo.md"), { allowed: true });
	assert.deepEqual(lee("critic", `${ROOT}/tasks/sub/otro.md`), { allowed: true });
});

test("critic no abre el repositorio, que su prosa prohíbe", () => {
	for (const path of ["src/guard/paths.ts", "agents/builder.md", "README.md", "../otro/x.ts"]) {
		const decision = lee("critic", path);
		assert.equal(decision.allowed, false, path);
		assert.equal(decision.allowed === false && decision.rule, "critic.contract-only");
	}
});

test("los demás leen lo que quieran", () => {
	for (const agent of ["scout", "judge", "builder", "tester"]) {
		assert.deepEqual(lee(agent, "src/guard/paths.ts"), { allowed: true }, agent);
	}
	assert.deepEqual(run(request({ caller: "session", tool: "read", reads: [`${ROOT}/src/x.ts`] })), { allowed: true });
});

// --- readPaths --------------------------------------------------------------

test("readPaths resuelve las herramientas que leen y ninguna otra", () => {
	assert.deepEqual(readPaths("read", { path: "src/x.ts" }, ROOT, HOME), [`${ROOT}/src/x.ts`]);
	assert.deepEqual(readPaths("grep", { path: "src/" }, ROOT, HOME), [`${ROOT}/src`]);
	assert.deepEqual(readPaths("write", { path: "src/x.ts" }, ROOT, HOME), []);
	assert.deepEqual(readPaths("bash", { command: "cat src/x.ts" }, ROOT, HOME), []);
});
