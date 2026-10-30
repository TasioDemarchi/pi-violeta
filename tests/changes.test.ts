import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStatus, parseStatusFiles, emptyChanges } from "../src/changes.ts";

test("untracked and added files count as created", () => {
	const c = parseStatus("?? new.txt\0A  staged.ts\0");
	assert.deepEqual(c, { created: 2, updated: 0, deleted: 0 });
});

test("modified in index or worktree counts as updated", () => {
	const c = parseStatus(" M a.ts\0M  b.ts\0MM c.ts\0");
	assert.deepEqual(c, { created: 0, updated: 3, deleted: 0 });
});

test("deleted in index or worktree counts as deleted", () => {
	const c = parseStatus(" D a.ts\0D  b.ts\0");
	assert.deepEqual(c, { created: 0, updated: 0, deleted: 2 });
});

test("a rename consumes its second path entry and counts as updated", () => {
	const c = parseStatus("R  new.ts\0old.ts\0 M other.ts\0");
	assert.deepEqual(c, { created: 0, updated: 2, deleted: 0 });
});

test("empty output yields no changes", () => {
	assert.deepEqual(parseStatus(""), emptyChanges());
});

test("parseStatusFiles lists created file names", () => {
	const f = parseStatusFiles("?? new.txt\0A  staged.ts\0");
	assert.deepEqual(f, { created: ["new.txt", "staged.ts"], updated: [], deleted: [] });
});

test("parseStatusFiles lists updated and deleted file names", () => {
	const f = parseStatusFiles(" M a.ts\0D  b.ts\0 D c.ts\0");
	assert.deepEqual(f, { created: [], updated: ["a.ts"], deleted: ["b.ts", "c.ts"] });
});

test("parseStatusFiles lists the new path of a rename and consumes the old one", () => {
	const f = parseStatusFiles("R  new.ts\0old.ts\0 M other.ts\0");
	assert.deepEqual(f, { created: [], updated: ["new.ts", "other.ts"], deleted: [] });
});

test("parseStatusFiles of empty output is all-empty", () => {
	assert.deepEqual(parseStatusFiles(""), { created: [], updated: [], deleted: [] });
});

test("parseStatus counts match the parsed file lists", () => {
	const raw = "?? new.txt\0 M a.ts\0D  b.ts\0R  n.ts\0o.ts\0";
	const f = parseStatusFiles(raw);
	assert.deepEqual(parseStatus(raw), {
		created: f.created.length,
		updated: f.updated.length,
		deleted: f.deleted.length,
	});
});
