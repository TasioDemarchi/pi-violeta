import { test } from "node:test";
import assert from "node:assert/strict";
import { collectUsage, contextLines, usageLines, type UsageEntry } from "../src/usage.ts";
import { setLanguage } from "../src/i18n.ts";

/** One assistant message, as the session branch stores it. */
function reply(model: string, input: number, output: number, cost: number, cache: { read?: number; write?: number } = {}): UsageEntry {
	return {
		type: "message",
		message: {
			role: "assistant",
			model,
			usage: { input, output, cacheRead: cache.read ?? 0, cacheWrite: cache.write ?? 0, cost: { total: cost } },
		},
	};
}

test("collectUsage sums only the assistant messages of the branch", () => {
	const usage = collectUsage([
		{ type: "message", message: { role: "user" } },
		reply("a", 100, 10, 0.5),
		{ type: "tool", message: { role: "assistant", usage: { input: 999, output: 999, cost: { total: 9 } } } },
		reply("a", 200, 20, 0.25),
	]);
	assert.equal(usage.total.replies, 2);
	assert.equal(usage.total.input, 300);
	assert.equal(usage.total.output, 30);
	assert.equal(usage.total.cost, 0.75);
});

test("collectUsage splits the totals by model, costliest first", () => {
	const usage = collectUsage([reply("cheap", 10, 1, 0), reply("dear", 5, 1, 2), reply("cheap", 10, 1, 0)]);
	assert.deepEqual(
		usage.byModel.map((m) => [m.model, m.replies, m.cost]),
		[
			["dear", 1, 2],
			["cheap", 2, 0],
		],
	);
});

test("models that cost the same are ordered by tokens, then by name", () => {
	const usage = collectUsage([reply("b", 1, 1, 0), reply("a", 50, 50, 0), reply("c", 1, 1, 0)]);
	assert.deepEqual(usage.byModel.map((m) => m.model), ["a", "b", "c"]);
});

test("a message with no usage, or with broken numbers, never poisons the total", () => {
	const usage = collectUsage([
		{ type: "message", message: { role: "assistant" } },
		{ type: "message", message: { role: "assistant", usage: { input: Number.NaN, output: undefined, cost: { total: Number.POSITIVE_INFINITY } } } },
		reply("a", 10, 2, 0.1),
	]);
	assert.equal(usage.total.replies, 2, "the message without numbers still counts as an answer");
	assert.equal(usage.total.input, 10);
	assert.equal(usage.total.cost, 0.1);
	assert.ok(Number.isFinite(usage.total.cost));
});

test("an empty branch yields zeroes and no models", () => {
	const usage = collectUsage([]);
	assert.equal(usage.total.replies, 0);
	assert.deepEqual(usage.byModel, []);
});

test("usageLines says so when the model has not answered yet", () => {
	setLanguage("es");
	assert.deepEqual(usageLines(collectUsage([])), ["Todavía no hubo respuestas del modelo en esta sesión."]);
});

test("usageLines puts a single model in the title instead of repeating it below", () => {
	setLanguage("es");
	const lines = usageLines(collectUsage([reply("deepseek-v4-flash", 1200, 340, 0)]));
	assert.deepEqual(lines, ["Uso de la sesión · 1 respuesta · deepseek-v4-flash", "Entrada 1.2k · Salida 340 · Costo $0.00"]);
});

test("usageLines lists every model when the session used more than one", () => {
	setLanguage("es");
	const lines = usageLines(collectUsage([reply("flash", 1000, 100, 0), reply("opus", 900, 120, 0.42)]));
	assert.equal(lines[0], "Uso de la sesión · 2 respuestas");
	assert.equal(lines[1], "Entrada 1.9k · Salida 220 · Costo $0.42");
	assert.equal(lines[2], "Por modelo:");
	assert.equal(lines[3], "  opus · 1 respuesta · ↑900 ↓120 · $0.42");
	assert.equal(lines[4], "  flash · 1 respuesta · ↑1.0k ↓100 · $0.00");
});

test("the cache line appears only when something was cached", () => {
	setLanguage("es");
	const without = usageLines(collectUsage([reply("a", 10, 1, 0)]));
	assert.ok(!without.some((line) => line.startsWith("Caché")));
	const with_ = usageLines(collectUsage([reply("a", 10, 1, 0, { read: 5000, write: 10 })]));
	assert.ok(with_.includes("Caché: 5.0k leídos · 10 escritos"));
});

test("a reply with no model id is named, not printed as undefined", () => {
	setLanguage("es");
	const lines = usageLines(collectUsage([{ type: "message", message: { role: "assistant", usage: { input: 1, output: 1, cost: { total: 0 } } } }]));
	assert.equal(lines[0], "Uso de la sesión · 1 respuesta · (sin nombre)");
});

test("contextLines reports the percent, the window and what is left", () => {
	setLanguage("es");
	assert.deepEqual(contextLines({ percent: 12.5, tokens: 125000, contextWindow: 1000000 }), [
		"Contexto: 13% de 1.0M tokens.",
		"Usado 125.0k · Libre 875.0k",
	]);
});

test("contextLines adds the /compact suggestion from 80% up", () => {
	setLanguage("es");
	assert.equal(contextLines({ percent: 79, tokens: 790, contextWindow: 1000 }).length, 2);
	const hot = contextLines({ percent: 80, tokens: 800, contextWindow: 1000 });
	assert.equal(hot.length, 3);
	assert.equal(hot[2], "El contexto está al 80 %. Considerá /compact.");
});

test("contextLines falls back to the division when the percent is missing", () => {
	setLanguage("es");
	assert.equal(contextLines({ percent: null, tokens: 500, contextWindow: 1000 })[0], "Contexto: 50% de 1.0k tokens.");
});

test("an unknown token count says so instead of claiming 0%", () => {
	setLanguage("es");
	const unknown = "Todavía no hay datos de contexto en esta sesión.";
	assert.deepEqual(contextLines({ percent: null, tokens: null, contextWindow: 1000000 }), [unknown]);
	assert.deepEqual(contextLines(undefined), [unknown]);
	assert.deepEqual(contextLines({ percent: 10, tokens: 100, contextWindow: 0 }), [unknown]);
});

test("the English dictionary renders both commands too", () => {
	try {
		setLanguage("en");
		assert.deepEqual(usageLines(collectUsage([reply("flash", 1000, 100, 0)])), ["Session usage · 1 reply · flash", "In 1.0k · Out 100 · Cost $0.00"]);
		assert.deepEqual(contextLines({ percent: 50, tokens: 500, contextWindow: 1000 }), ["Context: 50% of 1.0k tokens.", "Used 500 · Free 500"]);
	} finally {
		setLanguage("es");
	}
});
