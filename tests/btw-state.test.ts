// The side chat's reducer and its command parsing: the behaviour /btw promises
// (a window with no argument, a question with one) and the rule that is easy to
// get wrong — asking publishes the question so the reader can show it.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	answerBtw,
	askBtw,
	emptyBtw,
	failBtw,
	parseBtwArgs,
} from "../src/btw/state.ts";

test("btw state: a fresh side chat is empty and not waiting", () => {
	// Whether the reader is on screen is the reader's own state (`closed` in
	// BtwViewState), not a flag copied here and never read.
	assert.deepEqual(emptyBtw(), { turns: [], asking: false });
	assert.ok(!("open" in emptyBtw()), "the state carries no open flag");
});

test("btw state: asking records the question and marks it waiting", () => {
	const state = askBtw(emptyBtw(), "¿cuánto cuesta?");
	assert.equal(state.asking, true);
	assert.deepEqual(state.turns, [{ role: "user", text: "¿cuánto cuesta?" }]);
});

test("btw state: the answer and the failure both stop the wait and stay in the conversation", () => {
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
