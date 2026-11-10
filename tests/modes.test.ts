import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMode, listModes, modeExposes, parseMode, RAW_MODE } from "../src/modes/definitions.ts";
import { DEFAULT_MODE, readActiveMode, writeActiveMode } from "../src/modes/state.ts";

const MODE = `---
name: jarvis
description: You decide, Jarvis executes
model: nan/glm5.3
agents: [scout, builder, tester]
---

Work proportionally. Delegate only with a named reason.
`;

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "violeta-modes-"));
}

test("parseMode reads the frontmatter and keeps the body as the prompt", () => {
	const mode = parseMode(MODE, "jarvis.md");
	assert.equal(mode.name, "jarvis");
	assert.equal(mode.description, "You decide, Jarvis executes");
	assert.equal(mode.model, "nan/glm5.3");
	assert.deepEqual(mode.agents, ["scout", "builder", "tester"]);
	assert.equal(mode.prompt, "Work proportionally. Delegate only with a named reason.");
});

test("an absent agents list exposes every agent, a declared empty one exposes none", () => {
	// The difference is a real choice: "I did not narrow the roster" is not the
	// same statement as "this mode has no agents".
	const open = parseMode(MODE.replace("agents: [scout, builder, tester]\n", ""), "open.md");
	assert.equal(open.agents, undefined);
	assert.ok(modeExposes(open, "anything"));

	const closed = parseMode(MODE.replace("agents: [scout, builder, tester]", "agents:"), "closed.md");
	assert.deepEqual(closed.agents, []);
	assert.ok(!modeExposes(closed, "scout"));
});

test("modeExposes honours the list and treats an unknown mode as unrestricted", () => {
	const mode = parseMode(MODE, "jarvis.md");
	assert.ok(modeExposes(mode, "scout"));
	assert.ok(!modeExposes(mode, "ghost"));
	assert.ok(modeExposes(undefined, "scout"));
});

test("parseMode rejects a file without a name", () => {
	assert.throws(() => parseMode(MODE.replace("name: jarvis", "name:"), "bad.md"), /name/);
});

test("parseMode accepts a mode with no body, which is a mode that adds no prompt", () => {
	const quiet = parseMode("---\nname: quiet\n---\n", "quiet.md");
	assert.equal(quiet.prompt, "");
});

test("listModes always offers raw, even with no modes directory", () => {
	// raw is the escape hatch: it has to survive a missing, empty or broken
	// catalogue, or a bad mode file could leave the session with no way out.
	const { modes, errors } = listModes(join(scratch(), "does-not-exist"));
	assert.deepEqual(modes.map((m) => m.name), ["raw"]);
	assert.deepEqual(errors, []);
	assert.deepEqual(RAW_MODE.agents, []);
	assert.equal(RAW_MODE.prompt, "");
});

test("listModes loads files, appends raw, and reports broken ones without dropping the rest", () => {
	const dir = scratch();
	try {
		writeFileSync(join(dir, "jarvis.md"), MODE);
		writeFileSync(join(dir, "broken.md"), "no frontmatter here");
		const { modes, errors } = listModes(dir);
		assert.deepEqual(modes.map((m) => m.name), ["jarvis", "raw"]);
		assert.equal(errors.length, 1);
		assert.match(errors[0]!.source, /broken\.md$/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a raw.md in the catalogue replaces the built-in", () => {
	const dir = scratch();
	try {
		writeFileSync(join(dir, "raw.md"), "---\nname: raw\ndescription: mine\n---\n\nMy own raw.\n");
		const { modes } = listModes(dir);
		assert.equal(modes.filter((m) => m.name === "raw").length, 1);
		assert.equal(findMode(modes, "raw")!.description, "mine");
		assert.equal(findMode(modes, "raw")!.prompt, "My own raw.");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("findMode returns undefined for an unknown name", () => {
	const { modes } = listModes(join(scratch(), "nope"));
	assert.equal(findMode(modes, "ghost"), undefined);
});

test("the active mode defaults, round-trips, and preserves unrelated keys", () => {
	const dir = scratch();
	try {
		const file = join(dir, "violeta.json");
		assert.equal(readActiveMode(file), DEFAULT_MODE);

		writeFileSync(file, JSON.stringify({ sidebar: true, language: "es" }));
		assert.equal(readActiveMode(file), DEFAULT_MODE);

		writeActiveMode(file, "scout");
		assert.equal(readActiveMode(file), "scout");
		const config = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		assert.equal(config.sidebar, true);
		assert.equal(config.language, "es");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a corrupt or non-string mode preference falls back to the default", () => {
	const dir = scratch();
	try {
		const file = join(dir, "violeta.json");
		writeFileSync(file, "{oops");
		assert.equal(readActiveMode(file), DEFAULT_MODE);
		writeFileSync(file, JSON.stringify({ mode: 7 }));
		assert.equal(readActiveMode(file), DEFAULT_MODE);
		writeFileSync(file, JSON.stringify({ mode: "   " }));
		assert.equal(readActiveMode(file), DEFAULT_MODE);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
