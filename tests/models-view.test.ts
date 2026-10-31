import { test } from "node:test";
import assert from "node:assert/strict";
import {
	initialModelsState,
	modelRows,
	reduceModels,
	renderModelsOverlay,
	type ModelCandidate,
	type ViewFg,
} from "../src/models-view/view.ts";
import { setLanguage } from "../src/i18n.ts";

const plain: ViewFg = (_role, text) => text;

const candidates: ModelCandidate[] = [
	{ provider: "nan", id: "deepseek-v4-flash", contextWindow: 1_000_000, authAvailable: true },
	{ provider: "nan", id: "glm5.3", contextWindow: 1_000_000, authAvailable: true },
	{ provider: "nan", id: "qwen3.6", contextWindow: 262_000, authAvailable: true },
	{ provider: "locked", id: "gpt-x", contextWindow: 128_000, authAvailable: false },
];

// --- Filtering and marking ----------------------------------------------------

test("only models with auth available are listed, and the current one is marked", () => {
	const rows = modelRows(candidates, "nan", "glm5.3");
	assert.deepEqual(
		rows.map((r) => `${r.provider}/${r.id}`),
		["nan/deepseek-v4-flash", "nan/glm5.3", "nan/qwen3.6"],
	);
	assert.deepEqual(
		rows.map((r) => r.current),
		[false, true, false],
	);
});

test("no current model marks nothing", () => {
	const rows = modelRows(candidates, undefined, undefined);
	assert.deepEqual(rows.map((r) => r.current), [false, false, false]);
});

test("an empty candidate list yields no rows", () => {
	assert.equal(modelRows([], "nan", "deepseek-v4-flash").length, 0);
	assert.equal(modelRows(candidates.filter((c) => !c.authAvailable)).length, 0);
});

// --- Selection reducer ---------------------------------------------------------

test("the reducer starts on the first row and moves without crossing the ends", () => {
	let state = initialModelsState(3);
	assert.equal(state.index, 0);
	assert.equal(state.closed, false);
	state = reduceModels(state, "down", 3);
	assert.equal(state.index, 1);
	state = reduceModels(state, "down", 3);
	state = reduceModels(state, "down", 3); // clamps at the last row
	assert.equal(state.index, 2);
	state = reduceModels(state, "up", 3);
	assert.equal(state.index, 1);
	state = reduceModels(state, "up", 3);
	state = reduceModels(state, "up", 3); // clamps at the first row
	assert.equal(state.index, 0);
});

test("select marks the chosen row and closes; close closes without choosing", () => {
	let state = reduceModels(initialModelsState(3), "down", 3);
	state = reduceModels(state, "select", 3);
	assert.equal(state.chosen, 1);
	assert.equal(state.closed, true);
	const closed = reduceModels(initialModelsState(3), "close", 3);
	assert.equal(closed.closed, true);
	assert.equal(closed.chosen, undefined);
});

test("the reducer is safe on an empty list", () => {
	const state = initialModelsState(0);
	assert.equal(reduceModels(state, "down", 0).index, 0);
	assert.equal(reduceModels(state, "select", 0).chosen, undefined);
});

// --- Render (es + en) -----------------------------------------------------------

const rows = modelRows(candidates, "nan", "deepseek-v4-flash");

test("the overlay renders title, marked rows with context windows, and the es hint", () => {
	setLanguage("es");
	const lines = renderModelsOverlay(rows, initialModelsState(rows.length), 60, plain);
	assert.equal(lines[0], "Modelos");
	assert.ok(lines.some((l) => l.includes("nan/glm5.3")), lines.join("\n"));
	assert.ok(lines.some((l) => l.includes("1.0M")), lines.join("\n"));
	assert.ok(lines.some((l) => l.includes("262.0k")), lines.join("\n"));
	// The current model is marked, the selected row carries the › marker.
	assert.ok(lines.some((l) => l.includes("›") && l.includes("nan/deepseek-v4-flash")), lines.join("\n"));
	assert.ok(lines.some((l) => l.includes("●") && l.includes("nan/deepseek-v4-flash")), lines.join("\n"));
	assert.ok(!lines.some((l) => l.includes("locked/gpt-x")));
	assert.equal(lines[lines.length - 1], "j/k seleccionar  enter cambiar  esc cerrar");
	// No row wider than the overlay width.
	for (const line of lines) assert.ok(line.length <= 60, line);
});

test("the overlay renders the en hint and title", () => {
	try {
		setLanguage("en");
		const lines = renderModelsOverlay(rows, initialModelsState(rows.length), 60, plain);
		assert.equal(lines[0], "Models");
		assert.equal(lines[lines.length - 1], "j/k select  enter switch  esc close");
	} finally {
		setLanguage("es");
	}
});

test("the selection marker follows the reducer state", () => {
	setLanguage("es");
	const state = reduceModels(initialModelsState(rows.length), "down", rows.length);
	const lines = renderModelsOverlay(rows, state, 60, plain);
	const selected = lines.find((l) => l.includes("›"));
	assert.ok(selected!.includes("nan/glm5.3"), lines.join("\n"));
	// The previously selected row no longer carries the marker.
	const current = lines.find((l) => l.includes("nan/deepseek-v4-flash"));
	assert.ok(!current!.includes("›"), current);
});

test("an empty list shows the empty message in the active language", () => {
	setLanguage("es");
	const es = renderModelsOverlay([], initialModelsState(0), 60, plain);
	assert.ok(es.some((l) => l.includes("No hay modelos con autenticación disponible.")), es.join("\n"));
	try {
		setLanguage("en");
		const en = renderModelsOverlay([], initialModelsState(0), 60, plain);
		assert.ok(en.some((l) => l.includes("No models with available authentication.")), en.join("\n"));
	} finally {
		setLanguage("es");
	}
});

test("roles: the title uses accent, the selected row text, others muted", () => {
	const seen: Array<[string, string]> = [];
	renderModelsOverlay(rows, initialModelsState(rows.length), 60, (role, text) => {
		seen.push([role, text]);
		return text;
	});
	assert.ok(seen.some(([role, text]) => role === "accent" && text === "Modelos"));
	assert.ok(seen.some(([role, text]) => role === "dim" && text.includes("j/k seleccionar")));
});
