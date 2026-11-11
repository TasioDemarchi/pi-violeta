// The side chat's reducer and its command parsing: the behaviour the two
// commands promise (a window with no argument, a question with one) and the
// two rules that are easy to get wrong — asking opens the panel, and /btwn
// with a message asks on an empty history.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	answerBtw,
	askBtw,
	clearBtw,
	closeBtw,
	emptyBtw,
	failBtw,
	openBtw,
	parseBtwArgs,
	toggleBtw,
} from "../src/btw/state.ts";

test("btw state: a fresh side chat is closed, empty and not waiting", () => {
	const state = emptyBtw();
	assert.equal(state.open, false);
	assert.deepEqual(state.turns, []);
	assert.equal(state.asking, false);
});

test("btw state: the window opens, closes and toggles without touching the conversation", () => {
	const asked = answerBtw(askBtw(emptyBtw(), "¿qué es un hub?"), "un objeto compartido");
	assert.equal(openBtw(asked).open, true);
	assert.equal(closeBtw(openBtw(asked)).open, false);
	assert.equal(toggleBtw(closeBtw(asked)).open, true);
	assert.equal(toggleBtw(openBtw(asked)).open, false);
	assert.equal(closeBtw(asked).turns.length, 2, "closing keeps the conversation");
	assert.deepEqual(toggleBtw(asked).turns, asked.turns);
});

test("btw state: asking opens the panel and marks it waiting", () => {
	const state = askBtw(emptyBtw(), "¿cuánto cuesta?");
	assert.equal(state.open, true, "an answer nobody can see is useless");
	assert.equal(state.asking, true);
	assert.deepEqual(state.turns, [{ role: "user", text: "¿cuánto cuesta?" }]);
});

test("btw state: the answer and the failure both stop the wait and stay in the panel", () => {
	const answered = answerBtw(askBtw(emptyBtw(), "a"), "b");
	assert.equal(answered.asking, false);
	assert.deepEqual(answered.turns, [
		{ role: "user", text: "a" },
		{ role: "assistant", text: "b" },
	]);
	const failed = failBtw(askBtw(emptyBtw(), "a"), "no model");
	assert.equal(failed.asking, false);
	assert.deepEqual(failed.turns[1], { role: "error", text: "no model" });
});

test("btw state: clearing forgets the conversation and the wait, and leaves the window alone", () => {
	const cleared = clearBtw(askBtw(emptyBtw(), "a"));
	assert.deepEqual(cleared.turns, []);
	assert.equal(cleared.asking, false);
	assert.equal(cleared.open, true, "clearing is about the history, not the window");
	assert.equal(clearBtw(emptyBtw()).open, false);
});

test("btw state: a question after clearing is the only turn — /btwn carries nothing over", () => {
	const previous = answerBtw(askBtw(emptyBtw(), "vieja"), "respuesta vieja");
	const fresh = askBtw(clearBtw(previous), "nueva");
	assert.deepEqual(fresh.turns, [{ role: "user", text: "nueva" }]);
});

test("btw state: every operation returns a new state and never mutates the old one", () => {
	const base = emptyBtw();
	const asked = askBtw(base, "a");
	assert.deepEqual(base.turns, [], "the published state is never mutated under a renderer");
	assert.notEqual(asked, base);
	assert.notEqual(answerBtw(asked, "b").turns, asked.turns);
});

test("btw state: no argument means the window, an argument means a question", () => {
	assert.deepEqual(parseBtwArgs(""), { kind: "window" });
	assert.deepEqual(parseBtwArgs("   "), { kind: "window" }, "whitespace is not a question");
	assert.deepEqual(parseBtwArgs("\t\n"), { kind: "window" });
	assert.deepEqual(parseBtwArgs("  ¿y esto?  "), { kind: "ask", message: "¿y esto?" });
	assert.deepEqual(parseBtwArgs("on"), { kind: "ask", message: "on" }, "there are no subcommands: it is all question");
});
