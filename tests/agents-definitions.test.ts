import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listAgentDefinitions, parseDefinition } from "../src/agents/definitions.ts";

const VALID = `---
name: probe
description: A probe agent
model: nan/deepseek-v4-flash
thinking: low
tools:
  - read
  - grep
---

You are a probe. Answer tersely.
`;

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "violeta-defs-"));
}

test("parseDefinition reads frontmatter and body", () => {
	const def = parseDefinition(VALID, "probe.md");
	assert.equal(def.name, "probe");
	assert.equal(def.description, "A probe agent");
	assert.equal(def.model, "nan/deepseek-v4-flash");
	assert.equal(def.thinking, "low");
	assert.deepEqual(def.tools, ["read", "grep"]);
	assert.equal(def.prompt, "You are a probe. Answer tersely.");
	assert.equal(def.source, "probe.md");
});

test("parseDefinition accepts an inline tools list and strips quotes", () => {
	const def = parseDefinition('---\nname: "quoted"\nmodel: m\nmodel-x: ignored\ntools: [read, "bash"]\n---\nBody.', "q.md");
	assert.equal(def.name, "quoted");
	assert.deepEqual(def.tools, ["read", "bash"]);
	assert.equal(def.description, "");
	assert.equal(def.thinking, undefined);
});

test("parseDefinition rejects a file without frontmatter", () => {
	assert.throws(() => parseDefinition("just text", "x.md"), /frontmatter/i);
});

test("parseDefinition rejects a missing or empty name", () => {
	assert.throws(() => parseDefinition("---\nmodel: m\n---\nBody.", "x.md"), /name/i);
	assert.throws(() => parseDefinition("---\nname: \"\"\nmodel: m\n---\nBody.", "x.md"), /name/i);
});

test("parseDefinition rejects a missing model", () => {
	assert.throws(() => parseDefinition("---\nname: a\n---\nBody.", "x.md"), /model/i);
});

test("parseDefinition rejects an empty body", () => {
	assert.throws(() => parseDefinition("---\nname: a\nmodel: m\n---\n   \n", "x.md"), /system prompt|body/i);
});

test("listAgentDefinitions collects errors and keeps valid files", () => {
	const dir = scratch();
	try {
		writeFileSync(join(dir, "good.md"), VALID);
		writeFileSync(join(dir, "bad.md"), "no frontmatter here");
		writeFileSync(join(dir, "notes.txt"), "ignored");
		const { definitions, errors } = listAgentDefinitions(dir);
		assert.equal(definitions.length, 1);
		assert.equal(definitions[0]?.name, "probe");
		assert.equal(errors.length, 1);
		assert.match(errors[0]!.source, /bad\.md$/);
		assert.match(errors[0]!.message, /frontmatter/i);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("listAgentDefinitions tolerates a missing directory", () => {
	const { definitions, errors } = listAgentDefinitions(join(tmpdir(), "violeta-nope-" + Math.random().toString(36).slice(2)));
	assert.deepEqual(definitions, []);
	assert.deepEqual(errors, []);
});
