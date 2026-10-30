import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSidebarEnabled, writeSidebarEnabled } from "../src/sidebar-state.ts";

function scratch(): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "violeta-state-"));
	return { dir, file: join(dir, "violeta.json") };
}

test("sidebar defaults to off when the config file does not exist", () => {
	const { file } = scratch();
	assert.equal(readSidebarEnabled(file), false);
});

test("sidebar state round-trips on and off", () => {
	const { dir, file } = scratch();
	try {
		writeSidebarEnabled(file, true);
		assert.equal(readSidebarEnabled(file), true);
		writeSidebarEnabled(file, false);
		assert.equal(readSidebarEnabled(file), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a corrupt config file reads as off", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, "{not json at all");
		assert.equal(readSidebarEnabled(file), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writing preserves unrelated keys in the config", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, JSON.stringify({ theme: "violeta" }));
		writeSidebarEnabled(file, true);
		assert.equal(readSidebarEnabled(file), true);
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		assert.equal(parsed.theme, "violeta");
		assert.equal(parsed.sidebar, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
