import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { cardVisible, renderTodoCard, todoPlacement, todoSectionRows, TODO_HIDE_MS, type CardFg } from "../src/todo/card.ts";
import { setLanguage } from "../src/i18n.ts";
import { applyTodo, emptyTodo, type TodoState } from "../src/todo/store.ts";

// Identity theme: roles must not change the visible text in layout tests.
const plain: CardFg = (_role, text) => text;
// Tagging theme: real ANSI escapes with the role name, so roles are visible
// in expectations while visibleWidth still measures the plain text.
const tagged: CardFg = (role, text) => `\x1B[${role}m${text}\x1B[0m`;
const t = tagged;

const NOW = 1_000_000;

function taskList(): TodoState {
	let state = emptyTodo();
	state = applyTodo(state, { action: "add", title: "Write the parser" }, NOW).state;
	state = applyTodo(state, { action: "add", title: "Run tests", status: "in_progress", note: "npm test" }, NOW).state;
	state = applyTodo(state, { action: "add", title: "Deploy", status: "blocked", note: "waiting for CI" }, NOW).state;
	return state;
}

const WIDTH = 48;

test("renderTodoCard returns no lines for an empty list", () => {
	assert.deepEqual(renderTodoCard(emptyTodo(), { width: WIDTH, now: NOW }, plain), []);
});

test("renderTodoCard draws the frame, title counts and one row per task", () => {
	const lines = renderTodoCard(taskList(), { width: WIDTH, now: NOW }, plain);
	// Only blocked rows show their note; pads are exact (inner = width - 4).
	assert.deepEqual(lines, [
		"╭─ Tareas · 3 abiertas · 0 hechas " + "─".repeat(13) + "╮",
		"│ ○  Write the parser" + " ".repeat(26) + "│",
		"│ ◐  Run tests" + " ".repeat(33) + "│",
		"│ ⏸  Deploy  · waiting for CI" + " ".repeat(18) + "│",
		"╰" + "─".repeat(46) + "╯",
	]);
	for (const line of lines) assert.ok(visibleWidth(line) <= WIDTH, `line exceeds width: ${line}`);
});

test("card rows paint the theme roles: glyphs, dimmed finished rows, dimmed note", () => {
	let state = taskList();
	state = applyTodo(state, { action: "add", title: "Old idea", status: "dropped" }, NOW).state;
	state = applyTodo(state, { action: "update", id: 1, status: "done" }, NOW).state;
	const lines = renderTodoCard(state, { width: WIDTH, now: NOW }, tagged);
	// Rows stay in list order: #1 done, #2 in_progress, #3 blocked, #4 dropped.
	// Exact rendered strings (pi-tui measures ✓ and ⊘ as width 2, so pads differ
	// from the plain-theme rows).
	assert.deepEqual(lines, [
		t("borderAccent", "╭─ ") + t("accent", "Tareas · 2 abiertas · 1 hecha") + " " + t("borderAccent", "─".repeat(14) + "╮"),
		t("borderAccent", "│ ") + t("success", "✓") + "  " + t("dim", "Write the parser") + " ".repeat(24) + t("borderAccent", " │"),
		t("borderAccent", "│ ") + t("accent", "◐") + "  " + t("text", "Run tests") + " ".repeat(32) + t("borderAccent", " │"),
		t("borderAccent", "│ ") + t("warning", "⏸") + "  " + t("text", "Deploy") + t("dim", "  · waiting for CI") + " ".repeat(16) + t("borderAccent", " │"),
		t("borderAccent", "│ ") + t("muted", "⊘") + "  " + t("dim", "Old idea") + " ".repeat(27) + t("borderAccent", " │"),
		t("borderAccent", "╰" + "─".repeat(46) + "╯"),
	]);
	// Title counts: open = pending + in_progress + blocked; done = done only.
	assert.match(lines[0]!, /Tareas · 2 abiertas · 1 hecha/);
});

test("more than 8 rows fold into `… N más`", () => {
	let state = emptyTodo();
	for (let i = 1; i <= 10; i++) state = applyTodo(state, { action: "add", title: `task ${i}` }, NOW).state;
	const lines = renderTodoCard(state, { width: WIDTH, now: NOW }, plain);
	// Title + 8 rows + fold + bottom.
	assert.equal(lines.length, 11);
	assert.equal(lines[9], "│ " + "… 2 más" + " ".repeat(37) + " │");
	assert.match(lines[0]!, /Tareas · 10 abiertas · 0 hechas/);
	// A 9-task list folds one row.
	const nine = applyTodo(state, { action: "write", tasks: state.tasks.slice(0, 9).map((task) => ({ id: task.id, title: task.title })) }, NOW).state;
	assert.equal(renderTodoCard(nine, { width: WIDTH, now: NOW }, plain)[9], "│ " + "… 1 más" + " ".repeat(37) + " │");
	assert.match(renderTodoCard(nine, { width: WIDTH, now: NOW }, plain)[0]!, /Tareas · 9 abiertas · 0 hechas/);
});

test("long titles and notes are truncated to the available width, never overflowing", () => {
	const long = "a very long task title that certainly does not fit into the card width at all";
	let state = emptyTodo();
	state = applyTodo(state, { action: "add", title: long, status: "blocked", note: long }, NOW).state;
	const lines = renderTodoCard(state, { width: 30, now: NOW }, plain);
	assert.equal(lines.length, 3);
	for (const line of lines) assert.ok(visibleWidth(line) <= 30, `line exceeds width: ${JSON.stringify(line)}`);
	assert.match(lines[1]!, /…/);
});

test("cardVisible: empty lists are hidden, open work is visible", () => {
	assert.equal(cardVisible(emptyTodo(), NOW), false);
	assert.equal(cardVisible(taskList(), NOW), true);
});

test("cardVisible: everything done or dropped hides after the 1 minute window", () => {
	let state = taskList();
	const settled = NOW;
	state = applyTodo(state, { action: "update", id: 1, status: "done" }, settled).state;
	state = applyTodo(state, { action: "update", id: 2, status: "done" }, settled + 1).state;
	state = applyTodo(state, { action: "update", id: 3, status: "dropped" }, settled + 2).state;
	assert.equal(TODO_HIDE_MS, 60_000);
	const settledAt = settled + 2; // the moment the last task settled
	assert.equal(cardVisible(state, settledAt + 3), true);
	assert.equal(cardVisible(state, settledAt + TODO_HIDE_MS - 1), true);
	assert.equal(cardVisible(state, settledAt + TODO_HIDE_MS), false);
	// A finished list with no timestamp never hides.
	assert.equal(cardVisible({ tasks: state.tasks, nextId: state.nextId }, NOW), true);
});

test("renderTodoCard renders nothing once the hide window has passed", () => {
	let state = taskList();
	state = applyTodo(state, { action: "update", id: 1, status: "done" }, NOW).state;
	state = applyTodo(state, { action: "update", id: 2, status: "done" }, NOW).state;
	state = applyTodo(state, { action: "update", id: 3, status: "done" }, NOW).state;
	assert.equal(renderTodoCard(state, { width: WIDTH, now: NOW + TODO_HIDE_MS + 1 }, plain).length, 0);
	assert.ok(renderTodoCard(state, { width: WIDTH, now: NOW + 1 }, plain).length > 0);
});

// --- Sidebar section (T1/S2): the same rows the card draws, without the frame ---

const SIDEBAR_INNER = 44 - 2; // sidebar width minus the divider column and one space

test("todoSectionRows mirrors the card rows (glyphs, notes) at the given width", () => {
	assert.deepEqual(todoSectionRows(taskList(), { width: SIDEBAR_INNER, now: NOW }, plain), [
		"○  Write the parser",
		"◐  Run tests",
		"⏸  Deploy  · waiting for CI",
	]);
});

test("todoSectionRows shows 5 task rows and then a bare `…` row (compact sidebar)", () => {
	let state = emptyTodo();
	for (let i = 1; i <= 10; i++) state = applyTodo(state, { action: "add", title: `task ${i}` }, NOW).state;
	const rows = todoSectionRows(state, { width: SIDEBAR_INNER, now: NOW }, plain);
	assert.equal(rows.length, 6); // 5 task rows + the ellipsis row
	assert.equal(rows[4], "○  task 5");
	assert.ok(!rows.some((r) => r.includes("task 6")));
	assert.equal(rows[5], "…");
});

test("todoSectionRows shows exactly 5 rows with no ellipsis when there are 5", () => {
	let state = emptyTodo();
	for (let i = 1; i <= 5; i++) state = applyTodo(state, { action: "add", title: `task ${i}` }, NOW).state;
	const rows = todoSectionRows(state, { width: SIDEBAR_INNER, now: NOW }, plain);
	assert.equal(rows.length, 5);
	assert.equal(rows[4], "○  task 5");
	assert.ok(!rows.includes("…"));
});

test("todoSectionRows returns nothing for an empty list or one settled past the hide window", () => {
	assert.deepEqual(todoSectionRows(emptyTodo(), { width: SIDEBAR_INNER, now: NOW }, plain), []);
	let state = taskList();
	state = applyTodo(state, { action: "update", id: 1, status: "done" }, NOW).state;
	state = applyTodo(state, { action: "update", id: 2, status: "done" }, NOW).state;
	state = applyTodo(state, { action: "update", id: 3, status: "done" }, NOW).state;
	assert.deepEqual(todoSectionRows(state, { width: SIDEBAR_INNER, now: NOW + TODO_HIDE_MS }, plain), []);
	assert.ok(todoSectionRows(state, { width: SIDEBAR_INNER, now: NOW + 1 }, plain).length > 0);
});

test("todoSectionRows never exceeds the width it is given (sidebar-safe)", () => {
	const long = "una tarea con un título extremadamente largo que no entra en el ancho de la barra lateral";
	let state = emptyTodo();
	state = applyTodo(state, { action: "add", title: long, status: "blocked", note: long }, NOW).state;
	const rows = todoSectionRows(state, { width: SIDEBAR_INNER, now: NOW }, plain);
	for (const line of rows) assert.ok(visibleWidth(line) <= SIDEBAR_INNER, `too wide: ${JSON.stringify(line)}`);
	assert.match(rows[0]!, /…/);
});

test("todoPlacement: sidebar active renders the section, otherwise the above-editor widget", () => {
	assert.equal(todoPlacement(true), "sidebar");
	assert.equal(todoPlacement(false), "widget");
});

// --- English mode (S3): the original English card, rendered live --------------

test("in English the todo card reads `Todo · N open · M done` and folds into `… N more`", () => {
	try {
		setLanguage("en");
		const lines = renderTodoCard(taskList(), { width: WIDTH, now: NOW }, plain);
		assert.equal(lines[0], "╭─ Todo · 3 open · 0 done " + "─".repeat(21) + "╮");
		assert.match(lines[0]!, /Todo · 3 open · 0 done/);
		let ten = emptyTodo();
		for (let i = 1; i <= 10; i++) ten = applyTodo(ten, { action: "add", title: `task ${i}` }, NOW).state;
		const folded = renderTodoCard(ten, { width: WIDTH, now: NOW }, plain);
		assert.equal(folded[9], "│ " + "… 2 more" + " ".repeat(36) + " │");
		assert.match(folded[0]!, /Todo · 10 open · 0 done/);
	} finally {
		setLanguage("es");
	}
});
