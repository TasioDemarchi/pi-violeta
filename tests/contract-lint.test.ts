import { test } from "node:test";
import assert from "node:assert/strict";
import { formatLint, lintContract } from "../src/contract/lint.ts";

const VALID = `# pantalla-violeta
Mostrar "Violeta" en la tablet y confirmarlo desde el host.
Runner: node --test tests/*.test.ts

## No-objetivos
- Sin UI más allá de ese texto.

## Specs
S0. La app instala y muestra "Violeta" en la tablet.
    Accept: el host lee "Violeta" de la pantalla
    Check: adb exec-out screencap | grep -q Violeta
S1. El texto está en App.tsx.
    Accept: App.tsx contiene el literal Violeta
    Check: grep -q Violeta App.tsx

## Tasks
T0. Spike de punta a punta — specs: S0 — test: n/a — riesgo: sí — commit: -
T1. Texto en App.tsx — specs: S1 — test: recommended — riesgo: no — commit: -

## Decisiones
D1. Paquete dev.tasio.violeta.

## Log
L1. Quiero ver Violeta en la tablet.
`;

const rules = (text: string) => lintContract(text).errors.map((e) => e.rule);

test("a complete contract passes with no errors", () => {
	const result = lintContract(VALID);
	assert.deepEqual(result.errors, []);
	assert.equal(result.ok, true);
	assert.equal(formatLint(result), "contract_check: OK");
});

test("missing sections are reported one by one", () => {
	const result = lintContract("# x\nintent\n");
	assert.deepEqual(new Set(rules("# x\nintent\n")), new Set(["no-objetivos", "specs", "tasks", "log"]));
	assert.equal(result.ok, false);
});

test("an empty No-objetivos section is an error", () => {
	const text = VALID.replace("- Sin UI más allá de ese texto.", "");
	assert.ok(rules(text).includes("no-objetivos"));
});

test("a spec needs Accept and a real Check", () => {
	assert.ok(rules(VALID.replace('    Accept: App.tsx contiene el literal Violeta\n', "")).includes("accept"));
	assert.ok(rules(VALID.replace("Check: grep -q Violeta App.tsx", "Check: <comando>")).includes("check"));
	assert.ok(rules(VALID.replace("Check: grep -q Violeta App.tsx", "Check: TODO")).includes("check"));
	assert.deepEqual(rules(VALID.replace("Check: grep -q Violeta App.tsx", "Check: manual: se ve el texto")), []);
});

test("a task must cite existing specs, a test verdict and a risk flag", () => {
	assert.ok(rules(VALID.replace("specs: S1", "specs: S9")).includes("task-specs"));
	assert.ok(rules(VALID.replace("specs: S1 — ", "")).includes("task-specs"));
	assert.ok(rules(VALID.replace("test: recommended", "test: maybe")).includes("task-test"));
	assert.ok(rules(VALID.replace(" — riesgo: no", "")).includes("task-risk"));
});

test("a spec no task covers is reported", () => {
	assert.ok(rules(VALID.replace("specs: S1", "specs: S0")).includes("uncovered-spec"));
});

test("the log must keep the user's request as L1", () => {
	assert.ok(rules(VALID.replace("L1. Quiero ver Violeta en la tablet.", "L1. <pedido>")).includes("log-l1"));
});

test("naming an external system requires the S0/T0 spike, unless declared absent", () => {
	const noSpike = VALID.replace(/S0\.[\s\S]*?(?=S1\.)/, "").replace(/T0\..*\n/, "").replace("adb exec-out screencap", "grep");
	// Still mentions the tablet in the intent, so the spike is required.
	assert.ok(rules(noSpike).includes("spike"));
	assert.ok(!rules(`${noSpike}\nExterno: no\n`).includes("spike"));
	// A contract that names nothing external needs no spike.
	const internal = noSpike.replace(/tablet/g, "pantalla");
	assert.ok(!rules(internal).includes("spike"));
});

test("a long contract warns without failing", () => {
	const long = `${VALID}${"\n".repeat(120)}`;
	const result = lintContract(long);
	assert.equal(result.ok, true);
	assert.equal(result.warnings[0]?.rule, "length");
	assert.match(formatLint(result), /OK with warnings/);
});

test("errors carry the line they point at", () => {
	const result = lintContract(VALID.replace("Check: grep -q Violeta App.tsx", "Check: <x>"));
	const issue = result.errors.find((e) => e.rule === "check")!;
	assert.match(issue.message, /S1/);
	assert.equal(VALID.replace("Check: grep -q Violeta App.tsx", "Check: <x>").split("\n")[issue.line! - 1]!.startsWith("S1."), true);
});
