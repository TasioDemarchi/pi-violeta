import { test } from "node:test";
import assert from "node:assert/strict";
import {
	classifyCommand,
	filterEntries,
	initialPaletteState,
	paletteEntries,
	reducePalette,
	renderPalette,
	PI_BUILTIN_COMMANDS,
	type PaletteCommand,
	type PaletteEntry,
	type ViewFg,
} from "../src/palette/view.ts";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { palette as t, setLanguage } from "../src/i18n.ts";

const plain: ViewFg = (_role, text) => text;

/** A fixture like the real session: violeta's own commands (source
 * "extension") plus one prompt template and one skill command. */
const FIXTURE_COMMANDS: PaletteCommand[] = [
	{ name: "sidebar", description: "Muestra u oculta la barra lateral", source: "extension" },
	{ name: "language", description: "Cambia el idioma de la interfaz", source: "extension" },
	{ name: "changes", description: "Muestra el visor de cambios (archivos y su diff)", source: "extension" },
	{ name: "agents", description: "Muestra la vista de subagentes", source: "extension" },
	{ name: "jobs", description: "Muestra la vista de trabajos", source: "extension" },
	{ name: "release-notes", description: "Notas de la versión", source: "prompt" },
	{ name: "skill:review", description: "Review the current diff", source: "skill" },
];

// --- Classification table -------------------------------------------------------

test("the classification table covers violeta's commands and Pi's well-known ones deterministically", () => {
	assert.equal(classifyCommand("sidebar"), "interface");
	assert.equal(classifyCommand("language"), "interface");
	assert.equal(classifyCommand("models"), "interface");
	assert.equal(classifyCommand("palette"), "interface");
	assert.equal(classifyCommand("todo"), "interface");
	assert.equal(classifyCommand("changes"), "interface");
	assert.equal(classifyCommand("notify"), "interface");
	assert.equal(classifyCommand("agents"), "tools");
	assert.equal(classifyCommand("jobs"), "tools");
	assert.equal(classifyCommand("grants"), "tools");
	// Pi's well-known built-ins.
	assert.equal(classifyCommand("new"), "session");
	assert.equal(classifyCommand("resume"), "session");
	assert.equal(classifyCommand("compact"), "session");
	assert.equal(classifyCommand("settings"), "interface");
	assert.equal(classifyCommand("model"), "interface");
	assert.equal(classifyCommand("reload"), "tools");
	assert.equal(classifyCommand("hotkeys"), "tools");
	assert.equal(classifyCommand("quit"), "other");
	assert.equal(classifyCommand("bug"), "other");
	// Anything unknown falls into "other".
	assert.equal(classifyCommand("totally-unknown"), "other");
});

// --- Entries: builtins merged, deduped, grouped and sorted ----------------------

test("paletteEntries appends Pi's well-known built-ins and dedupes by name (extension wins)", () => {
	const entries = paletteEntries(FIXTURE_COMMANDS);
	const names = entries.map((e) => e.name);
	// violeta's own and the template/skill commands are there...
	for (const name of ["sidebar", "language", "changes", "agents", "jobs", "release-notes", "skill:review"]) {
		assert.ok(names.includes(name), `missing ${name}`);
	}
	// ...and so are Pi's well-known built-ins, without dropping any fixture name.
	for (const builtin of PI_BUILTIN_COMMANDS) {
		assert.ok(names.includes(builtin.name), `missing builtin ${builtin.name}`);
	}
	// An extension command shadowing a builtin keeps the extension's data.
	const shadowed = paletteEntries([{ name: "new", description: "Comando propio", source: "extension" }]);
	const entry = shadowed.find((e) => e.name === "new");
	assert.equal(entry?.description, "Comando propio");
	assert.equal(entry?.source, "extension");
});

test("filtering groups Session / Interface / Tools / Other in order, sorted by name inside each group", () => {
	const entries = paletteEntries(FIXTURE_COMMANDS);
	const all = filterEntries(entries, "");
	const groups = all.map((e) => e.group);
	const firstOf = (g: string) => groups.indexOf(g);
	assert.ok(firstOf("session") >= 0, "a session group exists");
	assert.ok(firstOf("interface") > firstOf("session"), "interface after session");
	assert.ok(firstOf("tools") > firstOf("interface"), "tools after interface");
	assert.ok(firstOf("other") > firstOf("tools"), "other after tools");
	// Inside the interface group the names are sorted.
	const interfaceNames = all.filter((e) => e.group === "interface").map((e) => e.name);
	assert.deepEqual(interfaceNames, [...interfaceNames].sort());
});

// --- Filtering ------------------------------------------------------------------

test("the filter is a case-insensitive substring match over name and description", () => {
	const entries = paletteEntries(FIXTURE_COMMANDS);
	// by name, case-insensitive
	assert.deepEqual(filterEntries(entries, "LANG").map((e) => e.name), ["language"]);
	assert.deepEqual(filterEntries(entries, "angu").map((e) => e.name), ["language"]);
	// by description too (es fixture text)
	assert.deepEqual(filterEntries(entries, "visor de cambios").map((e) => e.name), ["changes"]);
	// no match
	assert.equal(filterEntries(entries, "zzzz").length, 0);
});

// --- Reducer --------------------------------------------------------------------

test("letters go to the query, backspace edits it, and typing clamps the selection", () => {
	const many = filterEntries(paletteEntries(FIXTURE_COMMANDS), "");
	let state = initialPaletteState();
	assert.equal(state.query, "");
	assert.equal(state.index, 0);
	assert.equal(state.closed, false);
	state = reducePalette(state, { type: "insert", text: "l" }, many);
	state = reducePalette(state, { type: "insert", text: "a" }, many);
	state = reducePalette(state, { type: "insert", text: "n" }, many);
	assert.equal(state.query, "lan");
	// typing shrank the list; the index stays valid (the caller filters with
	// the new query, exactly like the extension does on every keypress)
	state = reducePalette(state, { type: "down" }, filterEntries(paletteEntries(FIXTURE_COMMANDS), state.query));
	assert.equal(state.index, 0);
	state = reducePalette(state, { type: "backspace" }, many);
	assert.equal(state.query, "la");
	state = reducePalette(state, { type: "backspace" }, many);
	state = reducePalette(state, { type: "backspace" }, many);
	assert.equal(state.query, "");
	state = reducePalette(state, { type: "backspace" }, many); // backspace on empty is a no-op
	assert.equal(state.query, "");
	assert.equal(state.closed, false);
});

const THREE: PaletteEntry[] = [
	{ name: "a", source: "extension", group: "interface" },
	{ name: "b", source: "extension", group: "interface" },
	{ name: "c", source: "extension", group: "interface" },
];

test("navigation moves with up/down (arrows and ctrl+n/ctrl+p map to the same actions) and clamps at the ends", () => {
	let state = initialPaletteState();
	state = reducePalette(state, { type: "down" }, THREE);
	assert.equal(state.index, 1);
	state = reducePalette(state, { type: "down" }, THREE);
	state = reducePalette(state, { type: "down" }, THREE); // clamp at the last row
	assert.equal(state.index, 2);
	state = reducePalette(state, { type: "up" }, THREE);
	assert.equal(state.index, 1);
	state = reducePalette(state, { type: "up" }, THREE);
	state = reducePalette(state, { type: "up" }, THREE); // clamp at the first row
	assert.equal(state.index, 0);
});

test("enter records the selected command and closes; enter on an empty result does nothing", () => {
	const state = reducePalette(initialPaletteState(), { type: "down" }, THREE);
	const done = reducePalette(state, { type: "select" }, THREE);
	assert.equal(done.closed, true);
	assert.equal(done.chosen, "b");
	const empty = reducePalette(initialPaletteState(), { type: "select" }, []);
	assert.equal(empty.closed, false);
	assert.equal(empty.chosen, undefined);
});

test("esc is two-step: it first clears a non-empty query, then closes", () => {
	const many = filterEntries(paletteEntries(FIXTURE_COMMANDS), "");
	let state = reducePalette(initialPaletteState(), { type: "insert", text: "lang" }, many);
	state = reducePalette(state, { type: "escape" }, many);
	assert.equal(state.closed, false, "first esc only clears the query");
	assert.equal(state.query, "");
	assert.equal(state.index, 0);
	state = reducePalette(state, { type: "escape" }, many);
	assert.equal(state.closed, true, "second esc closes");
	// with an empty query a single esc closes right away
	const immediate = reducePalette(initialPaletteState(), { type: "escape" }, THREE);
	assert.equal(immediate.closed, true);
});

// --- Rendering ------------------------------------------------------------------

test("the render lists commands with descriptions and sources, and the shortcuts block", () => {
	setLanguage("es");
	const entries = paletteEntries(FIXTURE_COMMANDS);
	const lines = renderPalette(entries, initialPaletteState(), 100, 200, plain).join("\n");
	// title, search prompt, es hints
	assert.ok(lines.includes("Paleta de comandos"), lines);
	assert.ok(lines.includes("escribí para filtrar"), lines);
	// commands with description and source
	assert.ok(lines.includes("/sidebar"), lines);
	assert.ok(lines.includes("Muestra u oculta la barra lateral"), lines);
	assert.ok(lines.includes("extensión"), lines);
	assert.ok(lines.includes("/skill:review"), lines);
	assert.ok(lines.includes("Review the current diff"), lines);
	assert.ok(lines.includes("skill"), lines);
	// Pi built-ins with description and the pi source
	assert.ok(lines.includes("/compact"), lines);
	assert.ok(lines.includes("Manually compact the session context"), lines);
	assert.ok(lines.includes("pi"), lines);
	// group headers in es
	assert.ok(lines.includes("Sesión"), lines);
	assert.ok(lines.includes("Interfaz"), lines);
	assert.ok(lines.includes("Herramientas"), lines);
	assert.ok(lines.includes("Otros"), lines);
	// the static shortcuts block (alt+a, alt+g, alt+m, alt+k, alt+s, ctrl+o)
	assert.ok(lines.includes("alt+a"), lines);
	assert.ok(lines.includes("agentes"), lines);
	assert.ok(lines.includes("alt+g"), lines);
	assert.ok(lines.includes("cambios"), lines);
	assert.ok(lines.includes("alt+m"), lines);
	assert.ok(lines.includes("modelos"), lines);
	assert.ok(lines.includes("alt+k"), lines);
	assert.ok(lines.includes("paleta"), lines);
	assert.ok(lines.includes("alt+s"), lines);
	assert.ok(lines.includes("detener agentes"), lines);
	assert.ok(lines.includes("ctrl+o"), lines);
	assert.ok(lines.includes("expandir herramientas"), lines);
});

test("an empty result renders the empty row", () => {
	setLanguage("es");
	const entries = paletteEntries(FIXTURE_COMMANDS);
	const state = reducePalette(initialPaletteState(), { type: "insert", text: "zzzz" }, []);
	const lines = renderPalette(entries, state, 100, 200, plain);
	assert.ok(lines.join("\n").includes("Sin coincidencias."), lines.join("\n"));
});

test("the same overlay renders in English when the language is en", () => {
	try {
		setLanguage("en");
		const entries = paletteEntries(FIXTURE_COMMANDS);
		// the empty-result row in en
		const emptyState = reducePalette(initialPaletteState(), { type: "insert", text: "zzzz" }, []);
		assert.ok(renderPalette(entries, emptyState, 100, 200, plain).join("\n").includes("No matches."));
		const lines = renderPalette(entries, initialPaletteState(), 100, 200, plain).join("\n");
		assert.ok(lines.includes("Command palette"), lines);
		assert.ok(lines.includes("type to filter"), lines);
		assert.ok(lines.includes("Session"), lines);
		assert.ok(lines.includes("Interface"), lines);
		assert.ok(lines.includes("Tools"), lines);
		assert.ok(lines.includes("Other"), lines);
		assert.ok(lines.includes("agents"), lines);
		assert.ok(lines.includes("changes"), lines);
		assert.ok(lines.includes("models"), lines);
		assert.ok(lines.includes("palette"), lines);
		assert.ok(lines.includes("stop agents"), lines);
		assert.ok(lines.includes("expand tools"), lines);
	} finally {
		setLanguage("es");
	}
});

test("narrow terminals get a single-column list that fits the width", () => {
	setLanguage("es");
	const entries = paletteEntries(FIXTURE_COMMANDS);
	const lines = renderPalette(entries, initialPaletteState(), 40, 6, plain);
	assert.ok(lines.every((line) => visibleWidth(line) <= 40), lines.join("\n"));
	// the body budget is respected: at most the asked body lines between the
	// title/search header and the shortcuts/hint footer
	assert.ok(lines.length <= 2 + 6 + 10, `too many lines: ${lines.length}`);
	// one command per row: no wide multi-column layout
	const commandRows = lines.filter((line) => /\/[a-z]/.test(line)).length;
	assert.ok(commandRows <= 8, `single column expected, got ${commandRows} rows`);
});

test("the selected row stays visible inside a small body window", () => {
	setLanguage("es");
	const entries = paletteEntries(FIXTURE_COMMANDS);
	let state = initialPaletteState();
	const all = filterEntries(entries, "");
	// walk the selection to the end of the list and render with a tiny window
	for (let i = 0; i < all.length; i++) state = reducePalette(state, { type: "down" }, all);
	const lines = renderPalette(entries, state, 80, 5, plain).join("\n");
	const last = all[all.length - 1]!;
	assert.ok(lines.includes(`/${last.name}`), `selected row ${last.name} must stay visible:\n${lines}`);
});
