/** Todo card (above the editor), pure rendering in the same visual language as
 * the agents card: rounded frame, theme roles, exact width. The extension only
 * feeds the state, the width, the clock and a theme-like `fg` function. */

import { visibleWidth } from "@earendil-works/pi-tui";
import { todo as t } from "../i18n.ts";
import { doneCount, openCount, type TodoState, type TodoStatus, type TodoTask } from "./store.ts";

export type CardFg = (role: string, text: string) => string;

/** How long a fully done/dropped list stays visible before the card hides itself. */
export const TODO_HIDE_MS = 60_000;
/** Task rows shown before the rest folds into `… N more`. */
export const CARD_MAX_ROWS = 8;

/** Where the todo card lives: a `TAREAS` section inside the sidebar when the
 * sidebar is active, otherwise the widget above the editor (T1/S2). */
export type TodoPlacement = "sidebar" | "widget";

/** Pure placement decision: the sidebar active flag decides the placement. */
export function todoPlacement(sidebarActive: boolean): TodoPlacement {
	return sidebarActive ? "sidebar" : "widget";
}

const GLYPHS: Record<TodoStatus, { glyph: string; role: string }> = {
	pending: { glyph: "○", role: "muted" },
	in_progress: { glyph: "◐", role: "accent" },
	blocked: { glyph: "⏸", role: "warning" },
	done: { glyph: "✓", role: "success" },
	dropped: { glyph: "⊘", role: "muted" },
};

/** The card is visible while work is open, and for one minute after the last
 * task settles. An empty list is always hidden. */
export function cardVisible(state: TodoState, now: number): boolean {
	if (state.tasks.length === 0) return false;
	if (state.settledAt === undefined) return true;
	return now - state.settledAt < TODO_HIDE_MS;
}

/** Task rows after folding: the first N tasks plus a `… N more` fold line. */
export function cardRows(tasks: readonly { title: string }[], maxRows: number): { listed: number; hidden: number } {
	if (tasks.length <= maxRows) return { listed: tasks.length, hidden: 0 };
	return { listed: maxRows, hidden: tasks.length - maxRows };
}

/** ANSI-safe truncation (pi-tui's truncateToWidth mangles styled text); same
 * approach as the agents card: cut at the last character that fits. */
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

/** One row's content, role-applied and clipped to `inner` columns: glyph,
 * title and (for blocked rows) the note. Shared by the framed card and the
 * sidebar section so the two placements cannot drift. */
function taskRowContent(task: TodoTask, inner: number, fg: CardFg): string {
	const look = GLYPHS[task.status];
	const finished = task.status === "done" || task.status === "dropped";
	const note = task.status === "blocked" && task.note ? fg("dim", `  · ${task.note}`) : "";
	return clip(fg(look.role, look.glyph) + "  " + fg(finished ? "dim" : "text", task.title) + note, inner);
}

export interface CardOptions {
	width: number;
	now: number;
	/** Task rows before folding; defaults to SIDEBAR_MAX_TASK_ROWS. */
	maxRows?: number;
}

/** The full card, frame included, padded to the exact width. Empty when the
 * list is empty or the hide window has passed. */
export function renderTodoCard(state: TodoState, opts: CardOptions, fg: CardFg): string[] {
	if (!cardVisible(state, opts.now)) return [];
	const width = Math.max(8, opts.width);
	const inner = width - 4;
	const maxRows = Math.max(1, opts.maxRows ?? CARD_MAX_ROWS);

	const title = t.cardTitle(openCount(state.tasks), doneCount(state.tasks));
	const fill = Math.max(1, width - 5 - visibleWidth(title));
	const top = fg("borderAccent", "╭─ ") + fg("accent", clip(title, Math.max(1, width - 6))) + " " + fg("borderAccent", "─".repeat(fill) + "╮");

	const { listed, hidden } = cardRows(state.tasks, maxRows);
	const body = state.tasks.slice(0, listed).map((task) => {
		const content = taskRowContent(task, inner, fg);
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(content)));
		return fg("borderAccent", "│ ") + content + pad + fg("borderAccent", " │");
	});
	if (hidden > 0) {
		const hint = t.fold(hidden);
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(hint)));
		body.push(fg("borderAccent", "│ ") + fg("dim", hint) + pad + fg("borderAccent", " │"));
	}

	const bottom = fg("borderAccent", "╰" + "─".repeat(width - 2) + "╯");
	return [top, ...body, bottom];
}

export interface SectionOptions {
	/** The width the row content must fit (the sidebar's content width). */
	width: number;
	now: number;
	/** Task rows before folding; defaults to 8. */
	maxRows?: number;
}

/** Task rows the sidebar section shows before folding. The section is tighter
 * than the card above the editor: it shares the screen with CAMBIOS/MODELO. */
export const SIDEBAR_MAX_TASK_ROWS = 5;

/** The sidebar `TAREAS` section rows, content only (no frame): one line per
 * shown task plus a bare `…` fold line (no count: the sidebar is compact and
 * the count is one `/todo` away), clipped to `opts.width` columns. Empty when
 * the list is empty or the hide window has passed — the same visibility rules
 * as the framed card. */
export function todoSectionRows(state: TodoState, opts: SectionOptions, fg: CardFg): string[] {
	if (!cardVisible(state, opts.now)) return [];
	const width = Math.max(8, opts.width);
	const maxRows = Math.max(1, opts.maxRows ?? SIDEBAR_MAX_TASK_ROWS);
	const { listed, hidden } = cardRows(state.tasks, maxRows);
	const rows = state.tasks.slice(0, listed).map((task) => taskRowContent(task, width, fg));
	if (hidden > 0) rows.push(fg("dim", t.ellipsis));
	return rows;
}
