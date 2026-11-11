// What the side chat sends: the transcript it takes from the session, the cut
// that keeps a long session from costing more than the question, and the one
// user message it builds.
import assert from "node:assert/strict";
import { test } from "node:test";
import { branchTurns, buildBtwPrompt, recentTurns } from "../src/btw/request.ts";

const message = (role: string, content: unknown) => ({ type: "message", message: { role, content } });

test("btw request: the branch gives the conversation and nothing else", () => {
	const turns = branchTurns([
		message("system", "no cuenta"),
		message("user", "hola"),
		message("assistant", [
			{ type: "thinking", thinking: "no se manda" },
			{ type: "text", text: "qué tal" },
			{ type: "toolCall", id: "1", name: "bash" },
		]),
		{ type: "custom", customType: "violeta-todo", content: {} },
		{ type: "toolResult", message: { role: "toolResult", content: "salida" } },
		message("user", "  "),
		message("assistant", []),
		message("user", "seguimos"),
	]);
	assert.deepEqual(turns, [
		{ role: "user", text: "hola" },
		{ role: "assistant", text: "qué tal" },
		{ role: "user", text: "seguimos" },
	]);
});

test("btw request: a branch that is not what we expect yields no turns instead of throwing", () => {
	assert.deepEqual(branchTurns([]), []);
	assert.deepEqual(branchTurns([undefined, null, 7, "x", {}, { type: "message" }]), []);
	assert.deepEqual(branchTurns([message("user", { not: "content" })]), []);
});

test("btw request: the cut keeps the newest turns that fit", () => {
	const turns = [
		{ role: "user" as const, text: "a".repeat(10) },
		{ role: "assistant" as const, text: "b".repeat(10) },
		{ role: "user" as const, text: "c".repeat(10) },
	];
	assert.deepEqual(recentTurns(turns, 100), turns, "everything fits");
	assert.deepEqual(
		recentTurns(turns, 20).map((turn) => turn.text[0]),
		["b", "c"],
		"the oldest is dropped, not the newest",
	);
	assert.deepEqual(recentTurns(turns, 10).map((turn) => turn.text[0]), ["c"]);
});

test("btw request: a single turn bigger than the budget is cut, so a question never loses its context", () => {
	const kept = recentTurns([{ role: "user", text: "x".repeat(50) }], 10);
	assert.equal(kept.length, 1);
	assert.equal(kept[0]!.text, "x".repeat(10));
	assert.deepEqual(recentTurns([], 10), []);
});

test("btw request: an older oversized turn is dropped rather than cut in half", () => {
	const kept = recentTurns(
		[
			{ role: "user", text: "viejo ".repeat(10) },
			{ role: "assistant", text: "nuevo" },
		],
		10,
	);
	assert.deepEqual(kept, [{ role: "assistant", text: "nuevo" }]);
});

test("btw request: the prompt carries the transcript, the aside and the question, in that order", () => {
	const prompt = buildBtwPrompt({
		question: "¿y el hub?",
		transcript: [
			{ role: "user", text: "arreglá el guard" },
			{ role: "assistant", text: "listo" },
		],
		history: [
			{ role: "user", text: "¿qué es un modo?" },
			{ role: "assistant", text: "un markdown" },
			{ role: "error", text: "no pude preguntar: timeout" },
		],
	});
	assert.match(prompt, /Main session transcript/);
	assert.match(prompt, /User: arreglá el guard/);
	assert.match(prompt, /Assistant: listo/);
	assert.match(prompt, /This aside so far/);
	assert.match(prompt, /Question: ¿qué es un modo\?/);
	assert.match(prompt, /Answer: un markdown/);
	assert.ok(!prompt.includes("timeout"), "a failure is for the panel, not for the model");
	assert.ok(prompt.indexOf("Main session transcript") < prompt.indexOf("This aside so far"));
	assert.ok(prompt.trimEnd().endsWith("¿y el hub?"), "the question is last");
});

test("btw request: an empty transcript and history leave the question alone", () => {
	const prompt = buildBtwPrompt({ question: "¿cuánto es 2+2?", transcript: [], history: [] });
	assert.ok(!prompt.includes("Main session transcript"), "a session with no turns has nothing to carry");
	assert.ok(!prompt.includes("This aside so far"));
	assert.match(prompt, /=== The question ===\n¿cuánto es 2\+2\?$/);
});
