/** Agents overlay (alt+a · /agents), pure rendering and key handling: the
 * split task-list/thread layout, the list and thread line builders, and a key
 * reducer the extension feeds raw input into. No Pi API here — the extension
 * only wires data, a theme-like `fg` function and terminal size. */

import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { fmtTokens } from "../format.ts";
import { formatElapsed } from "./card.ts";
import { isFinished, type AgentTask, type TaskStatus, type ThreadItem } from "./store.ts";

export type ViewFg = (role: string, text: string) => string;

export const SPLIT_MIN_COLS = 60;
const LIST_MAX_WIDTH = 34;
const LIST_MIN_WIDTH = 22;
const LIST_RATIO = 0.32;

const GLYPHS: Record<TaskStatus, { glyph: string; role: string }> = {
	queued: { glyph: "◌", role: "muted" },
	running: { glyph: "◐", role: "accent" },
	completed: { glyph: "✓", role: "success" },
	failed: { glyph: "✗", role: "error" },
	aborted: { glyph: "⊘", role: "warning" },
};

const STATUS_ROLES: Record<TaskStatus, string> = {
	queued: "muted",
	running: "accent",
	completed: "success",
	failed: "error",
	aborted: "warning",
};

const TOOL_STATUS_ROLES = { running: "warning", done: "success", error: "error" } as const;

function clip(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	let out = "";
	for (const char of text) {
		if (visibleWidth(out + char) > width - 1) break;
		out += char;
	}
	return `${out}…`;
}

// --- Layout -----------------------------------------------------------------

export interface OverlayLayout {
	mode: "split" | "narrow";
	width: number;
	bodyRows: number;
	listWidth: number;
	threadWidth: number;
}

/** At `SPLIT_MIN_COLS`+ the list and the thread sit side by side; below that
 * the list fills the width and Enter opens the thread. */
export function overlayLayout(width: number, height: number): OverlayLayout {
	// One header row and one hint row frame the body.
	const bodyRows = Math.max(1, height - 2);
	if (width < SPLIT_MIN_COLS) {
		return { mode: "narrow", width, bodyRows, listWidth: width, threadWidth: width };
	}
	const listWidth = Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, Math.floor(width * LIST_RATIO)));
	const threadWidth = Math.max(1, width - listWidth - 2);
	return { mode: "split", width, bodyRows, listWidth, threadWidth };
}

// --- Task list ---------------------------------------------------------------

/** Active tasks in start order, then finished history, newest ended first. */
export function overlayTasks(tasks: readonly AgentTask[]): AgentTask[] {
	const active = tasks.filter((task) => !isFinished(task.status));
	const finished = tasks
		.filter((task) => isFinished(task.status))
		.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
	return [...active, ...finished];
}

/** `N active · M finished` (zero segments are skipped). */
export function listHeader(tasks: readonly AgentTask[]): string {
	const active = tasks.filter((t) => t.status === "queued" || t.status === "running").length;
	const finished = tasks.filter((t) => isFinished(t.status)).length;
	const parts: string[] = [];
	if (active > 0) parts.push(`${active} active`);
	if (finished > 0) parts.push(`${finished} finished`);
	return parts.length > 0 ? parts.join(" · ") : "0 active · 0 finished";
}

/** One line per task: `› ◐ name  label` with the selected row marked. */
export function listLines(tasks: readonly AgentTask[], opts: { width: number; selectedId?: string }, fg: ViewFg): string[] {
	const lines = [fg("accent", clip(listHeader(tasks), opts.width))];
	for (const task of overlayTasks(tasks)) {
		const look = GLYPHS[task.status];
		const selected = task.id === opts.selectedId;
		const marker = selected ? fg("accent", "›") : " ";
		const text = clip(`${task.name}  ${task.label}`, Math.max(1, opts.width - 4));
		const row = `${marker} ${fg(look.role, look.glyph)} ${selected ? fg("text", text) : fg("muted", text)}`;
		lines.push(row);
	}
	return lines;
}

// --- Thread ------------------------------------------------------------------

/** `name · status · model · tokens · elapsed`; finished tasks freeze elapsed. */
export function threadHeader(task: AgentTask, now: number, fg: ViewFg): string {
	const elapsed = formatElapsed((task.endedAt ?? now) - task.startedAt);
	const segments = [
		fg("accent", task.name),
		fg(STATUS_ROLES[task.status], task.status),
		fg("dim", task.model),
		fg("muted", task.tokens > 0 ? fmtTokens(task.tokens) : "0"),
		fg("muted", elapsed),
	];
	return segments.join(fg("dim", " · "));
}

/** The thread as lines: thinking dimmed, text plain, tool calls
 * `⚙ toolName status`, info muted. Long text wraps to `width`. */
export function threadLines(task: AgentTask, width: number, fg: ViewFg): string[] {
	const lines: string[] = [];
	for (const item of task.thread) {
		lines.push(...threadItemLines(item, width, fg));
	}
	return lines;
}

function threadItemLines(item: ThreadItem, width: number, fg: ViewFg): string[] {
	const wrap = (text: string): string[] =>
		text.split("\n").flatMap((part) => (part === "" ? [""] : wrapTextWithAnsi(part, Math.max(1, width))));
	switch (item.kind) {
		case "thinking":
			return wrap(item.text).map((line) => fg("dim", line));
		case "text":
			return wrap(item.text).map((line) => fg("text", line));
		case "info":
			return wrap(item.text).map((line) => fg("muted", line));
		case "tool": {
			const status = item.toolStatus ?? "done";
			return [fg("accent", `⚙ ${item.toolName ?? "tool"}`) + " " + fg(TOOL_STATUS_ROLES[status], status)];
		}
		default:
			return [];
	}
}

// --- Key reducer --------------------------------------------------------------

export type OverlayAction = "up" | "down" | "scrollUp" | "scrollDown" | "follow" | "open" | "back" | "close";

export interface OverlayState {
	selectedId: string | undefined;
	/** Thread scroll offset from the top; effective only when follow is off. */
	scroll: number;
	/** Auto-scroll the thread to the newest lines while the task runs. */
	follow: boolean;
	/** Narrow mode only: the selected task's thread replaces the list. */
	detail: boolean;
	closed: boolean;
}

export function initialOverlayState(ids: readonly string[]): OverlayState {
	return { selectedId: ids[0], scroll: 0, follow: true, detail: false, closed: false };
}

/** Pure key handling: selection clamps at the list ends, scroll clamps at the
 * top, follow toggles, back leaves a narrow detail view before closing, and
 * closing never touches the children. */
export function reduceOverlay(state: OverlayState, action: OverlayAction, ids: readonly string[]): OverlayState {
	switch (action) {
		case "up":
		case "down": {
			if (ids.length === 0) return state;
			const index = ids.indexOf(state.selectedId ?? "");
			const next = action === "up" ? Math.max(0, index - 1) : Math.min(ids.length - 1, index + 1);
			return { ...state, selectedId: ids[Math.max(0, next)], scroll: state.scroll };
		}
		case "scrollUp":
			return { ...state, scroll: Math.max(0, state.scroll - 1) };
		case "scrollDown":
			return { ...state, scroll: state.scroll + 1 };
		case "follow":
			return { ...state, follow: !state.follow };
		case "open":
			return { ...state, detail: true };
		case "back":
			return state.detail ? { ...state, detail: false } : { ...state, closed: true };
		case "close":
			return { ...state, closed: true };
		default:
			return state;
	}
}

// --- Frame --------------------------------------------------------------------

/** The bottom hint row for the current view. */
export function hintLine(mode: "split" | "narrow", fg: ViewFg): string {
	const keys = mode === "split"
		? "j/k task  ctrl+j/k scroll  f follow  esc back  q close"
		: "j/k select  enter thread  esc back  q close";
	return fg("dim", keys);
}

export interface OverlayFrameOptions {
	state: OverlayState;
	layout: OverlayLayout;
	now: number;
}

/** The full overlay frame, padded to the exact height and width. In split mode
 * the body is `list  thread`; in narrow mode the list alone (or the thread when
 * `state.detail`). The effective scroll pins to the bottom while follow is on. */
export function renderOverlay(tasks: readonly AgentTask[], state: OverlayState, layout: OverlayLayout, now: number, fg: ViewFg): string[] {
	const ordered = overlayTasks(tasks);
	const selected = ordered.find((task) => task.id === state.selectedId) ?? ordered[0];

	const list = listLines(ordered, { width: layout.listWidth, selectedId: selected?.id }, fg);
	let body: string[];
	if (layout.mode === "narrow" && state.detail && selected) {
		const header = threadHeader(selected, now, fg);
		const lines = [header, ...threadLines(selected, layout.width, fg)];
		const maxScroll = Math.max(0, lines.length - layout.bodyRows + 1);
		const scroll = state.follow ? maxScroll : Math.min(state.scroll, maxScroll);
		const window = lines.slice(scroll, scroll + Math.max(1, layout.bodyRows - 1));
		body = window.map((line) => line);
	} else if (layout.mode === "split" && selected) {
		const header = threadHeader(selected, now, fg);
		const lines = [header, ...threadLines(selected, layout.threadWidth, fg)];
		const threadBodyRows = Math.max(1, layout.bodyRows - 1);
		const maxScroll = Math.max(0, lines.length - threadBodyRows);
		const scroll = state.follow ? maxScroll : Math.min(state.scroll, maxScroll);
		const thread = lines.slice(scroll, scroll + threadBodyRows);
		const listBody = list.slice(1);
		body = [];
		for (let row = 0; row < layout.bodyRows; row++) {
			const left = listBody[row] ?? "";
			const leftPadded = left + " ".repeat(Math.max(0, layout.listWidth - visibleWidth(left)));
			const right = thread[row] ?? "";
			const gap = " ".repeat(Math.max(0, layout.threadWidth - visibleWidth(right)));
			body.push(truncateToWidth(leftPadded + "  " + right + gap, layout.width));
		}
	} else {
		const listBody = list.slice(1);
		body = [];
		for (let row = 0; row < layout.bodyRows; row++) {
			const left = listBody[row] ?? "";
			body.push(truncateToWidth(left + " ".repeat(Math.max(0, layout.listWidth - visibleWidth(left))), layout.width));
		}
	}

	const header = layout.mode === "narrow" && state.detail && selected ? "" : list[0] ?? "";
	const top = header === "" ? "" : header + " ".repeat(Math.max(0, layout.width - visibleWidth(header)));
	const hint = hintLine(layout.mode, fg);
	const hintPadded = hint + " ".repeat(Math.max(0, layout.width - visibleWidth(hint)));
	return [top, ...body.slice(0, Math.max(1, layout.bodyRows)), hintPadded].map((line) =>
		truncateToWidth(line, layout.width),
	);
}
