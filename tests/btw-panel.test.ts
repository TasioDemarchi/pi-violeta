// The side chat's window: the frame that separates it from the harness, the
// exact geometry both placements depend on, and the wrapping underneath.
import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { BTW_MAX_WIDGET_ROWS, renderBtwPanel, wrapText } from "../src/btw/panel.ts";
import { answerBtw, askBtw, emptyBtw, failBtw, openBtw } from "../src/btw/state.ts";
import { setLanguage } from "../src/i18n.ts";

const fg = (_role: string, text: string) => text;

test("btw panel: wrapping breaks on spaces and never goes over the width", () => {
	const lines = wrapText("uno dos tres cuatro cinco seis", 10);
	for (const line of lines) assert.ok(line.length <= 10, `"${line}" fits in 10`);
	assert.deepEqual(lines, ["uno dos", "tres", "cuatro", "cinco seis"]);
});

test("btw panel: wrapping keeps paragraph breaks and hard-breaks a word that cannot fit", () => {
	assert.deepEqual(wrapText("a\n\nb", 10), ["a", "", "b"]);
	const long = wrapText("corto supercalifragilisticoexpialidoso", 10);
	for (const line of long) assert.ok(line.length <= 10, `"${line}" fits in 10`);
	assert.equal(long.join(""), "cortosupercalifragilisticoexpialidoso");
	assert.deepEqual(wrapText("", 10), [""]);
});

test("btw panel: every line is exactly the requested width, frame included", () => {
	setLanguage("es");
	const state = answerBtw(askBtw(emptyBtw(), "¿qué es el hub?"), "un objeto en globalThis que comparten las extensiones");
	for (const width of [12, 20, 44, 80]) {
		const lines = renderBtwPanel(state, { width }, fg);
		for (const line of lines) assert.equal(visibleWidth(line), width, `width ${width}: "${line}"`);
	}
});

test("btw panel: the frame is a closed box, so it does not read as part of the chat", () => {
	const lines = renderBtwPanel(openBtw(emptyBtw()), { width: 30 }, fg);
	assert.match(lines[0]!, /^╭─ Al margen ─+╮$/);
	assert.equal(lines.at(-1), "╰" + "─".repeat(28) + "╯");
	for (const line of lines.slice(1, -1)) assert.match(line, /^│ .* │$/);
});

test("btw panel: an empty side chat explains how to use it, and a waiting one says so", () => {
	setLanguage("es");
	const empty = renderBtwPanel(openBtw(emptyBtw()), { width: 44 }, fg).join("\n");
	assert.match(empty, /\/btw <pregunta>/);
	const waiting = renderBtwPanel(askBtw(emptyBtw(), "¿cuánto cuesta?"), { width: 44 }, fg).join("\n");
	assert.match(waiting, /pensando…/);
	assert.match(waiting, /› ¿cuánto cuesta\?/, "the question is marked as yours");
});

test("btw panel: a failure is shown in the panel instead of scrolling away", () => {
	const lines = renderBtwPanel(failBtw(askBtw(emptyBtw(), "a"), "No pude preguntar: timeout"), { width: 44 }, fg).join("\n");
	assert.match(lines, /timeout/);
});

test("btw panel: with rows the panel is exactly that tall, padded or trimmed", () => {
	const short = renderBtwPanel(openBtw(emptyBtw()), { width: 44, rows: 12 }, fg);
	assert.equal(short.length, 12, "the sidebar column asks for an exact height");
	for (const line of short) assert.equal(visibleWidth(line), 44);
	const long = answerBtw(askBtw(emptyBtw(), "pregunta"), "palabra ".repeat(200));
	assert.equal(renderBtwPanel(long, { width: 44, rows: 12 }, fg).length, 12);
	assert.equal(renderBtwPanel(long, { width: 44, rows: 3 }, fg).length, 3);
});

test("btw panel: a long conversation shows its end, which is the answer you asked for", () => {
	let state = emptyBtw();
	for (const n of [1, 2, 3, 4, 5]) state = answerBtw(askBtw(state, `pregunta ${n}`), `respuesta ${n}`);
	const body = renderBtwPanel(state, { width: 44, rows: 8 }, fg).join("\n");
	assert.match(body, /respuesta 5/, "the newest answer is on screen");
	assert.ok(!body.includes("pregunta 1"), "the oldest turn scrolled out");
});

test("btw panel: without rows the box grows with its content, up to the widget cap", () => {
	const one = renderBtwPanel(answerBtw(askBtw(emptyBtw(), "a"), "b"), { width: 44 }, fg);
	assert.equal(one.length, 5, "question, blank, answer, plus the two frame rows");
	const huge = answerBtw(askBtw(emptyBtw(), "a"), "palabra ".repeat(300));
	assert.equal(renderBtwPanel(huge, { width: 44 }, fg).length, BTW_MAX_WIDGET_ROWS + 2);
	assert.equal(renderBtwPanel(huge, { width: 44, maxRows: 4 }, fg).length, 6);
});
