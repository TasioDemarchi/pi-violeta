import { test } from "node:test";
import assert from "node:assert/strict";
import {
	hintLine,
	initialOverlayState,
	listLines,
	overlayLayout,
	reduceOverlay,
	renderOverlay,
	resultLines,
	threadHeader,
	threadLines,
	type ViewFg,
} from "../src/agents/view.ts";
import type { AgentTask } from "../src/agents/store.ts";

const plain: ViewFg = (_role, text) => text;
const tagged: ViewFg = (role, text) => `<${role}>${text}</${role}>`;

function task(overrides: Partial<AgentTask>): AgentTask {
	return {
		id: "t1",
		name: "probe",
		label: "hello",
		title: "hello",
		status: "running",
		model: "gpt/x",
		effort: "low",
		tokens: 0,
		cost: 0,
		startedAt: 0,
		thread: [],
		...overrides,
	};
}

test("overlayLayout splits at 60+ columns and degrades to list-only below", () => {
	const wide = overlayLayout(120, 30);
	assert.equal(wide.mode, "split");
	assert.equal(wide.bodyRows, 28);
	assert.equal(wide.listWidth + wide.threadWidth, 118);
	const narrow = overlayLayout(50, 20);
	assert.equal(narrow.mode, "narrow");
	assert.equal(narrow.bodyRows, 18);
});

test("listLines put the header first, glyph + title rows, active before finished history", () => {
	const tasks = [
		task({ id: "old", name: "old", title: "old work", status: "completed", endedAt: 5_000 }),
		task({ id: "live", name: "worker", title: "grind away", label: "grind" }),
		task({ id: "newer", name: "newer", title: "newer work", status: "failed", endedAt: 9_000 }),
	];
	const lines = listLines(tasks, { width: 40, selectedId: "live" }, plain);
	assert.equal(lines[0], "1 activo · 2 terminados");
	assert.ok(lines[1]!.startsWith("› ◐ grind away"), "the list row is glyph + title");
	assert.ok(!lines[1]!.includes("worker"), "the agent name is not part of the list row");
	assert.ok(lines[2]!.startsWith("  ✗ newer work"));
	assert.ok(lines[3]!.startsWith("  ✓ old work"));
	// finished history is newest-ended first
	const index = (id: string) => lines.findIndex((line) => line.includes(id));
	assert.ok(index("newer") < index("old"));
	// unselected rows have a blank marker
	assert.ok(lines[2]!.startsWith("  "));
});

test("threadHeader reads `role · status · model · tokens · elapsed`", () => {
	const running = task({ tokens: 34_000 });
	assert.equal(threadHeader(running, 25_000, plain), "probe · en curso · gpt/x · 34.0k · 25s");
	const done = task({ status: "completed", tokens: 1000, endedAt: 10_000 });
	assert.equal(threadHeader(done, 99_999, plain), "probe · completado · gpt/x · 1.0k · 10s");
});

test("threadLines render thinking dimmed, text plain, and tool calls as `⚙ toolName estado`", () => {
	const one = task({
		thread: [
			{ kind: "thinking", text: "hmm" },
			{ kind: "text", text: "hello\nworld" },
			{ kind: "tool", text: "", toolName: "bash", toolStatus: "running" },
			{ kind: "tool", text: "", toolName: "read", toolStatus: "error" },
			{ kind: "tool", text: "", toolName: "read", toolStatus: "done" },
		],
	});
	const lines = threadLines(one, 60, plain);
	assert.deepEqual(lines, ["hmm", "hello", "world", "⚙ bash en curso", "⚙ read error", "⚙ read listo"]);
	const roles = threadLines(one, 60, tagged);
	assert.ok(roles[0]!.startsWith("<dim>"));
	assert.ok(roles[1]!.startsWith("<text>"));
	assert.ok(roles[3]!.includes("<accent>⚙ bash</accent>"));
	assert.ok(roles[4]!.includes("error"));
	assert.ok(roles[5]!.includes("success"));
	// long text wraps to the width instead of overflowing
	const wrapped = threadLines(task({ thread: [{ kind: "text", text: "x".repeat(100) }] }), 20, plain);
	assert.equal(wrapped.length, 5);
});

test("the key reducer selects, scrolls, follows, goes back and closes", () => {
	const ids = ["a", "b", "c"];
	let state = initialOverlayState(ids);
	assert.deepEqual(state, { selectedId: "a", scroll: 0, follow: true, detail: false, closed: false });
	state = reduceOverlay(state, "down", ids);
	assert.equal(state.selectedId, "b");
	state = reduceOverlay(state, "down", ids);
	state = reduceOverlay(state, "down", ids);
	assert.equal(state.selectedId, "c", "selection clamps at the last task");
	state = reduceOverlay(state, "scrollDown", ids);
	assert.equal(state.scroll, 1);
	state = reduceOverlay(state, "scrollDown", ids);
	state = reduceOverlay(state, "scrollUp", ids);
	assert.equal(state.scroll, 1);
	state = reduceOverlay(state, "scrollUp", ids);
	state = reduceOverlay(state, "scrollUp", ids);
	assert.equal(state.scroll, 0, "scroll clamps at the top");
	state = reduceOverlay(state, "follow", ids);
	assert.equal(state.follow, false);
	state = reduceOverlay(state, "follow", ids);
	assert.equal(state.follow, true);
	// back in the list view closes the overlay
	assert.equal(reduceOverlay(state, "back", ids).closed, true);
	// back inside a narrow detail view returns to the list first
	const detail = reduceOverlay(initialOverlayState(ids), "open", ids);
	assert.equal(detail.detail, true);
	const back = reduceOverlay(detail, "back", ids);
	assert.equal(back.detail, false);
	assert.equal(back.closed, false);
	assert.equal(reduceOverlay(initialOverlayState(ids), "close", ids).closed, true);
});

test("hintLine lists the keys for the current view", () => {
	assert.equal(hintLine("split", plain), "j/k tarea  ctrl+j/k desplazar  f seguir  esc volver  q cerrar");
	assert.equal(hintLine("narrow", plain), "j/k seleccionar  enter hilo  esc volver  q cerrar");
});

test("resultLines shows the summary plus further result lines, the error, or a running placeholder", () => {
	const fromSummaryLine = task({
		status: "completed",
		summary: "Mapped the footer",
		result: "summary: Mapped the footer\nSource A\nSource B",
	});
	assert.deepEqual(resultLines(fromSummaryLine), ["Mapped the footer", "Source A", "Source B"]);
	const fromFirstLine = task({ status: "completed", summary: "The first line", result: "The first line\nThe second line" });
	assert.deepEqual(resultLines(fromFirstLine), ["The first line", "The second line"]);
	const failed = task({ status: "failed", error: "pi exited with code 1\nstderr: boom" });
	assert.deepEqual(resultLines(failed), ["pi exited with code 1", "stderr: boom"]);
	const running = task({});
	assert.deepEqual(resultLines(running), ["en curso…"]);
	// at most six further lines beyond the summary
	const many = task({
		status: "completed",
		summary: "S",
		result: "summary: S\n" + Array.from({ length: 10 }, (_, i) => `line ${i}`).join("\n"),
	});
	assert.equal(resultLines(many).length, 7);
	assert.equal(resultLines(many)![0], "S");
});

test("renderOverlay draws the list, the Title/Result/Thread pane and the hint at the exact height", () => {
		const now = 25_000;
		const tasks = [
			task({ id: "a", name: "alpha", title: "Prepare the launch", tokens: 34_000, thread: [{ kind: "text", text: "working" }] }),
			task({
				id: "b",
				name: "beta",
				title: "Finish the report",
				status: "completed",
				endedAt: 20_000,
				summary: "Report finished",
				result: "summary: Report finished\nDetails follow",
			}),
		];
		const layout = overlayLayout(80, 10);
		const lines = renderOverlay(tasks, initialOverlayState(["a"]), layout, now, plain);
		assert.equal(lines.length, 10);
		assert.ok(lines[0]!.includes("1 activo · 1 terminado"));
		assert.ok(lines[1]!.includes("› ◐ Prepare the launch"), "list row is glyph + title");
		assert.ok(lines[1]!.includes("Prepare the launch"), "the right pane starts with the title");
		assert.ok(lines[2]!.includes("alpha · en curso · gpt/x · 34.0k · 25s"), "meta line: role · status · model · tokens · elapsed");
		assert.ok(lines[2]!.includes("✓ Finish the report"));
		assert.ok(lines[3]!.includes("── Resultado ──"));
		assert.ok(lines[4]!.includes("en curso…"), "a running task shows the placeholder");
		assert.ok(lines[5]!.includes("── Hilo ──"));
		assert.ok(lines[6]!.includes("working"));
		assert.ok(lines[9]!.startsWith(hintLine("split", plain)));
		// every line fits the terminal width
		assert.ok(lines.every((line) => line.length <= 80));
		// narrow mode without detail still shows the list only
		const narrow = renderOverlay(tasks, initialOverlayState(["a"]), overlayLayout(50, 10), now, plain);
		assert.equal(narrow.length, 10);
		assert.ok(narrow[0]!.includes("1 activo · 1 terminado"));
		assert.ok(!narrow[0]!.includes("gpt/x"));
		assert.ok(narrow[9]!.startsWith(hintLine("narrow", plain)));
});

test("narrow mode detail view shows the same Title/Result/Thread layout", () => {
	const now = 25_000;
	const tasks = [
		task({ id: "a", name: "alpha", title: "Prepare the launch", tokens: 34_000, thread: [{ kind: "text", text: "working" }] }),
	];
	const state = { ...initialOverlayState(["a"]), detail: true };
	const lines = renderOverlay(tasks, state, overlayLayout(50, 10), now, plain);
	assert.equal(lines.length, 8, "one blank top row, six pane lines, one hint row");
	assert.ok(lines[1]!.includes("Prepare the launch"), "the title line is first");
	assert.ok(lines[2]!.includes("alpha · en curso · gpt/x · 34.0k · 25s"));
	assert.ok(lines[3]!.includes("── Resultado ──"));
	assert.ok(lines[4]!.includes("en curso…"));
	assert.ok(lines[5]!.includes("── Hilo ──"));
	assert.ok(lines[6]!.includes("working"));
	assert.ok(lines[7]!.startsWith(hintLine("narrow", plain)));
});
