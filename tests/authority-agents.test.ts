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
import { agentNoDelivery, agentNoSecrets, agentReadOnly, agentScratchOnly, criticContractOnly } from "../src/authority/agent-scope.ts";
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

// --- S6 (authority-handoff): agent.no-secrets --------------------------------
// builder.md:91 dice "Never read secrets, credentials, tokens, private keys or
// .env files". Valía para todos y no la imponía nadie. Ata a cualquier
// subagente (D4), no a una lista de nombres: un agente nuevo debería nacer con
// ella puesta. No ata a la sesión: el dueño lee sus propios secretos (D5).

const toca = (over: Partial<AuthorityRequest>) =>
	decide(request({ agent: "builder", tool: "read", ...over }), [agentNoSecrets, agentNoDelivery]);

test("ningún subagente toca un secreto, lo lea o lo escriba", () => {
	for (const nombre of [".env", ".env.local", "id_rsa", "id_ed25519", "server.pem", "tls.key", "credentials", "auth.json", ".npmrc", ".netrc", ".git-credentials"]) {
		const decision = toca({ touches: [`${ROOT}/${nombre}`] });
		assert.equal(decision.allowed, false, nombre);
		assert.equal(decision.allowed === false && decision.rule, "agent.no-secrets");
	}
});

test("un secreto fuera del proyecto tampoco", () => {
	assert.equal(toca({ touches: [`${HOME}/.ssh/id_rsa`] }).allowed, false);
	assert.equal(toca({ touches: [`${HOME}/.violeta/agent/auth.json`] }).allowed, false);
});

test("lo que sólo se parece a un secreto pasa", () => {
	for (const nombre of [".env.example", "env.d.ts", "src/keys.ts", "docs/credentials.md", "README.md"]) {
		assert.deepEqual(toca({ touches: [`${ROOT}/${nombre}`] }), { allowed: true }, nombre);
	}
});

test("un comando que abre un secreto también se frena", () => {
	assert.equal(toca({ tool: "bash", command: "cat .env", touches: [`${ROOT}/.env`] }).allowed, false);
});

test("la sesión lee lo suyo: la regla es para lo que corre sin que el dueño mire (D5)", () => {
	assert.deepEqual(decide(request({ caller: "session", tool: "read", touches: [`${ROOT}/.env`] }), [agentNoSecrets]), { allowed: true });
});

// --- S7 (authority-handoff): agent.no-delivery -------------------------------
// builder.md:96 dice "Never git add, commit, push, publish or release. Delivery
// is the user's." Y jarvis.md §5 cierra con lo mismo para la aprobación 2.

const corre = (command: string, over: Partial<AuthorityRequest> = {}) =>
	decide(request({ agent: "builder", tool: "bash", command, ...over }), [agentNoDelivery]);

test("ningún subagente entrega: la entrega es del dueño", () => {
	for (const command of ["git add -A", "git commit -m x", "git push origin main", "git tag v1", "npm publish", "gh pr create --fill"]) {
		const decision = corre(command);
		assert.equal(decision.allowed, false, command);
		assert.equal(decision.allowed === false && decision.rule, "agent.no-delivery");
	}
});

test("mirar el repositorio es su trabajo y no se toca", () => {
	for (const command of ["git status --short", "git diff HEAD~1", "git log --oneline -5", "git show HEAD", "npm test", "npm run build"]) {
		assert.deepEqual(corre(command), { allowed: true }, command);
	}
});

test("la entrega escondida detrás de un `&&` o un envoltorio tampoco pasa", () => {
	assert.equal(corre("npm test && git commit -am ok").allowed, false);
	assert.equal(corre("sudo git push").allowed, false);
});

test("la sesión commitea cuando el dueño quiere", () => {
	assert.deepEqual(decide(request({ caller: "session", tool: "bash", command: "git commit -m x" }), [agentNoDelivery]), { allowed: true });
});

// Encontrado por la prueba por prompt: un `builder` leyó un `.env` con
// `cat .env` y el valor salió en su respuesta. La regla miraba
// `bashPathTargets`, que sólo busca rutas que necesitan permiso FUERA del
// proyecto y devuelve [] para `.env`. Un comando que NOMBRA un secreto se
// frena por su propio texto.
test("un comando que nombra un secreto se frena, tenga barras o no", () => {
	for (const command of ["cat .env", "cat ./.env", "cat /otro/proj/.env", "grep API_KEY .env", "head -5 config/credentials", "cat ~/.ssh/id_rsa"]) {
		const decision = decide(request({ agent: "builder", tool: "bash", command }), [agentNoSecrets]);
		assert.equal(decision.allowed, false, command);
		assert.equal(decision.allowed === false && decision.rule, "agent.no-secrets");
	}
});

test("un comando que sólo nombra algo parecido pasa", () => {
	for (const command of ["cat .env.example", "cat src/keys.ts", "ls -la", "grep -rn env src/", "npm test"]) {
		assert.deepEqual(decide(request({ agent: "builder", tool: "bash", command }), [agentNoSecrets]), { allowed: true }, command);
	}
});
