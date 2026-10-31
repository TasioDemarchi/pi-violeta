import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNotifyEnabled, writeNotifyEnabled } from "../src/notify-state.ts";

function scratch(): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "violeta-notify-"));
	return { dir, file: join(dir, "violeta.json") };
}

test("notify defaults to off when the config file does not exist", () => {
	const { file } = scratch();
	assert.equal(readNotifyEnabled(file), false);
});

test("the notify preference round-trips on and off", () => {
	const { dir, file } = scratch();
	try {
		writeNotifyEnabled(file, true);
		assert.equal(readNotifyEnabled(file), true);
		writeNotifyEnabled(file, false);
		assert.equal(readNotifyEnabled(file), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("a corrupt config file reads as off", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, "{not json at all");
		assert.equal(readNotifyEnabled(file), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("an invalid stored value reads as off", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, JSON.stringify({ notify: "yes" }));
		assert.equal(readNotifyEnabled(file), false);
		writeFileSync(file, JSON.stringify({ notify: 1 }));
		assert.equal(readNotifyEnabled(file), false);
		writeFileSync(file, JSON.stringify({ notify: null }));
		assert.equal(readNotifyEnabled(file), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writing notify preserves unrelated keys (sidebar, language)", () => {
	const { dir, file } = scratch();
	try {
		writeFileSync(file, JSON.stringify({ sidebar: true, language: "en" }));
		writeNotifyEnabled(file, true);
		const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
		assert.equal(parsed.sidebar, true);
		assert.equal(parsed.language, "en");
		assert.equal(parsed.notify, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("writeNotifyEnabled creates the parent directory when it is missing", () => {
	const dir = mkdtempSync(join(tmpdir(), "violeta-notify-"));
	const file = join(dir, "nested", "violeta.json");
	try {
		writeNotifyEnabled(file, true);
		assert.equal(readNotifyEnabled(file), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
