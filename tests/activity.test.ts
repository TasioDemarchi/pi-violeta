import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLine, dotsFrame, phaseForTool } from "../src/activity.ts";
import { setLanguage } from "../src/i18n.ts";

// Identity theme: keeps exact text visible in assertions.
const plain = (_role: string, text: string) => text;

test("dotsFrame cycles through empty, one, two and three dots", () => {
	assert.equal(dotsFrame(0), "");
	assert.equal(dotsFrame(1), ".");
	assert.equal(dotsFrame(2), "..");
	assert.equal(dotsFrame(3), "...");
	assert.equal(dotsFrame(4), "");
	assert.equal(dotsFrame(5), ".");
	assert.equal(dotsFrame(6), "..");
	assert.equal(dotsFrame(7), "...");
});

test("phaseForTool maps read-only tools to explorando", () => {
	for (const name of ["read", "grep", "find", "ls", "codegraph_search"]) {
		assert.equal(phaseForTool(name, {}), "explorando", name);
	}
});

test("phaseForTool maps edit and write to implementando", () => {
	assert.equal(phaseForTool("edit", {}), "implementando");
	assert.equal(phaseForTool("write", {}), "implementando");
});

test("phaseForTool maps test-like bash commands to verificando", () => {
	const checks = ["npm test", "npx vitest run", "pytest -q", "node --test tests/", "tsc --noEmit", "eslint src/", "npm run lint"];
	for (const command of checks) {
		assert.equal(phaseForTool("bash", { command }), "verificando", command);
	}
});

test("phaseForTool maps other bash commands to ejecutando", () => {
	assert.equal(phaseForTool("bash", { command: "git status" }), "ejecutando");
	assert.equal(phaseForTool("bash", { command: "echo hola" }), "ejecutando");
	assert.equal(phaseForTool("bash", {}), "ejecutando");
});

test("phaseForTool falls back to pensando for unknown tools", () => {
	assert.equal(phaseForTool("totally_unknown", {}), "pensando");
});

test("activityLine renders the marker, the phase and the padded dots with the right roles", () => {
	const roles: string[] = [];
	const line = activityLine("implementando", 2, (role, text) => {
		roles.push(role);
		return `<${role}>${text}`;
	});
	assert.equal(line, "<borderAccent>▍ <accent>implementando<muted>.. ");
	assert.ok(roles.includes("borderAccent") && roles.includes("accent") && roles.includes("muted"));
});

test("activityLine keeps a constant width while the dots animate", () => {
	const widths = new Set<string>();
	for (let tick = 0; tick < 8; tick++) widths.add(String(activityLine("verificando", tick, plain).length));
	assert.equal(widths.size, 1);
	assert.equal(activityLine("verificando", 0, plain), "▍ verificando   ");
	assert.equal(activityLine("verificando", 3, plain), "▍ verificando...");
});

// --- English mode (S3): the original English phase labels ----------------------

test("in English the activity phases are the original English words", () => {
	try {
		setLanguage("en");
		for (const name of ["read", "grep", "find", "ls", "codegraph_search"]) {
			assert.equal(phaseForTool(name, {}), "exploring", name);
		}
		assert.equal(phaseForTool("edit", {}), "implementing");
		assert.equal(phaseForTool("write", {}), "implementing");
		assert.equal(phaseForTool("bash", { command: "npm test" }), "checking");
		assert.equal(phaseForTool("bash", { command: "git status" }), "running");
		assert.equal(phaseForTool("totally_unknown", {}), "thinking");
		assert.equal(activityLine("checking", 0, plain), "▍ checking   ");
	} finally {
		setLanguage("es");
	}
});
