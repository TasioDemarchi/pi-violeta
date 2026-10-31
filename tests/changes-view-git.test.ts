import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { diffHead, readUntracked, statusFiles } from "../src/changes-view/git.ts";

/** Scratch git repo built under the system temp dir; never the project repo. */
let repo = "";
let plain = "";

function git(cwd: string, ...args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile("git", ["-C", cwd, ...args], (err, stdout, stderr) => (err ? reject(new Error(String(stderr))) : resolve(stdout)));
	});
}

before(async () => {
	repo = mkdtempSync(join(tmpdir(), "violeta-changes-repo-"));
	plain = mkdtempSync(join(tmpdir(), "violeta-changes-plain-"));
	await git(repo, "init");
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test");
	writeFileSync(join(repo, "base.txt"), "one\ntwo\n");
	writeFileSync(join(repo, "del.txt"), "bye\n");
	await git(repo, "add", ".");
	await git(repo, "commit", "-m", "base");
	// one committed file modified
	writeFileSync(join(repo, "base.txt"), "one\nTWO\nthree\n");
	// one deleted
	unlinkSync(join(repo, "del.txt"));
	// three untracked
	writeFileSync(join(repo, "new.txt"), "hola\nmundo\n");
	writeFileSync(join(repo, "new2.txt"), "más contenido\n");
	writeFileSync(join(repo, "new3.txt"), "tercero\n");
	// one untracked binary file (NUL byte)
	writeFileSync(join(repo, "img.bin"), Buffer.from([0x89, 0x00, 0x01, 0x02]));
});

after(() => {
	rmSync(repo, { recursive: true, force: true });
	rmSync(plain, { recursive: true, force: true });
});

test("statusFiles reports created, updated and deleted files from the scratch repo", async () => {
	const files = await statusFiles(repo);
	assert.ok(files, "the scratch dir is a git repository");
	assert.deepEqual([...files.created].sort(), ["img.bin", "new.txt", "new2.txt", "new3.txt"]);
	assert.deepEqual([...files.updated].sort(), ["base.txt"]);
	assert.deepEqual([...files.deleted].sort(), ["del.txt"]);
});

test("statusFiles returns null outside a git repository", async () => {
	assert.equal(await statusFiles(plain), null);
});

test("diffHead returns the tracked change with -old/+new lines", async () => {
	const raw = await diffHead(repo, "base.txt");
	assert.ok(raw.includes("-two"), raw);
	assert.ok(raw.includes("+TWO"), raw);
	assert.ok(raw.includes("+three"), raw);
});

test("diffHead returns the removed content of a deleted file", async () => {
	const raw = await diffHead(repo, "del.txt");
	assert.ok(raw.includes("-bye"), raw);
	assert.ok(raw.includes("deleted file mode") || raw.includes("--- a/del.txt"), raw);
});

test("diffHead returns empty text for a path without a diff", async () => {
	assert.equal(await diffHead(repo, "new.txt"), "");
});

test("readUntracked reads text content for the + rendering", async () => {
	const content = await readUntracked(repo, "new.txt");
	assert.equal(content.binary, false);
	assert.equal(content.text, "hola\nmundo\n");
});

test("readUntracked detects binary content", async () => {
	const content = await readUntracked(repo, "img.bin");
	assert.equal(content.binary, true);
});

test("readUntracked of a missing path is empty text, not binary", async () => {
	const content = await readUntracked(repo, "no-such-file.txt");
	assert.equal(content.binary, false);
	assert.equal(content.text, "");
});
