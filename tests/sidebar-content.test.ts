import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { buildSidebarLines, contextBar, SIDEBAR_MAX_FILES, type SidebarData } from "../src/sidebar-content.ts";
import { TODO_HIDE_MS } from "../src/todo/card.ts";
import { applyTodo, emptyTodo, type TodoState } from "../src/todo/store.ts";

// Identity theme: keeps exact text visible in assertions.
const plain = (_role: string, text: string) => text;

const fullData: SidebarData = {
	changes: { created: ["new.txt"], updated: ["src/a.ts", "b.ts"], deleted: ["old.ts"] },
	model: { id: "nan/deepseek-v4-flash", thinking: "off", context: { percent: 43, used: 43210, window: 1_000_000 } },
	usage: { tokensIn: 1500, tokensOut: 2_400_000, cost: 0.05 },
};

const W = 60;
const CW = W - 2; // divider + one space
const row = (content: string) => "│ " + content + " ".repeat(CW - content.length);

const NOW = 1_000_000;

/** A todo list with the given pending titles. */
function todoState(...titles: string[]): TodoState {
	let state = emptyTodo();
	for (const title of titles) state = applyTodo(state, { action: "add", title }, NOW).state;
	return state;
}

test("renders every section with counts, file names, model and usage", () => {
	const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, plain);
	assert.deepEqual(
		lines.slice(0, 11),
		[
			row("CHANGES"),
			row("+ new.txt"),
			row("~ src/a.ts"),
			row("~ b.ts"),
			row("− old.ts"),
			row(""),
			row("MODEL"),
			row("nan/deepseek-v4-flash · off"),
			row("ctx 43% ████░░░░░░ 43.2k/1.0M"),
			row(""),
			row("USAGE"),
		],
	);
	assert.equal(lines[11], row("↑1.5k ↓2.4M"));
	assert.equal(lines[12], row("$0.05"));
});

// S5: the project name, path and branch live in the header; the sidebar opens
// straight into CHANGES.
test("the sidebar has no PROJECT section: no title, name, path, branch or leading blank", () => {
	const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, plain);
	const text = lines.join("\n");
	assert.equal(lines[0], row("CHANGES"), "CHANGES is the first section");
	assert.ok(!text.includes("PROJECT"), "no project title");
	assert.ok(!text.includes("/home/t/Documents/violeta"), "no project path");
	assert.ok(!lines.includes(row("violeta")), "no project name row");
	assert.ok(!lines.includes(row("main")), "no branch row");
});

test("pads output to the terminal height so the divider spans full height", () => {
	const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, plain);
	assert.equal(lines.length, 40);
	for (const line of lines) assert.equal(line[0], "│");
	assert.equal(lines[39], row(""));
});

test("caps the file rows at 8: 7 names plus a dim … row when there are more", () => {
	const created = Array.from({ length: 15 }, (_, i) => `f${i + 1}.txt`);
	const lines = buildSidebarLines(
		{ ...fullData, changes: { created, updated: [], deleted: [] } },
		{ width: W, rows: 40 },
		plain,
	);
	const fileLines = lines.filter((l) => /\+ f\d+\.txt/.test(l));
	assert.equal(SIDEBAR_MAX_FILES, 8);
	assert.equal(fileLines.length, 7);
	assert.equal(fileLines[0], row("+ f1.txt"));
	assert.equal(fileLines[6], row("+ f7.txt"));
	assert.ok(!fileLines.some((l) => l.includes("f8.txt")));
	assert.ok(lines.includes(row("…")), "the 8th row must be the dim ellipsis");
	assert.ok(!lines.includes(row("+7 más")), "the old +N más row must be gone");
	// The counters line still shows the true totals.
	assert.ok(!lines.some((l) => l.includes("15 created")), "no per-group count line");
});

test("a full list with mixed change types shows the three per-group counts instead of names", () => {
	const created = Array.from({ length: 6 }, (_, i) => `c${i + 1}.txt`);
	const updated = Array.from({ length: 3 }, (_, i) => `u${i + 1}.txt`);
	const deleted = ["d1.txt"];
	const lines = buildSidebarLines({ ...fullData, changes: { created, updated, deleted } }, { width: W, rows: 40 }, plain);
	const cambios = lines.findIndex((l) => l.includes("CHANGES"));
	const section = lines.slice(cambios + 1, cambios + 4);
	assert.deepEqual(section, [row("+6 created"), row("~3 updated"), row("−1 deleted")]);
	assert.ok(!lines.some((l) => /^\│ [cud]\d\.txt/.test(l)), "no file names when the list is full and mixed");
	assert.ok(!lines.includes(row("…")), "no ellipsis row in the counted form");
});

test("a full list of a single type keeps the names and the ellipsis, without counts", () => {
	const created = Array.from({ length: 12 }, (_, i) => `h${i + 1}.txt`);
	const lines = buildSidebarLines({ ...fullData, changes: { created, updated: [], deleted: [] } }, { width: W, rows: 40 }, plain);
	assert.ok(lines.includes(row("+ h1.txt")));
	assert.ok(lines.includes(row("…")));
	assert.ok(!lines.some((l) => l.includes("created")));
});

test("exactly 8 files shows all 8 names with no ellipsis row", () => {
	const created = Array.from({ length: 8 }, (_, i) => `g${i + 1}.txt`);
	const lines = buildSidebarLines(
		{ ...fullData, changes: { created, updated: [], deleted: [] } },
		{ width: W, rows: 40 },
		plain,
	);
	const fileLines = lines.filter((l) => /\+ g\d+\.txt/.test(l));
	assert.equal(fileLines.length, 8);
	assert.equal(fileLines[7], row("+ g8.txt"));
	assert.ok(!lines.includes(row("…")));
});

test("renders the TASKS section between CHANGES and MODEL with one row per task", () => {
	const lines = buildSidebarLines({ ...fullData, todos: todoState("alpha", "beta"), now: NOW }, { width: W, rows: 40 }, plain);
	const cambios = lines.findIndex((l) => l.includes("CHANGES"));
	const tareas = lines.findIndex((l) => l.includes("TASKS"));
	const modelo = lines.findIndex((l) => l.includes("MODEL"));
	assert.ok(cambios >= 0 && tareas > cambios && tareas < modelo, `TASKS at ${tareas} between ${cambios} and ${modelo}`);
	assert.ok(lines.includes(row("○  alpha")));
	assert.ok(lines.includes(row("○  beta")));
});

test("the TASKS section shows 5 task rows then a bare `…` row", () => {
	const titles = Array.from({ length: 10 }, (_, i) => `task ${i + 1}`);
	const lines = buildSidebarLines({ ...fullData, todos: todoState(...titles), now: NOW }, { width: W, rows: 40 }, plain);
	const tareas = lines.findIndex((l) => l.includes("TASKS"));
	const modelo = lines.findIndex((l) => l.includes("MODEL"));
	const section = lines.slice(tareas + 1, modelo - 1); // exclude the blank line before MODEL
	assert.equal(section.length, 6); // 5 task rows + the ellipsis row
	assert.equal(section[4], row("○  task 5"));
	assert.ok(!section.some((l) => l.includes("task 6")));
	assert.equal(section[5], row("…"));
});

test("the TASKS section is hidden for an empty list or a list settled past one minute", () => {
	const withoutTodos = buildSidebarLines(fullData, { width: W, rows: 40, now: NOW }, plain);
	assert.ok(!withoutTodos.some((l) => l.includes("TASKS")));
	const empty = buildSidebarLines({ ...fullData, todos: emptyTodo() }, { width: W, rows: 40, now: NOW }, plain);
	assert.ok(!empty.some((l) => l.includes("TASKS")));

	let settled = todoState("alpha", "beta");
	settled = applyTodo(settled, { action: "update", id: 1, status: "done" }, NOW).state;
	settled = applyTodo(settled, { action: "update", id: 2, status: "done" }, NOW + 1).state;
	const settledAt = NOW + 1;
	const inside = buildSidebarLines({ ...fullData, todos: settled, now: settledAt + 1 }, { width: W, rows: 40 }, plain);
	assert.ok(inside.some((l) => l.includes("TASKS")));
	const outside = buildSidebarLines({ ...fullData, todos: settled, now: settledAt + TODO_HIDE_MS }, { width: W, rows: 40 }, plain);
	assert.ok(!outside.some((l) => l.includes("TASKS")));
});

test("TASKS rows fit the real sidebar content width (44 columns minus padding)", () => {
	const long = "una tarea con un título extremadamente largo que no entra en el ancho de la barra lateral";
	const lines = buildSidebarLines(
		{ ...fullData, todos: todoState(long, "corta"), now: NOW },
		{ width: 44, rows: 40 },
		plain,
	);
	for (const line of lines) assert.ok(visibleWidth(line) <= 44, `too wide: ${JSON.stringify(line)}`);
	const longRow = lines.find((l) => l.includes("título extremadamente"));
	assert.ok(longRow!.includes("…"), "the long title is clipped with an ellipsis");
	assert.ok(lines.some((l) => l.includes("corta")));
});

test("a clean tree shows limpio and no file lines", () => {
	const lines = buildSidebarLines(
		{ ...fullData, changes: { created: [], updated: [], deleted: [] } },
		{ width: W, rows: 40 },
		plain,
	);
	assert.ok(lines.includes(row("clean")));
	assert.ok(!lines.some((l) => l.includes(" created")));
});

test("no repository shows the sin-repo hint and no branch line", () => {
	const lines = buildSidebarLines({ ...fullData, changes: null }, { width: W, rows: 40 }, plain);
	assert.ok(lines.includes(row("no repo")));
	assert.ok(!lines.includes(row("main")));
});

test("without a model the id line says so and context is omitted", () => {
	const lines = buildSidebarLines(
		{ ...fullData, model: { id: undefined, thinking: undefined, context: null } },
		{ width: W, rows: 40 },
		plain,
	);
	assert.ok(lines.includes(row("no model")));
	assert.ok(!lines.some((l) => l.includes("ctx ")));
});

test("narrow widths truncate lines instead of overflowing", () => {
	const lines = buildSidebarLines(fullData, { width: 20, rows: 40 }, plain);
	for (const line of lines) assert.ok(visibleWidth(line) <= 20, `too wide: ${JSON.stringify(line)}`);
	assert.ok(!lines.some((l) => l.includes("/home")), "the project path is not in the sidebar");
	const modelLine = lines.find((l) => l.includes("nan/deepseek"));
	assert.ok(modelLine!.startsWith("│ nan/deepseek"));
	assert.equal(visibleWidth(modelLine!), 20); // divider + space + 17 chars + "…"
});

test("sections are labeled with the accent role and statuses with their palette roles", () => {
	const seen: string[] = [];
	const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, (role, text) => {
		seen.push(role);
		return `<${role}>${text}`;
	});
	assert.ok(lines[0].startsWith("<borderAccent>│ <accent>CHANGES"));
	assert.ok(lines.some((l) => l.includes("<success>+ new.txt")));
	assert.ok(lines.some((l) => l.includes("<warning>~ src/a.ts")));
	assert.ok(lines.some((l) => l.includes("<error>− old.ts")));
	assert.ok(seen.includes("muted") && seen.includes("dim"));
});

test("contextBar fills proportionally and shows an empty bar for unknown usage", () => {
	assert.equal(contextBar(0), "░░░░░░░░░░");
	assert.equal(contextBar(43), "████░░░░░░");
	assert.equal(contextBar(96), "██████████");
	assert.equal(contextBar(null), "░░░░░░░░░░");
});

// --- Context threshold colors (S5) ----------------------------------------------

const dataAt = (percent: number | null): SidebarData => ({
	...fullData,
	model: { id: "nan/deepseek-v4-flash", thinking: "off", context: { percent, used: 43210, window: 1_000_000 } },
});

const ctxLineIn = (lines: string[]): string => lines.find((l) => l.includes("ctx "))!;

const rolesAt = (percent: number | null): string[] => {
	const seen: string[] = [];
	buildSidebarLines(dataAt(percent), { width: W, rows: 40 }, (role, text) => {
		if (text.startsWith("ctx ")) seen.push(role);
		return text;
	});
	return seen;
};

test("the sidebar ctx line stays muted below 70% and turns warning at 70", () => {
	assert.deepEqual(rolesAt(69), ["muted"]);
	assert.deepEqual(rolesAt(70), ["warning"]);
	assert.deepEqual(rolesAt(89), ["warning"]);
});

test("the sidebar ctx line turns error at 90%+", () => {
	assert.deepEqual(rolesAt(90), ["error"]);
	assert.deepEqual(rolesAt(96), ["error"]);
});

test("unknown usage keeps the muted ctx line", () => {
	assert.deepEqual(rolesAt(null), ["muted"]);
	// sanity: the plain-rendered line still carries the bar and numbers
	const line = ctxLineIn(buildSidebarLines(dataAt(43), { width: W, rows: 40 }, plain));
	assert.ok(line.includes("ctx 43% ████░░░░░░ 43.2k/1.0M"), line);
});

// --- English mode (S3): the original English sidebar, rendered live ------------

test("in English the sidebar shows CHANGES/MODEL/USAGE without count lines", () => {
	try {
		const lines = buildSidebarLines(fullData, { width: W, rows: 40 }, plain);
		assert.deepEqual(
			lines.slice(0, 11),
			[
				row("CHANGES"),
				row("+ new.txt"),
				row("~ src/a.ts"),
				row("~ b.ts"),
				row("− old.ts"),
				row(""),
				row("MODEL"),
				row("nan/deepseek-v4-flash · off"),
				row("ctx 43% ████░░░░░░ 43.2k/1.0M"),
				row(""),
				row("USAGE"),
			],
		);
		// The TASKS section header in English, with the todo list present.
		const withTodos = buildSidebarLines({ ...fullData, todos: todoState("alpha"), now: NOW }, { width: W, rows: 40 }, plain);
		assert.ok(withTodos.some((l) => l.includes("TASKS")), "the TASKS section renders in English as TASKS");
		assert.ok(withTodos.includes(row("○  alpha")));
	} finally {
	}
});

test("in English a clean tree says `clean` and a missing repo says `no repo`", () => {
	try {
		const clean = buildSidebarLines(
			{ ...fullData, changes: { created: [], updated: [], deleted: [] } },
			{ width: W, rows: 40 },
			plain,
		);
		assert.ok(clean.includes(row("clean")));
		const noRepo = buildSidebarLines({ ...fullData, changes: null }, { width: W, rows: 40 }, plain);
		assert.ok(noRepo.includes(row("no repo")));
	} finally {
	}
});
