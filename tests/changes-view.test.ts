import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleWidth } from "@earendil-works/pi-tui";
import { changes as t, sidebar as sidebarT } from "../src/i18n.ts";
import {
	capDiff,
	colorDiffLine,
	countDiff,
	diffHeader,
	DIFF_MAX_LINES,
	isBinaryDiff,
	parseDiff,
	untrackedLines,
	type DiffData,
} from "../src/changes-view/diff.ts";
import {
	changeEntries,
	entryKey,
	initialOverlayState,
	listLines,
	overlayLayout,
	reduceOverlay,
	renderOverlay,
	SPLIT_MIN_COLS,
	type ChangeEntry,
	type ViewFg,
} from "../src/changes-view/view.ts";

const plain: ViewFg = (_role, text) => text;
const tagged: ViewFg = (role, text) => `<${role}>${text}</${role}>`;
/** A fake fg that emits real (zero-width) ANSI codes, so the frame's width
 * math behaves exactly as with the theme. */
const ANSI_CODES: Record<string, string> = {
	toolDiffAdded: "32",
	toolDiffRemoved: "31",
	toolDiffContext: "2",
	borderAccent: "36",
	accent: "35",
};
const ansi: ViewFg = (role, text) => `\x1b[${ANSI_CODES[role] ?? "0"}m${text}\x1b[0m`;

const SAMPLE_DIFF = [
	"diff --git a/base.txt b/base.txt",
	"index 1111111..2222222 100644",
	"--- a/base.txt",
	"+++ b/base.txt",
	"@@ -1,2 +1,2 @@",
	"-two",
	"+TWO",
	"+three",
	" context line",
	"",
].join("\n");

// --- diff.ts: parsing ----------------------------------------------------------

test("parseDiff classifies header, hunk, add, del and context lines", () => {
	const lines = parseDiff(SAMPLE_DIFF);
	assert.deepEqual(
		lines.map((line) => line.kind),
		["meta", "meta", "meta", "meta", "meta", "del", "add", "add", "context"],
	);
	assert.equal(lines[5]!.text, "-two");
	assert.equal(lines[6]!.text, "+TWO");
	assert.equal(lines[8]!.text, " context line");
});

test("parseDiff counts +++/--- as meta, not as add/del", () => {
	const counts = countDiff(parseDiff(SAMPLE_DIFF));
	assert.deepEqual(counts, { added: 2, deleted: 1 });
});

test("untrackedLines renders every content line as an add", () => {
	const lines = untrackedLines("hola\nmundo\n");
	assert.deepEqual(lines, [
		{ kind: "add", text: "hola" },
		{ kind: "add", text: "mundo" },
	]);
});

test("capDiff caps the rendered lines and reports the rest", () => {
	assert.equal(DIFF_MAX_LINES, 3000);
	const lines = Array.from({ length: DIFF_MAX_LINES + 5 }, (_, i) => ({ kind: "add" as const, text: `l${i}` }));
	const capped = capDiff(lines);
	assert.equal(capped.lines.length, DIFF_MAX_LINES);
	assert.equal(capped.truncated, 5);
	assert.deepEqual(capDiff(lines.slice(0, 3)), { lines: lines.slice(0, 3), truncated: 0 });
});

test("colorDiffLine maps kinds to the diff theme roles", () => {
	assert.equal(colorDiffLine({ kind: "add", text: "+x" }, tagged), "<toolDiffAdded>+x</toolDiffAdded>");
	assert.equal(colorDiffLine({ kind: "del", text: "-x" }, tagged), "<toolDiffRemoved>-x</toolDiffRemoved>");
	assert.equal(colorDiffLine({ kind: "context", text: " c" }, tagged), "<toolDiffContext> c</toolDiffContext>");
	assert.equal(colorDiffLine({ kind: "meta", text: "@@ -1 +" }, tagged), "<dim>@@ -1 +</dim>");
});

test("isBinaryDiff detects the git binary-file notice", () => {
	assert.equal(isBinaryDiff("Binary files a/img.png and /dev/null differ\n"), true);
	assert.equal(isBinaryDiff("diff --git a/x b/x\nGIT binary patch\nliteral 10\n"), true);
	assert.equal(isBinaryDiff(SAMPLE_DIFF), false);
});

test("diffHeader renders `path · +A −D` with success/error roles", () => {
	const data: DiffData = { path: "src/a.ts", added: 3, deleted: 1, binary: false, truncated: 0, lines: [] };
	assert.equal(diffHeader(data, 80, plain), "src/a.ts · +3 −1");
	assert.equal(diffHeader(data, 80, tagged), "<accent>src/a.ts</accent><dim> · </dim><success>+3</success> <error>−1</error>");
});

// --- view.ts: layout and list ---------------------------------------------------

const ENTRIES: ChangeEntry[] = [
	{ group: "created", path: "a.txt" },
	{ group: "updated", path: "b.ts" },
	{ group: "deleted", path: "c.js" },
];

test("changeEntries groups created, updated and deleted in that order", () => {
	const entries = changeEntries({ created: ["n1.txt", "n2.txt"], updated: ["u.ts"], deleted: ["d.js"] });
	assert.deepEqual(entries, [
		{ group: "created", path: "n1.txt" },
		{ group: "created", path: "n2.txt" },
		{ group: "updated", path: "u.ts" },
		{ group: "deleted", path: "d.js" },
	]);
	assert.equal(entryKey({ group: "created", path: "n1.txt" }), "created:n1.txt");
});

test("overlayLayout splits at 60+ columns and degrades to list-only below", () => {
	const wide = overlayLayout(80, 10);
	assert.equal(wide.mode, "split");
	assert.equal(wide.bodyRows, 8);
	assert.equal(wide.listWidth + wide.diffWidth + 1, 80);
	const edge = overlayLayout(SPLIT_MIN_COLS, 10);
	assert.equal(edge.mode, "split");
	const narrow = overlayLayout(SPLIT_MIN_COLS - 1, 10);
	assert.equal(narrow.mode, "narrow");
	assert.equal(narrow.listWidth, SPLIT_MIN_COLS - 1);
	assert.equal(narrow.bodyRows, 8);
});

test("listLines draws group headers and +/~/− markers with the selected row marked", () => {
	const lines = listLines(ENTRIES, { width: 40, selectedKey: "created:a.txt" }, tagged);
	assert.deepEqual(lines, [
		"<success>+1</success> <warning>~1</warning> <error>−1</error>",
		"<success>+</success> <dim>1 created</dim>",
		"<accent>›</accent> <success>+</success> <text>a.txt</text>",
		"<warning>~</warning> <dim>1 updated</dim>",
		"  <warning>~</warning> <muted>b.ts</muted>",
		"<error>−</error> <dim>1 deleted</dim>",
		"  <error>−</error> <muted>c.js</muted>",
	]);
});

test("listLines of a clean tree shows the dim empty message", () => {
	try {
		const lines = listLines([], { width: 40 }, tagged);
		assert.deepEqual(lines, ["<dim>No changes.</dim>"]);
	} finally {
	}
});

// --- view.ts: key reducer ---------------------------------------------------------

test("reduceOverlay moves j/k (up/down) with clamped bounds and resets the scroll", () => {
	const keys = ENTRIES.map(entryKey);
	const initial = initialOverlayState(ENTRIES);
	assert.equal(initial.selectedKey, "created:a.txt");
	const down = reduceOverlay(initial, "down", keys);
	assert.equal(down.selectedKey, "updated:b.ts");
	assert.equal(down.scroll, 0);
	const end = reduceOverlay(initial, "down", ["only:one"]);
	assert.equal(end.selectedKey, "only:one");
	assert.equal(reduceOverlay(initial, "up", keys).selectedKey, "created:a.txt", "up clamps at the top");
	let state = initial;
	for (let i = 0; i < 10; i++) state = reduceOverlay(state, "down", keys);
	assert.equal(state.selectedKey, "deleted:c.js", "down clamps at the bottom");
});

test("reduceOverlay scrolls with ctrl+j/ctrl+k and jumps with g/G", () => {
	const keys = ENTRIES.map(entryKey);
	const initial = initialOverlayState(ENTRIES);
	assert.equal(reduceOverlay(initial, "scrollUp", keys).scroll, 0, "scroll clamps at the top");
	assert.equal(reduceOverlay(initial, "scrollDown", keys).scroll, 1);
	assert.equal(reduceOverlay(reduceOverlay(initial, "scrollDown", keys), "scrollDown", keys).scroll, 2);
	assert.equal(reduceOverlay({ ...initial, scroll: 5 }, "top", keys).scroll, 0);
	assert.equal(reduceOverlay(initial, "bottom", keys).scroll, Number.MAX_SAFE_INTEGER);
});

test("reduceOverlay opens the narrow diff, goes back, and closes", () => {
	const keys = ENTRIES.map(entryKey);
	const initial = initialOverlayState(ENTRIES);
	assert.equal(reduceOverlay(initial, "open", keys).detail, true);
	assert.equal(reduceOverlay({ ...initial, detail: true }, "back", keys).detail, false, "esc leaves the detail first");
	assert.equal(reduceOverlay(initial, "back", keys).closed, true);
	assert.equal(reduceOverlay(initial, "close", keys).closed, true);
	assert.deepEqual(reduceOverlay(initial, "openEditor", keys), initial, "o does not change the state");
});

// --- view.ts: frame ---------------------------------------------------------------

function diffData(overrides: Partial<DiffData> = {}): DiffData {
	return { path: "b.ts", added: 2, deleted: 1, binary: false, truncated: 0, lines: parseDiff(SAMPLE_DIFF), ...overrides };
}

test("renderOverlay draws the counts header, the divider, the diff and the hint at the exact height", () => {
	try {
		const layout = overlayLayout(80, 10);
		const lines = renderOverlay(ENTRIES, diffData(), initialOverlayState(ENTRIES), layout, plain);
		assert.equal(lines.length, 10, "header + 8 body rows + hint");
		assert.ok(lines[0]!.includes("+1 ~1 −1"), "left header shows the counts");
		assert.ok(lines[0]!.includes("b.ts · +2 −1"), "right header is `path · +A −D`");
		assert.ok(lines.some((line) => line.includes("│")), "split mode has a divider column");
		assert.ok(lines.some((line) => line.includes("-two")), "deleted diff lines are shown");
		assert.ok(lines.some((line) => line.includes("+TWO")), "added diff lines are shown");
		assert.ok(lines.some((line) => line.includes("1 created")), "group headers appear");
		assert.ok(lines[9]!.startsWith("j/k file  ctrl+j/k scroll  g/G top/bottom  o open  esc close"));
		assert.ok(lines.every((line) => line.length <= 80));
	} finally {
	}
});

test("renderOverlay colors diff lines through the diff theme roles", () => {
	const lines = renderOverlay(ENTRIES, diffData(), initialOverlayState(ENTRIES), overlayLayout(80, 20), ansi);
	const body = lines.join("\n");
	assert.ok(body.includes("\x1b[32m+TWO\x1b[0m"), "added lines use toolDiffAdded");
	assert.ok(body.includes("\x1b[31m-two\x1b[0m"), "deleted lines use toolDiffRemoved");
	assert.ok(body.includes("\x1b[2m context line\x1b[0m"), "context lines use toolDiffContext");
	assert.ok(body.includes("\x1b[36m│\x1b[0m"), "the divider uses borderAccent");
	assert.ok(lines.every((line) => visibleWidth(line) <= 80), "every row fits the width (ANSI codes are zero-width)");
});

test("renderOverlay clamps the scroll: G lands on the last lines, g returns to the top", () => {
	const layout = overlayLayout(80, 6); // bodyRows = 4
	const keys = ENTRIES.map(entryKey);
	const top = renderOverlay(ENTRIES, diffData(), { ...initialOverlayState(ENTRIES), scroll: 0 }, layout, plain);
	const bottom = renderOverlay(ENTRIES, diffData(), reduceOverlay(initialOverlayState(ENTRIES), "bottom", keys), layout, plain);
	const diffLines = parseDiff(SAMPLE_DIFF);
	assert.ok(top[1]!.includes(diffLines[0]!.text), "top starts at the first diff line");
	assert.ok(!top.join("\n").includes(" context line"), "top hides the last lines");
	assert.ok(bottom[4]!.includes(" context line"), "bottom shows the last diff line");
	const backTop = renderOverlay(ENTRIES, diffData(), reduceOverlay(initialOverlayState(ENTRIES), "top", keys), layout, plain);
	assert.equal(backTop[1], top[1]);
});

test("renderOverlay appends the truncation notice after the capped lines", () => {
	try {
		const layout = overlayLayout(80, 6);
		const keys = ENTRIES.map(entryKey);
		const data = diffData({ truncated: 2, lines: [] });
		const bottom = renderOverlay(ENTRIES, data, reduceOverlay(initialOverlayState(ENTRIES), "bottom", keys), layout, plain);
		assert.ok(bottom.join("\n").includes("… 2 more lines"));
	} finally {
	}
});

test("renderOverlay shows `binary` for binary diffs and `loading…` while loading", () => {
	try {
		const layout = overlayLayout(80, 10);
		const binary = renderOverlay(ENTRIES, diffData({ binary: true, lines: [] }), initialOverlayState(ENTRIES), layout, plain);
		assert.ok(binary.join("\n").includes("binary"));
		const loading = renderOverlay(ENTRIES, undefined, initialOverlayState(ENTRIES), layout, plain);
		assert.ok(loading.join("\n").includes("loading…"));
	} finally {
	}
});

test("narrow mode is list-only; Enter opens the diff and esc returns", () => {
	try {
		const layout = overlayLayout(50, 10);
		const state = initialOverlayState(ENTRIES);
		const list = renderOverlay(ENTRIES, diffData(), state, layout, plain);
		assert.equal(list.length, 10);
		assert.ok(list[0]!.includes("+1 ~1 −1"));
		assert.ok(!list.join("\n").includes("b.ts · +2 −1"), "no diff header in the narrow list");
		assert.ok(list[9]!.startsWith("j/k file  enter diff  esc back  q close"));
		const keys = ENTRIES.map(entryKey);
		const detail = renderOverlay(ENTRIES, diffData(), reduceOverlay(state, "open", keys), layout, plain);
		assert.ok(detail[0]!.includes("b.ts · +2 −1"), "detail header is the diff header");
		assert.ok(detail.join("\n").includes("+TWO"));
		assert.ok(detail[9]!.startsWith("j/k file  enter diff  esc back  q close"));
	} finally {
	}
});

test("the hint row is the English one", () => {
	try {
		assert.equal(t.hint("split"), "j/k file  ctrl+j/k scroll  g/G top/bottom  o open  esc close");
		assert.equal(t.hint("narrow"), "j/k file  enter diff  esc back  q close");
		assert.equal(sidebarT.noRepo, "no repo");
		assert.equal(t.hint("split"), "j/k file  ctrl+j/k scroll  g/G top/bottom  o open  esc close");
		assert.equal(t.hint("narrow"), "j/k file  enter diff  esc back  q close");
		assert.equal(sidebarT.noRepo, "no repo");
		assert.equal(t.binary, "binary");
		assert.equal(t.empty, "No changes.");
		assert.equal(t.moreLines(1), "… 1 more line");
		assert.equal(t.moreLines(3), "… 3 more lines");
		assert.equal(t.loading, "loading…");
	} finally {
	}
});

test("the texts are English: binary, the empty tree message and the plural truncation notice", () => {
	try {
		assert.equal(t.binary, "binary");
		assert.equal(t.empty, "No changes.");
		assert.equal(t.loading, "loading…");
		assert.equal(t.moreLines(1), "… 1 more line");
		assert.equal(t.moreLines(3), "… 3 more lines");
		assert.equal(t.created(1), "1 created");
		assert.equal(t.created(2), "2 created");
		assert.equal(t.updated(1), "1 updated");
		assert.equal(t.deleted(4), "4 deleted");
		assert.equal(t.overlayNeedsTui, "The changes overlay requires interactive mode.");
		assert.equal(t.description, "Show the changes viewer (files and their diff)");
		assert.equal(t.shortcut, "Show the changes viewer");
	} finally {
	}
});
