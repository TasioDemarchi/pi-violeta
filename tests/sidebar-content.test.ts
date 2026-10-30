import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSidebarLines, contextBar, SIDEBAR_MAX_FILES, type SidebarData } from "../src/sidebar-content.ts";

// Identity theme: keeps exact text visible in assertions.
const plain = (_role: string, text: string) => text;

const fullData: SidebarData = {
	project: { name: "violeta", path: "/home/t/Documents/violeta", branch: "main" },
	changes: { created: ["new.txt"], updated: ["src/a.ts", "b.ts"], deleted: ["old.ts"] },
	model: { id: "nan/deepseek-v4-flash", thinking: "off", context: { percent: 43, used: 43210, window: 1_000_000 } },
	usage: { tokensIn: 1500, tokensOut: 2_400_000, cost: 0.05 },
};

const W = 60;
const CW = W - 2; // divider + one space
const row = (content: string) => "│ " + content + " ".repeat(CW - content.length);

test("renders every section with counts, file names, model and usage", () => {
	const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, plain);
	assert.deepEqual(
		lines.slice(0, 20),
		[
			row("PROYECTO"),
			row("violeta"),
			row("/home/t/Documents/violeta"),
			row("main"),
			row(""),
			row("CAMBIOS"),
			row("+1 creado"),
			row("~2 modificados"),
			row("−1 eliminado"),
			row("+ new.txt"),
			row("~ src/a.ts"),
			row("~ b.ts"),
			row("− old.ts"),
			row(""),
			row("MODELO"),
			row("nan/deepseek-v4-flash"),
			row("thinking off"),
			row("ctx 43% ████░░░░░░ 43.2k/1.0M"),
			row(""),
			row("USO"),
		],
	);
	assert.equal(lines[20], row("↑1.5k ↓2.4M"));
	assert.equal(lines[21], row("$0.05"));
});

test("pads output to the terminal height so the divider spans full height", () => {
	const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, plain);
	assert.equal(lines.length, 40);
	for (const line of lines) assert.equal(line[0], "│");
	assert.equal(lines[39], row(""));
});

test("caps the file list at 12 entries with an N-more line", () => {
	const created = Array.from({ length: 15 }, (_, i) => `f${i + 1}.txt`);
	const lines = buildSidebarLines(
		{ ...fullData, changes: { created, updated: [], deleted: [] } },
		{ width: W, rows: 40 },
		plain,
	);
	const fileLines = lines.filter((l) => /\+ f\d+\.txt/.test(l));
	assert.equal(fileLines.length, SIDEBAR_MAX_FILES);
	assert.equal(fileLines[0], row("+ f1.txt"));
	assert.equal(fileLines[SIDEBAR_MAX_FILES - 1], row("+ f12.txt"));
	assert.ok(lines.includes(row("+3 más")));
});

test("a clean tree shows limpio and no file lines", () => {
	const lines = buildSidebarLines(
		{ ...fullData, changes: { created: [], updated: [], deleted: [] } },
		{ width: W, rows: 40 },
		plain,
	);
	assert.ok(lines.includes(row("limpio")));
	assert.ok(!lines.some((l) => l.includes("creado ")));
});

test("no repository shows the sin-repo hint and no branch line", () => {
	const lines = buildSidebarLines(
		{ ...fullData, project: { name: "violeta", path: "/home/t/Documents/violeta", branch: null }, changes: null },
		{ width: W, rows: 40 },
		plain,
	);
	assert.ok(lines.includes(row("sin repo")));
	assert.ok(!lines.includes(row("main")));
});

test("without a model the id line says so and context is omitted", () => {
	const lines = buildSidebarLines(
		{ ...fullData, model: { id: undefined, thinking: undefined, context: null } },
		{ width: W, rows: 40 },
		plain,
	);
	assert.ok(lines.includes(row("sin modelo")));
	assert.ok(!lines.some((l) => l.includes("ctx ")));
});

test("narrow widths truncate lines instead of overflowing", () => {
	const lines = buildSidebarLines(fullData, { width: 20, rows: 40 }, plain);
	for (const line of lines) assert.ok(visibleWidth(line) <= 20, `too wide: ${JSON.stringify(line)}`);
	const pathLine = lines.find((l) => l.includes("/home"));
	assert.ok(pathLine!.startsWith("│ /home/t/Documen"));
	assert.equal(visibleWidth(pathLine!), 20); // divider + space + 15 chars + "..."
});

test("sections are labeled with the accent role and statuses with their palette roles", () => {
	const seen: string[] = [];
	const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, (role, text) => {
		seen.push(role);
		return `<${role}>${text}`;
	});
	assert.ok(lines[0].startsWith("<borderAccent>│ <accent>PROYECTO"));
	assert.ok(lines.some((l) => l.includes("<success>+1 creado")));
	assert.ok(lines.some((l) => l.includes("<warning>~2 modificados")));
	assert.ok(lines.some((l) => l.includes("<error>−1 eliminado")));
	assert.ok(seen.includes("text") && seen.includes("muted") && seen.includes("dim"));
});

test("contextBar fills proportionally and shows an empty bar for unknown usage", () => {
	assert.equal(contextBar(0), "░░░░░░░░░░");
	assert.equal(contextBar(43), "████░░░░░░");
	assert.equal(contextBar(96), "██████████");
	assert.equal(contextBar(null), "░░░░░░░░░░");
});
