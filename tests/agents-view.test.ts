import { test } from "node:test";
import assert from "node:assert/strict";
import {
	hintLine,
	initialOverlayState,
	listLines,
	overlayLayout,
	reduceOverlay,
	renderOverlay,
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

test("listLines put the header first, active tasks before finished history", () => {
	const tasks = [
		task({ id: "old", name: "old", status: "completed", endedAt: 5_000 }),
		task({ id: "live", name: "worker", label: "grind" }),
		task({ id: "newer", name: "newer", status: "failed", endedAt: 9_000 }),
	];
	const lines = listLines(tasks, { width: 40, selectedId: "live" }, plain);
	assert.equal(lines[0], "1 active · 2 finished");
	assert.ok(lines[1]!.startsWith("› ◐ worker"));
	assert.ok(lines[1]!.includes("grind"));
	assert.ok(lines[2]!.startsWith("  ✗ newer"));
	assert.ok(lines[3]!.startsWith("  ✓ old"));
	// finished history is newest-ended first
	const index = (id: string) => lines.findIndex((line) => line.includes(id));
	assert.ok(index("newer") < index("old"));
	// unselected rows have a blank marker
	assert.ok(lines[2]!.startsWith("  "));
});

test("threadHeader reads `name · status · model · tokens · elapsed`", () => {
	const running = task({ tokens: 34_000 });
	assert.equal(threadHeader(running, 25_000, plain), "probe · running · gpt/x · 34.0k · 25s");
	const done = task({ status: "completed", tokens: 1000, endedAt: 10_000 });
	assert.equal(threadHeader(done, 99_999, plain), "probe · completed · gpt/x · 1.0k · 10s");
});

test("threadLines render thinking dimmed, text plain, and tool calls as `⚙ toolName status`", () => {
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
	assert.deepEqual(lines, ["hmm", "hello", "world", "⚙ bash running", "⚙ read error", "⚙ read done"]);
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
	assert.equal(hintLine("split", plain), "j/k task  ctrl+j/k scroll  f follow  esc back  q close");
	assert.equal(hintLine("narrow", plain), "j/k select  enter thread  esc back  q close");
});

test("renderOverlay draws the list, thread and hint at the exact terminal height", () => {
	const now = 25_000;
	const tasks = [
		task({ id: "a", name: "alpha", tokens: 34_000, thread: [{ kind: "text", text: "working" }] }),
		task({ id: "b", name: "beta", status: "completed", endedAt: 20_000 }),
	];
	const layout = overlayLayout(80, 10);
	const lines = renderOverlay(tasks, initialOverlayState(["a"]), layout, now, plain);
	assert.equal(lines.length, 10);
	// list column on the left, thread on the right of the body rows
	assert.ok(lines[0]!.includes("1 active · 1 finished"));
	assert.ok(lines[1]!.includes("› ◐ alpha"));
	assert.ok(lines[1]!.includes("alpha · running · gpt/x · 34.0k · 25s"));
	assert.ok(lines[2]!.includes("working"));
	assert.ok(lines[2]!.includes("✓ beta"));
	assert.ok(lines[9]!.startsWith(hintLine("split", plain)));
	// every line fits the terminal width
	assert.ok(lines.every((line) => line.length <= 80));
	// narrow mode shows the list only
	const narrow = renderOverlay(tasks, initialOverlayState(["a"]), overlayLayout(50, 10), now, plain);
	assert.equal(narrow.length, 10);
	assert.ok(narrow[0]!.includes("1 active · 1 finished"));
	assert.ok(!narrow[0]!.includes("gpt/x"));
	assert.ok(narrow[9]!.startsWith(hintLine("narrow", plain)));
});
