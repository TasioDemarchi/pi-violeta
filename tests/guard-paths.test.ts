import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedLocation, bashPathTargets, grantScope, isInside, isScratch, resolvePath, toolCallPaths } from "../src/guard/paths.ts";

const CWD = "/repo";
const HOME = "/home/tester";

test("resolvePath resolves relative paths against the working directory", () => {
	assert.equal(resolvePath("foo/bar.txt", CWD, HOME), "/repo/foo/bar.txt");
	assert.equal(resolvePath("./x", CWD, HOME), "/repo/x");
	assert.equal(resolvePath(".", CWD, HOME), "/repo");
});

test("resolvePath collapses .. lexically (no symlink resolution)", () => {
	assert.equal(resolvePath("a/../b", CWD, HOME), "/repo/b");
	assert.equal(resolvePath("../elsewhere/x", CWD, HOME), "/elsewhere/x");
	assert.equal(resolvePath("sub/../../top", CWD, HOME), "/top");
});

test("resolvePath drops trailing slashes", () => {
	assert.equal(resolvePath("dir/", CWD, HOME), "/repo/dir");
	assert.equal(resolvePath("/tmp/other/", CWD, HOME), "/tmp/other");
});

test("resolvePath expands ~ and $HOME", () => {
	assert.equal(resolvePath("~", CWD, HOME), HOME);
	assert.equal(resolvePath("~/notes.md", CWD, HOME), "/home/tester/notes.md");
	assert.equal(resolvePath("$HOME/docs", CWD, HOME), "/home/tester/docs");
	assert.equal(resolvePath("${HOME}/docs", CWD, HOME), "/home/tester/docs");
});

test("resolvePath keeps absolute paths", () => {
	assert.equal(resolvePath("/tmp/other", CWD, HOME), "/tmp/other");
});

test("isInside decides inside/outside including the root itself, without prefix tricks", () => {
	assert.equal(isInside("/repo/a", "/repo"), true);
	assert.equal(isInside("/repo", "/repo"), true);
	assert.equal(isInside("/repo/sub/f.ts", "/repo/sub"), true);
	assert.equal(isInside("/repository", "/repo"), false);
	assert.equal(isInside("/tmp/x", "/repo"), false);
	assert.equal(isInside("/repozy/a", "/repo"), false);
});

test("allowedLocation always allows the project root and the agent dir", () => {
	const agentDir = "/home/tester/.violeta/agent";
	assert.equal(allowedLocation("/repo/src/x.ts", CWD, agentDir), true);
	assert.equal(allowedLocation("/home/tester/.violeta/agent/logs/x", CWD, agentDir), true);
	assert.equal(allowedLocation("/tmp/other/x", CWD, agentDir), false);
	assert.equal(allowedLocation("/tmp/other/x", CWD, undefined), false);
});

test("bashPathTargets finds literal path arguments that resolve outside the root", () => {
	assert.deepEqual(bashPathTargets("ls /tmp/other", CWD, HOME), ["/tmp/other"]);
	assert.deepEqual(bashPathTargets("cat ../other/x", CWD, HOME), ["/other/x"]);
	assert.deepEqual(bashPathTargets("cat ~/notes.md", CWD, HOME), ["/home/tester/notes.md"]);
	assert.deepEqual(bashPathTargets("grep -r pattern /var/log", CWD, HOME), ["/var/log"]);
	assert.deepEqual(bashPathTargets("sudo cat /etc/passwd", CWD, HOME), ["/etc/passwd"]);
	assert.deepEqual(bashPathTargets("git -C /elsewhere status", CWD, HOME), ["/elsewhere"]);
});

test("bashPathTargets ignores paths inside the project and deduplicates", () => {
	assert.deepEqual(bashPathTargets("cat /repo/README.md", CWD, HOME), []);
	assert.deepEqual(bashPathTargets("cat /tmp/a /tmp/a", CWD, HOME), ["/tmp/a"]);
	assert.deepEqual(bashPathTargets("cat /tmp/a /repo/b", CWD, HOME), ["/tmp/a"]);
});

test("bashPathTargets never sees quoted prose or flags as paths", () => {
	assert.deepEqual(bashPathTargets('git commit -m "fix /etc/hosts"', CWD, HOME), []);
	assert.deepEqual(bashPathTargets("echo hello world", CWD, HOME), []);
	assert.deepEqual(bashPathTargets("echo 'see /etc/hosts'", CWD, HOME), []);
	assert.deepEqual(bashPathTargets("cat << EOF\nsee /etc/hosts\nEOF", CWD, HOME), []);
	assert.deepEqual(bashPathTargets("grep -m 1 pattern .", CWD, HOME), []);
});

test("bashPathTargets treats each segment separately", () => {
	assert.deepEqual(bashPathTargets("echo hi && ls /tmp/other", CWD, HOME), ["/tmp/other"]);
	assert.deepEqual(bashPathTargets("ls /tmp/a; cat /tmp/b", CWD, HOME), ["/tmp/a", "/tmp/b"]);
});

test("toolCallPaths extracts the path argument of grantable tools", () => {
	assert.deepEqual(toolCallPaths("read", { path: "src/x.ts" }), ["src/x.ts"]);
	assert.deepEqual(toolCallPaths("write", { path: "a.md", content: "" }), ["a.md"]);
	assert.deepEqual(toolCallPaths("edit", { path: "a.md", edits: [] }), ["a.md"]);
	assert.deepEqual(toolCallPaths("grep", { pattern: "x", path: "/tmp/y" }), ["/tmp/y"]);
	assert.deepEqual(toolCallPaths("find", { pattern: "*.ts", path: "lib" }), ["lib"]);
	assert.deepEqual(toolCallPaths("ls", { path: "/tmp/z" }), ["/tmp/z"]);
});

test("toolCallPaths leaves tools without an explicit path alone (they default to cwd)", () => {
	assert.deepEqual(toolCallPaths("grep", { pattern: "x" }), []);
	assert.deepEqual(toolCallPaths("find", { pattern: "*.ts" }), []);
	assert.deepEqual(toolCallPaths("ls", {}), []);
	assert.deepEqual(toolCallPaths("read", {}), []);
	assert.deepEqual(toolCallPaths("totally_custom", { anything: "/tmp/y" }), []);
});

test("grantScope collapses a temp directory to the temp root", () => {
	// mktemp -d returns a new name every run, so a grant on it asks again every
	// run. The root is scratch by definition, so one grant covers all of them.
	const root = "/tmp";
	assert.equal(grantScope("/tmp/violeta-agent-abc123", root), "/tmp");
	assert.equal(grantScope("/tmp/violeta-agent-abc123/sub", root), "/tmp");
	assert.equal(grantScope("/tmp", root), "/tmp");
	// Containment uses the guard's own boundary: /tmpfoo is not inside /tmp.
	assert.equal(grantScope("/tmpfoo/x", root), "/tmpfoo/x");
	// Anything else keeps its own directory.
	assert.equal(grantScope("/home/tasio/other", root), "/home/tasio/other");
});

test("the system temp root is scratch space, and needs no permission at all", () => {
	// What the owner saw: a dialog for /tmp on every session, for the one
	// place the harness itself writes to and the system wipes on its own.
	assert.equal(isScratch("/tmp", "/tmp"), true);
	assert.equal(isScratch("/tmp/violeta-voice-abc123/line.wav", "/tmp"), true);
	assert.equal(isScratch("/tmp/nested/deep/file.txt", "/tmp"), true);
	// The boundary is the same one the rest of the guard uses: a directory
	// whose name merely starts with the root is NOT inside it.
	assert.equal(isScratch("/tmpfoo", "/tmp"), false);
	assert.equal(isScratch("/home/tachii/dev", "/tmp"), false);
	// A trailing separator in the configured root must not break the test.
	assert.equal(isScratch("/tmp/x", "/tmp/"), true);
});
