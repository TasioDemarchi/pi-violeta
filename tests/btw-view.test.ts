import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	btwViewLayout,
	btwViewRows,
	clampScroll,
	initialBtwView,
	reduceBtwView,
	renderBtwView,
} from "../src/btw/view.ts";
import { answerBtw, askBtw, emptyBtw, failBtw, type BtwState } from "../src/btw/state.ts";

/** Plain text, so an assertion reads the characters and not the escapes. */
const fg = (_role: string, text: string) => text;

/** A conversation whose answer is far taller than any overlay. */
function longState(): BtwState {
	const lines = Array.from({ length: 60 }, (_unused, index) => `linea ${index + 1}`).join("\n");
	return answerBtw(askBtw(emptyBtw(), "una pregunta"), lines);
}

test("the reader opens at the bottom: the newest line is on screen, the first is not", () => {
	const rows = btwViewRows(longState(), 40);
	const layout = btwViewLayout(40, 12);
	const lines = renderBtwView(initialBtwView(), rows, layout, fg);
	assert.ok(lines.some((line) => line.includes("linea 60")), "the last line is shown");
	assert.ok(!lines.some((line) => line.includes("linea 1 ")), "the first line is not");
});

test("g goes to the top and shows the question that started it", () => {
	const rows = btwViewRows(longState(), 40);
	const layout = btwViewLayout(40, 12);
	const top = reduceBtwView(initialBtwView(), "top", layout.bodyRows);
	const lines = renderBtwView(top, rows, layout, fg);
	assert.ok(lines.some((line) => line.includes("› una pregunta")), "the question is at the top");
	assert.ok(!lines.some((line) => line.includes("linea 60")), "the end is off screen");
});

test("a page jump moves exactly the body height, and k walks back one row", () => {
	const layout = btwViewLayout(40, 12);
	const top = reduceBtwView(initialBtwView(), "top", layout.bodyRows);
	const down = reduceBtwView(top, "pageDown", layout.bodyRows);
	assert.equal(down.scroll, layout.bodyRows);
	assert.equal(reduceBtwView(down, "up", layout.bodyRows).scroll, layout.bodyRows - 1);
	assert.equal(reduceBtwView(down, "pageUp", layout.bodyRows).scroll, 0);
});

test("scrolling clamps at both ends: never above the first row, never past the last page", () => {
	const layout = btwViewLayout(40, 12);
	assert.equal(reduceBtwView({ scroll: 0, closed: false }, "up", layout.bodyRows).scroll, 0);
	assert.equal(reduceBtwView({ scroll: 0, closed: false }, "pageUp", layout.bodyRows).scroll, 0);
	// The reducer does not clamp the bottom (it cannot know the height); render does.
	assert.equal(clampScroll(Number.MAX_SAFE_INTEGER, 60, 10), 50);
	assert.equal(clampScroll(999, 6, 10), 0, "everything fits: no scroll at all");
});

test("the position counter appears only when something is off screen", () => {
	const layout = btwViewLayout(40, 12);
	const long = renderBtwView(initialBtwView(), btwViewRows(longState(), 40), layout, fg);
	assert.match(long[0]!, /\d+-\d+\/\d+/, "a long conversation says where you are");

	const short = answerBtw(askBtw(emptyBtw(), "hola"), "corto");
	const lines = renderBtwView(initialBtwView(), btwViewRows(short, 40), layout, fg);
	assert.doesNotMatch(lines[0]!, /\d+-\d+\/\d+/, "a short one does not");
});

test("every line is padded to the exact width, so nothing underneath shows through", () => {
	const layout = btwViewLayout(37, 9);
	const lines = renderBtwView(initialBtwView(), btwViewRows(longState(), layout.width), layout, fg);
	assert.equal(lines.length, layout.bodyRows + 2, "header + body + hint");
	for (const line of lines) assert.equal(visibleWidth(line), 37, `padded: ${JSON.stringify(line)}`);
});

test("the hint names the keys the overlay actually handles", () => {
	const layout = btwViewLayout(60, 8);
	const lines = renderBtwView(initialBtwView(), btwViewRows(longState(), 60), layout, fg);
	const hint = lines[lines.length - 1]!;
	for (const key of ["j/k", "ctrl+j/k", "g/G", "esc"]) {
		assert.ok(hint.includes(key), `the hint names ${key}`);
	}
});

test("close is the only action that closes, and an unknown action changes nothing", () => {
	const open = initialBtwView();
	assert.equal(reduceBtwView(open, "close", 10).closed, true);
	assert.equal(reduceBtwView(open, "down", 10).closed, false);
	assert.deepEqual(reduceBtwView(open, "nope" as never, 10), open);
});

test("an empty aside and a failed one both render without throwing", () => {
	const layout = btwViewLayout(30, 6);
	for (const state of [emptyBtw(), failBtw(askBtw(emptyBtw(), "y?"), "no pude preguntar")]) {
		const lines = renderBtwView(initialBtwView(), btwViewRows(state, layout.width), layout, fg);
		assert.equal(lines.length, layout.bodyRows + 2);
	}
});

test("the reader and the panel wrap a turn the same way", async () => {
	const { btwContentRows } = await import("../src/btw/panel.ts");
	const state = longState();
	assert.deepEqual(btwViewRows(state, 44), btwContentRows(state, 44));
});
