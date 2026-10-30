import { test } from "node:test";
import assert from "node:assert/strict";
import { activityLine, dotsFrame, phaseForTool } from "../src/activity.ts";

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

test("phaseForTool maps read-only tools to exploring", () => {
	for (const name of ["read", "grep", "find", "ls", "codegraph_search"]) {
		assert.equal(phaseForTool(name, {}), "exploring", name);
	}
});

test("phaseForTool maps edit and write to implementing", () => {
	assert.equal(phaseForTool("edit", {}), "implementing");
	assert.equal(phaseForTool("write", {}), "implementing");
});

test("phaseForTool maps test-like bash commands to checking", () => {
	const checks = ["npm test", "npx vitest run", "pytest -q", "node --test tests/", "tsc --noEmit", "eslint src/", "npm run lint"];
	for (const command of checks) {
		assert.equal(phaseForTool("bash", { command }), "checking", command);
	}
});

test("phaseForTool maps other bash commands to running", () => {
	assert.equal(phaseForTool("bash", { command: "git status" }), "running");
	assert.equal(phaseForTool("bash", { command: "echo hola" }), "running");
	assert.equal(phaseForTool("bash", {}), "running");
});

test("phaseForTool falls back to thinking for unknown tools", () => {
	assert.equal(phaseForTool("totally_unknown", {}), "thinking");
});

test("activityLine renders the marker, the phase and the padded dots with the right roles", () => {
	const roles: string[] = [];
	const line = activityLine("implementing", 2, (role, text) => {
		roles.push(role);
		return `<${role}>${text}`;
	});
	assert.equal(line, "<borderAccent>▍ <accent>implementing<muted>.. ");
	assert.ok(roles.includes("borderAccent") && roles.includes("accent") && roles.includes("muted"));
});

test("activityLine keeps a constant width while the dots animate", () => {
	const widths = new Set<string>();
	for (let tick = 0; tick < 8; tick++) widths.add(String(activityLine("checking", tick, plain).length));
	assert.equal(widths.size, 1);
	assert.equal(activityLine("checking", 0, plain), "▍ checking   ");
	assert.equal(activityLine("checking", 3, plain), "▍ checking...");
});
