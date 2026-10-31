import { test } from "node:test";
import assert from "node:assert/strict";
import {
	diffStats,
	formatDuration,
	formatToolSummary,
	summarizeCall,
	summarizeResult,
	truncateLine,
} from "../src/tools-view/summarize.ts";
import { shortenPath } from "../src/tools-view/paths.ts";
import { styledSummary, withCompactRenderer } from "../src/tools-view/compact.ts";

const P = { cwd: "/repo", home: "/home/u" };

// --- paths -----------------------------------------------------------------

test("shortenPath relativizes to cwd and homes the rest", () => {
	assert.equal(shortenPath("/repo/src/a.ts", "/repo", "/home/u"), "src/a.ts");
	assert.equal(shortenPath("/repo", "/repo", "/home/u"), ".");
	assert.equal(shortenPath("/home/u/x.ts", "/repo", "/home/u"), "~/x.ts");
	assert.equal(shortenPath("src/a.ts", "/repo", "/home/u"), "src/a.ts");
	assert.equal(shortenPath("/opt/elsewhere/x", "/repo", "/home/u"), "/opt/elsewhere/x");
	assert.equal(shortenPath("", "/repo", "/home/u"), "");
});

// --- duration ----------------------------------------------------------------

test("formatDuration renders one-decimal seconds below a minute, then m s", () => {
	assert.equal(formatDuration(400), "0.4s");
	assert.equal(formatDuration(1200), "1.2s");
	assert.equal(formatDuration(59_900), "59.9s");
	assert.equal(formatDuration(65_000), "1m 5s");
	assert.equal(formatDuration(3_723_000), "1h 2m 3s");
});

// --- summarizeCall: the running one-liner -------------------------------------

test("summarizeCall renders the running one-liner for each built-in tool", () => {
	assert.equal(formatToolSummary(summarizeCall("read", { path: "/repo/README.md" }, P)), "◐ read README.md");
	assert.equal(formatToolSummary(summarizeCall("bash", { command: "npm test" }, P)), "◐ bash npm test");
	assert.equal(formatToolSummary(summarizeCall("bash", { command: "npm run build\nsecond line" }, P)), "◐ bash npm run build");
	assert.equal(formatToolSummary(summarizeCall("edit", { path: "/repo/src/a.ts" }, P)), "◐ edit src/a.ts");
	assert.equal(formatToolSummary(summarizeCall("write", { path: "/home/u/x.ts" }, P)), "◐ write ~/x.ts");
	assert.equal(formatToolSummary(summarizeCall("grep", { pattern: "TODO", path: "src" }, P)), "◐ grep TODO");
	assert.equal(formatToolSummary(summarizeCall("find", { pattern: "**/*.ts" }, P)), "◐ find **/*.ts");
	assert.equal(formatToolSummary(summarizeCall("ls", { path: "/repo/src" }, P)), "◐ ls src");
});

test("summarizeCall renders violeta's own tools from their first meaningful args", () => {
	assert.equal(formatToolSummary(summarizeCall("todo", { action: "add", title: "Write the parser" }, P)), "◐ todo add Write the parser");
	assert.equal(formatToolSummary(summarizeCall("bash_background", { command: "npm run dev\nnoise" }, P)), "◐ bash_background npm run dev");
	assert.equal(formatToolSummary(summarizeCall("monitor", { command: "tail -f app.log" }, P)), "◐ monitor tail -f app.log");
	assert.equal(formatToolSummary(summarizeCall("job_list", {}, P)), "◐ job_list");
	assert.equal(formatToolSummary(summarizeCall("job_stop", { job_id: "job-1" }, P)), "◐ job_stop job-1");
	assert.equal(formatToolSummary(summarizeCall("subagent_run", { agent: "coder", task: "long task text", label: "Fix the login bug" }, P)), "◐ subagent_run coder Fix the login bug");
	assert.equal(formatToolSummary(summarizeCall("subagent_status", {}, P)), "◐ subagent_status");
	assert.equal(formatToolSummary(summarizeCall("subagent_cancel", { id: "task-9" }, P)), "◐ subagent_cancel task-9");
});

// --- summarizeResult: the final one-liner --------------------------------------

test("read success collapses to glyph, name and path", () => {
	const line = summarizeResult("read", { path: "/repo/README.md" }, { text: "contenido\ncompleto" }, P);
	assert.equal(formatToolSummary(line), "✓ read README.md");
});

test("bash success shows exit code and duration like the spec example", () => {
	const line = summarizeResult("bash", { command: "npm test" }, { text: "all good" }, { ...P, durationMs: 1200 });
	assert.equal(formatToolSummary(line), "✓ bash npm test · 0 · 1.2s");
});

test("bash failure shows the exit code parsed from the result tail", () => {
	const line = summarizeResult(
		"bash",
		{ command: "ls /nonexistent-dir-xyz" },
		{ isError: true, text: "ls: cannot access '/nonexistent-dir-xyz': No such file or directory\nCommand exited with code 2" },
		P,
	);
	assert.equal(formatToolSummary(line), "✗ bash ls /nonexistent-dir-xyz · exit 2 · ls: cannot access '/nonexistent-dir-xyz': No such file or directory");
});

test("bash failure with no parsable exit code still shows its first error line", () => {
	const line = summarizeResult("bash", { command: "boom" }, { isError: true, text: "segfault" }, P);
	assert.equal(formatToolSummary(line), "✗ bash boom · segfault");
});

test("edit success shows diff counts like the spec example", () => {
	const diff = ["--- a/src/a.ts", "+++ b/src/a.ts", "-old one", "+new one", "+new two", "+new three"].join("\n");
	const line = summarizeResult("edit", { path: "/repo/src/a.ts" }, { text: "Edited", details: { diff } }, P);
	assert.equal(formatToolSummary(line), "✓ edit src/a.ts +3 −1");
});

test("edit success omits zero diff counts", () => {
	const diff = ["--- a/src/a.ts", "+++ b/src/a.ts", "-old one", "-old two", "+new one"].join("\n");
	const line = summarizeResult("edit", { path: "/repo/src/a.ts" }, { text: "Edited", details: { diff } }, P);
	assert.equal(formatToolSummary(line), "✓ edit src/a.ts +1 −2");
	const clean = summarizeResult("edit", { path: "/repo/src/a.ts" }, { text: "Edited", details: { diff: " context only" } }, P);
	assert.equal(formatToolSummary(clean), "✓ edit src/a.ts");
});

test("write success collapses to glyph, name and path", () => {
	const line = summarizeResult("write", { path: "/repo/src/b.ts" }, { text: "Wrote 5 lines" }, P);
	assert.equal(formatToolSummary(line), "✓ write src/b.ts");
});

test("grep, find and ls collapse to pattern or path", () => {
	assert.equal(formatToolSummary(summarizeResult("grep", { pattern: "todo" }, { text: "src/a.ts:1" }, P)), "✓ grep todo");
	assert.equal(formatToolSummary(summarizeResult("find", { pattern: "*.ts" }, { text: "src/a.ts" }, P)), "✓ find *.ts");
	assert.equal(formatToolSummary(summarizeResult("ls", { path: "/repo/src" }, { text: "a.ts" }, P)), "✓ ls src");
});

test("non-shell errors always show their first error line", () => {
	const line = summarizeResult("grep", { pattern: "x" }, { isError: true, text: "Error: invalid regex" }, P);
	assert.equal(formatToolSummary(line), "✗ grep x · Error: invalid regex");
	const todo = summarizeResult("todo", { action: "update", id: 5 }, { isError: true, text: "Error: no existe la tarea #5" }, P);
	assert.equal(formatToolSummary(todo), "✗ todo update 5 · Error: no existe la tarea #5");
});

test("blank error output falls back to exit code only", () => {
	const line = summarizeResult("bash", { command: "false" }, { isError: true, text: "Command exited with code 1" }, P);
	assert.equal(formatToolSummary(line), "✗ bash false · exit 1");
});

test("extension-supplied extras are appended in order", () => {
	const line = summarizeResult("subagent_run", { agent: "coder" }, { text: "done", details: {} }, { ...P, extra: [{ text: "completado" }] });
	assert.equal(formatToolSummary(line), "✓ subagent_run coder · completado");
});

// --- diffStats -----------------------------------------------------------------

test("diffStats counts added and removed lines, ignoring headers", () => {
	const diff = ["--- a", "+++ b", "-x", "+y", "+z", " ctx", "+w"].join("\n");
	assert.deepEqual(diffStats(diff), { additions: 3, removals: 1 });
	assert.deepEqual(diffStats(""), { additions: 0, removals: 0 });
});

// --- width truncation (ANSI-safe) ------------------------------------------------

test("truncateLine caps plain text at the given width with an ellipsis", () => {
	const out = truncateLine("✓ bash " + "a".repeat(60), 20);
	const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
	assert.ok(plain.endsWith("…"));
	assert.equal([...plain].length, 20);
});

test("truncateLine leaves fitting lines untouched", () => {
	assert.equal(truncateLine("✓ read README.md", 80), "✓ read README.md");
});

test("truncateLine is ANSI-safe: codes survive and visible width fits", () => {
	const styled = "\x1b[32m✓\x1b[0m \x1b[36mbash\x1b[0m " + "x".repeat(100);
	const out = truncateLine(styled, 24);
	assert.ok(out.includes("\x1b[32m"), "the glyph color code must survive");
	assert.ok(out.endsWith("\x1b[0m…") || out.includes("\x1b[0m"), "reset codes must stay balanced");
	const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
	assert.ok([...plain].length <= 24);
});

// --- styledSummary: colors only through theme roles --------------------------------

test("styledSummary uses success/accent/dim and the diff roles", () => {
	const marked = (role: string, text: string) => `<${role}>${text}</${role}>`;
	const ok = styledSummary(summarizeResult("bash", { command: "npm test" }, { text: "ok" }, { ...P, durationMs: 1200 }), marked);
	assert.equal(ok, "<success>✓</success> <accent>bash</accent> npm test · <dim>0</dim> · <dim>1.2s</dim>");

	const diff = "-a\n+b";
	const edited = styledSummary(summarizeResult("edit", { path: "src/a.ts" }, { text: "Edited", details: { diff } }, P), marked);
	assert.equal(edited, "<success>✓</success> <accent>edit</accent> src/a.ts <toolDiffAdded>+1</toolDiffAdded> <toolDiffRemoved>−1</toolDiffRemoved>");

	const bad = styledSummary(summarizeResult("bash", { command: "boom" }, { isError: true, text: "kaboom\nmore" }, P), marked);
	assert.equal(bad, "<error>✗</error> <accent>bash</accent> boom · <error>kaboom</error>");

	const running = styledSummary(summarizeCall("read", { path: "README.md" }, P), marked);
	assert.equal(running, "<accent>◐</accent> <accent>read</accent> README.md");
});

// --- compact renderer wrapper: model results must be byte-identical -----------------

test("withCompactRenderer keeps the original execute (same function reference) and parameters", () => {
	const execute = async () => ({ content: [{ type: "text", text: "OUT" }] });
	const original = {
		name: "read",
		label: "Read",
		description: "read a file",
		parameters: { type: "object" },
		execute,
	};
	const compact = withCompactRenderer("read", original);
	assert.equal(compact.execute, execute, "execute must be the original function");
	assert.equal(compact.parameters, original.parameters);
	assert.equal(compact.description, "read a file");
	assert.equal(compact.label, "Read");
});

function makeCtx(args: Record<string, unknown>, cwd = "/repo") {
	return { args, state: {} as Record<string, unknown>, cwd };
}

const identityTheme = { fg: (role: string, text: string) => text, bold: (text: string) => text };

test("renderCall draws the running one-liner, truncated to width", () => {
	const compact = withCompactRenderer("read", { execute: async () => ({}) });
	const ctx = makeCtx({ path: "/repo/README.md" });
	const component = compact.renderCall!(ctx.args, identityTheme, ctx);
	assert.deepEqual(component.render(80), ["◐ read README.md"]);
	const narrow = compact.renderCall!(ctx.args, identityTheme, ctx);
	const plainNarrow = ((narrow.render(10) as string[])[0] as string).replace(/\x1b\[[0-9;]*m/g, "");
	assert.equal([...plainNarrow].length, 10);
});

test("renderResult collapsed draws the final one-liner only", () => {
	const compact = withCompactRenderer("bash", { execute: async () => ({}) });
	const ctx = makeCtx({ command: "echo hola" });
	const component = compact.renderResult!(
		{ content: [{ type: "text", text: "hola" }] },
		{ expanded: false, isPartial: false },
		identityTheme,
		ctx,
	);
	assert.deepEqual(component.render(80), ["✓ bash echo hola · 0"]);
});

test("renderResult on error draws glyph, exit code and first error line", () => {
	const compact = withCompactRenderer("bash", { execute: async () => ({}) });
	// The TUI passes the error flag on the CONTEXT, not on the result object.
	const ctx: Record<string, unknown> = makeCtx({ command: "ls /nonexistent-dir-xyz" });
	ctx.isError = true;
	const component = compact.renderResult!(
		{ content: [{ type: "text", text: "ls: cannot access '/nonexistent-dir-xyz': No such file or directory\nCommand exited with code 2" }] },
		{ expanded: false, isPartial: false },
		identityTheme,
		ctx as never,
	);
	assert.deepEqual(
		component.render(200),
		["✗ bash ls /nonexistent-dir-xyz · exit 2 · ls: cannot access '/nonexistent-dir-xyz': No such file or directory"],
	);
});

test("renderResult falls back to result.isError when the context omits it", () => {
	const compact = withCompactRenderer("grep", { execute: async () => ({}) });
	const ctx = makeCtx({ pattern: "x" });
	const component = compact.renderResult!(
		{ content: [{ type: "text", text: "Error: invalid regex" }], isError: true },
		{ expanded: false, isPartial: false },
		identityTheme,
		ctx,
	);
	assert.deepEqual(component.render(120), ["✗ grep x · Error: invalid regex"]);
});

test("renderResult prefers the context duration over the fallback clock", () => {
	const compact = withCompactRenderer("bash", { execute: async () => ({}) });
	const ctx: Record<string, unknown> = makeCtx({ command: "npm test" });
	ctx.durationMs = 1200;
	const component = compact.renderResult!(
		{ content: [{ type: "text", text: "ok" }] },
		{ expanded: false, isPartial: false },
		identityTheme,
		ctx as never,
	);
	assert.equal((component.render(80) as string[])[0], "✓ bash npm test · 0 · 1.2s");
});

test("renderResult partial keeps the running glyph", () => {
	const compact = withCompactRenderer("bash", { execute: async () => ({}) });
	const ctx = makeCtx({ command: "sleep 2" });
	const component = compact.renderResult!({ content: [{ type: "text", text: "" }] }, { expanded: false, isPartial: true }, identityTheme, ctx);
	assert.deepEqual(component.render(80), ["◐ bash sleep 2"]);
});

test("renderResult expanded reveals the full output after the one-liner", () => {
	const compact = withCompactRenderer("read", { execute: async () => ({}) });
	const ctx = makeCtx({ path: "/repo/README.md" });
	const component = compact.renderResult!(
		{ content: [{ type: "text", text: "line one\nMARCADOR-UNICO\nline three" }] },
		{ expanded: true, isPartial: false },
		identityTheme,
		ctx,
	);
	const text = (component.render(120) as string[]).join("\n");
	assert.ok(text.startsWith("✓ read README.md"));
	assert.ok(text.includes("MARCADOR-UNICO"), "expanded must show the full content");
});

test("renderResult records the duration once between call and result", async () => {
	const compact = withCompactRenderer("bash", { execute: async () => ({}) });
	const ctx = makeCtx({ command: "npm test" });
	compact.renderCall!(ctx.args, identityTheme, ctx);
	assert.ok((ctx.state as { vsStartedAt?: number }).vsStartedAt, "renderCall starts the clock");
	const component = compact.renderResult!({ content: [{ type: "text", text: "ok" }] }, { expanded: false, isPartial: false }, identityTheme, ctx);
	const first = (component.render(80) as string[])[0];
	assert.match(first, /✓ bash npm test · 0 · \d+(\.\d+)?s/);
	// Re-render (e.g. after toggling expansion) must not grow the duration.
	await new Promise((r) => setTimeout(r, 30));
	const again = compact.renderResult!({ content: [{ type: "text", text: "ok" }] }, { expanded: false, isPartial: false }, identityTheme, ctx);
	assert.equal((again.render(80) as string[])[0], first);
});
