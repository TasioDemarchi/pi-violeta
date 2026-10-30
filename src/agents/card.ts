/** Agents card (above the editor), pure rendering: given the store's tasks it
 * decides which rows are visible, how the fixed right-aligned metadata columns
 * are sized, and how the card degrades when the terminal is narrow. The
 * extension only feeds data and a theme-like `fg` function. */

import { visibleWidth } from "@earendil-works/pi-tui";
import { fmtCost, fmtTokens } from "../format.ts";
import { agents as t } from "../i18n.ts";
import { displayTitle } from "./summary.ts";
import { isFinished, type AgentTask, type TaskStatus } from "./store.ts";

export type CardFg = (role: string, text: string) => string;

export const FINISHED_TTL_MS = 60_000;
export const CARD_MAX_FINISHED = 3;
export const CARD_VIEW_KEY = "alt+a";

const GLYPHS: Record<TaskStatus, { glyph: string; role: string }> = {
	queued: { glyph: "◌", role: "muted" },
	running: { glyph: "◐", role: "accent" },
	completed: { glyph: "✓", role: "success" },
	failed: { glyph: "✗", role: "error" },
	aborted: { glyph: "⊘", role: "warning" },
};

const NAME_MAX = 20;
const TITLE_MIN = 8;
// model·effort is a luxury column: it also yields when keeping it would
// squeeze the title below this width.
const EXEC_TITLE_MIN = 20;
const SEP = " · ";
const ELLIPSIS = "…";

/** `25s`, `1m24s`, `1h02m`. */
export function formatElapsed(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * The rows the card shows: every active task in start order, then the finished
 * ones that ended within the last minute (newest first), at most three.
 */
export function cardTasks(tasks: readonly AgentTask[], now: number): AgentTask[] {
	const active = tasks.filter((task) => !isFinished(task.status));
	const finished = tasks
		.filter((task) => isFinished(task.status) && task.endedAt !== undefined && now - task.endedAt < FINISHED_TTL_MS)
		.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
		.slice(0, CARD_MAX_FINISHED);
	return [...active, ...finished];
}

/** A quarter of the terminal rows, never fewer than three nor more than eight. */
export function cardMaxRows(terminalRows: number | undefined): number {
	if (terminalRows === undefined) return 8;
	return Math.max(3, Math.min(8, Math.floor(terminalRows / 4)));
}

function clip(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	let out = "";
	for (const char of text) {
		if (visibleWidth(out + char) > width - 1) break;
		out += char;
	}
	return `${out}${ELLIPSIS}`;
}

interface Fields {
	role: string;
	exec: string;
	tokens: string;
	cost: string;
	elapsed: string;
}

function metaFields(task: AgentTask, now: number): Fields {
	if (task.status === "queued") return { role: task.name, exec: "", tokens: "", cost: "", elapsed: t.queued };
	const end = task.endedAt ?? now;
	return {
		role: task.name,
		exec: `${task.model} · ${task.effort}`,
		tokens: task.tokens > 0 ? fmtTokens(task.tokens) : "",
		cost: task.cost > 0 ? fmtCost(task.cost) : "",
		elapsed: formatElapsed(end - task.startedAt),
	};
}

const EMPTY_FIELDS: Fields = { role: "", exec: "", tokens: "", cost: "", elapsed: "" };

function columnWidths(tasks: readonly AgentTask[], now: number): Fields {
	const widths = { ...EMPTY_FIELDS };
	for (const task of tasks) {
		const fields = metaFields(task, now);
		for (const key of ["role", "exec", "tokens", "cost", "elapsed"] as const) {
			widths[key] = Math.max(widths[key], visibleWidth(fields[key]));
		}
	}
	// The role column never grows past NAME_MAX; longer names clip.
	widths.role = Math.min(widths.role, NAME_MAX);
	return widths;
}

/** Total width of the metadata area: the surviving columns plus separators. */
function metaTotal(widths: Fields): number {
	const live = (["role", "exec", "tokens", "cost", "elapsed"] as const).filter((key) => widths[key] > 0);
	return live.reduce((sum, key) => sum + widths[key], 0) + Math.max(0, live.length - 1) * visibleWidth(SEP);
}

function metaText(task: AgentTask, now: number, widths: Fields): string {
	const fields = metaFields(task, now);
	const parts: string[] = [];
	for (const key of ["role", "exec", "tokens", "cost", "elapsed"] as const) {
		if (widths[key] <= 0) continue;
		// The role is left-aligned in its column; the counters right-align.
		parts.push(key === "role" ? clip(fields.role, widths.role).padEnd(widths.role) : fields[key].padStart(widths[key]));
	}
	return parts.join(SEP);
}

interface CardLayout {
	title: number;
	columnar: boolean;
	widths: Fields;
}

// Narrow cards degrade one column at a time, the same way for every row: the
// role (agent name) goes first, then the model·effort label, then tokens, then
// cost. The title is primary and never drops: it only truncates with `…` last,
// and elapsed is the last non-title column standing.
function cardLayout(tasks: readonly AgentTask[], inner: number, now: number): CardLayout {
	const base = 1 + 2 + 2; // glyph + gap after the glyph + gap before the meta block
	let widths = columnWidths(tasks, now);
	const fits = (fields: Fields) => base + metaTotal(fields) + TITLE_MIN <= inner;
	if (!fits(widths)) {
		for (const drop of ["role", "exec", "tokens", "cost"] as const) {
			widths = { ...widths, [drop]: "" };
			if (fits(widths)) break;
		}
	} else if (widths.exec > 0 && base + metaTotal(widths) + EXEC_TITLE_MIN > inner) {
		widths = { ...widths, exec: "" };
	}
	const title = inner - base - metaTotal(widths);
	if (title >= 1) return { title, columnar: true, widths };
	return { title: Math.max(1, inner - 3), columnar: false, widths: EMPTY_FIELDS };
}

function cardCounts(tasks: readonly AgentTask[]): string {
	const active = tasks.filter((t) => t.status === "queued" || t.status === "running").length;
	const done = tasks.filter((t) => t.status === "completed").length;
	const failed = tasks.filter((t) => t.status === "failed" || t.status === "aborted").length;
	return t.cardTitle(active, done, failed);
}

/** The batch clock: first start among the shown tasks until now, or until the
 * last one ended when nothing is running. */
function batchElapsed(tasks: readonly AgentTask[], now: number): string {
	const start = Math.min(...tasks.map((task) => task.startedAt));
	const active = tasks.some((task) => !isFinished(task.status));
	const end = active ? now : Math.max(...tasks.map((task) => task.endedAt ?? now));
	return formatElapsed(end - start);
}

/** Rows that survive the row budget; active work keeps its row first. */
function visibleRows(shown: readonly AgentTask[], bodyRows: number): { listed: AgentTask[]; hidden: number } {
	if (shown.length <= bodyRows) return { listed: [...shown], hidden: 0 };
	if (bodyRows <= 1) return { listed: [], hidden: shown.length };
	const keep = bodyRows - 1;
	const priority = (task: AgentTask) => (isFinished(task.status) ? 1 : 0);
	const order = shown.map((task, index) => ({ task, index }));
	const listed = order
		.slice()
		.sort((a, b) => priority(a.task) - priority(b.task) || a.index - b.index)
		.slice(0, keep)
		.sort((a, b) => a.index - b.index)
		.map((entry) => entry.task);
	return { listed, hidden: shown.length - listed.length };
}

export interface CardOptions {
	width: number;
	/** Terminal rows; the card spends at most a quarter of them (3..8). */
	rows?: number;
	now: number;
	/** Hint shown on the fold line; defaults to `alt+a`. */
	viewKey?: string;
}

/** The full card, frame included, padded to the exact width. Empty when there
 * is nothing to show. */
export function renderAgentsCard(tasks: readonly AgentTask[], opts: CardOptions, fg: CardFg): string[] {
	const shown = cardTasks(tasks, opts.now);
	if (shown.length === 0) return [];
	const width = Math.max(8, opts.width);
	const inner = width - 4;
	const layout = cardLayout(shown, inner, opts.now);
	const { listed, hidden } = visibleRows(shown, cardMaxRows(opts.rows) - 2);

	// Header: title left, batch elapsed right-aligned.
	const title = cardCounts(shown);
	let top: string;
	const elapsed = batchElapsed(shown, opts.now);
	const dash = width - 8 - visibleWidth(title) - visibleWidth(elapsed);
	if (dash >= 1) {
		top = fg("borderAccent", "╭─ ") + fg("accent", title) + " " + fg("borderAccent", "─".repeat(dash) + " " + elapsed + " ─╮");
	} else {
		const clipped = clip(title, Math.max(1, width - 7));
		const fill = Math.max(1, width - 6 - visibleWidth(clipped));
		top = fg("borderAccent", "╭─ ") + fg("accent", clipped) + " " + fg("borderAccent", "─".repeat(fill) + "╮");
	}

	const body = listed.map((task) => {
		const look = GLYPHS[task.status];
		const text = clip(displayTitle(task), layout.title);
		const head = fg(look.role, look.glyph) + "  " + fg("text", text) + " ".repeat(Math.max(0, layout.title - visibleWidth(text)));
		let content: string;
		if (!layout.columnar) {
			content = head;
		} else {
			content = head + "  " + fg("dim", metaText(task, opts.now, layout.widths));
		}
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(content)));
		return fg("borderAccent", "│ ") + content + pad + fg("borderAccent", " │");
	});

	if (hidden > 0) {
		const hint = t.fold(hidden, opts.viewKey ?? CARD_VIEW_KEY);
		const pad = " ".repeat(Math.max(0, inner - visibleWidth(hint)));
		body.push(fg("borderAccent", "│ ") + fg("dim", hint) + pad + fg("borderAccent", " │"));
	}

	const bottom = fg("borderAccent", "╰" + "─".repeat(width - 2) + "╯");
	return [top, ...body, bottom];
}
