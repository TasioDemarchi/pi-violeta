import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLanguage, writeLanguage } from "../src/language-state.ts";
import { readSidebarEnabled, writeSidebarEnabled } from "../src/sidebar-state.ts";

function scratch(): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "violeta-language-"));
	return { dir, file: join(dir, "violeta.json") };
}

test("language defaults to es when the config file does not exist", () => {
	const { file } = scratch();
	assert.equal(readLanguage(file), "es");
});

test("the language preference round-trips en and es", () => {
	const { dir, file } = scratch();
	try {
		writeLanguage(file, "en");
		assert.equal(readLanguage(file), "en");
		writeLanguage(file, "es");
		assert.equal(readLanguage(file), "es");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a corrupt config file reads as es", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, "{not json at all");
		assert.equal(readLanguage(file), "es");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an invalid stored value reads as es", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, JSON.stringify({ language: "fr" }));
		assert.equal(readLanguage(file), "es");
		writeFileSync(file, JSON.stringify({ language: 42 }));
		assert.equal(readLanguage(file), "es");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writing the language preserves unrelated keys and the sidebar flag", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, JSON.stringify({ theme: "violeta" }));
		writeSidebarEnabled(file, true);
		writeLanguage(file, "en");
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		assert.equal(parsed.theme, "violeta");
		assert.equal(parsed.sidebar, true);
		assert.equal(parsed.language, "en");
		assert.equal(readSidebarEnabled(file), true);
		assert.equal(readLanguage(file), "en");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writeLanguage creates the parent directory when it is missing", () => {
	const dir = mkdtempSync(join(tmpdir(), "violeta-language-"));
	const file = join(dir, "nested", "violeta.json");
	try {
		writeLanguage(file, "en");
		assert.equal(readLanguage(file), "en");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
