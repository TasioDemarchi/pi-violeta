import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { contextRole } from "./context-warning.ts";
import { fmtCost, fmtPercent, fmtTokens } from "./format.ts";
import { sidebar as t } from "./i18n.ts";
import { todoSectionRows } from "./todo/card.ts";
import type { TodoState } from "./todo/store.ts";

export type Fg = (role: string, text: string) => string;

export interface SidebarData {
	project: { name: string; path: string; branch?: string | null };
	/** null when the directory is not inside a git repository */
	changes: { created: string[]; updated: string[]; deleted: string[] } | null;
	/** The current todo list; the TAREAS section renders between CAMBIOS and MODELO (T1/S2). */
	todos?: TodoState | null;
	/** Clock for the todo hide rules; defaults to Date.now(). */
	now?: number;
	model: {
		id?: string;
		thinking?: string;
		/** percent is 0..100 or null when usage is unknown */
		context?: { percent: number | null; used: number; window: number } | null;
	};
	usage: { tokensIn: number; tokensOut: number; cost: number };
}

/** File rows under CAMBIOS: 8 rows total — 7 names plus a dim `…` when more
 * than 8 files exist; all of them (no ellipsis) when there are 8 or fewer. */
export const SIDEBAR_MAX_FILES = 8;
const BAR_SLOTS = 10;

/** A 10-slot usage bar; unknown usage renders an empty bar. */
export function contextBar(percent: number | null): string {
	const filled = percent == null ? 0 : Math.round(Math.min(1, Math.max(0, percent / 100)) * BAR_SLOTS);
	return "█".repeat(filled) + "░".repeat(BAR_SLOTS - filled);
}

/**
 * Build the full sidebar: every line is prefixed with the borderAccent divider,
 * padded to `width`, and the output is padded to `rows` so the divider spans
 * the whole terminal height.
 */
export function buildSidebarLines(
	data: SidebarData,
	opts: { width: number; rows: number; maxFiles?: number; maxTodoRows?: number },
	fg: Fg,
): string[] {
	const width = Math.max(3, opts.width);
	const contentWidth = width - 2;
	const rows = Math.max(1, opts.rows);
	const out: string[] = [];
	const push = (...segments: string[]) => {
		const fitted = truncateToWidth(segments.join(""), contentWidth);
		out.push(fg("borderAccent", "│") + " " + fitted + " ".repeat(Math.max(0, contentWidth - visibleWidth(fitted))));
	};

	// PROYECTO
	push(fg("accent", t.project));
	push(fg("text", data.project.name));
	push(fg("dim", data.project.path));
	if (data.project.branch) push(fg("muted", data.project.branch));

	// CAMBIOS
	push("");
	push(fg("accent", t.changes));
	if (data.changes === null) {
		push(fg("dim", t.noRepo));
	} else {
		const { created, updated, deleted } = data.changes;
		if (!created.length && !updated.length && !deleted.length) {
			push(fg("dim", t.clean));
		} else {
			if (created.length) push(fg("success", t.created(created.length)));
			if (updated.length) push(fg("warning", t.updated(updated.length)));
			if (deleted.length) push(fg("error", t.deleted(deleted.length)));
			const max = Math.max(1, opts.maxFiles ?? SIDEBAR_MAX_FILES);
			const files: Array<[marker: "+" | "~" | "−", name: string]> = [
				...created.map((f) => ["+", f] as const),
				...updated.map((f) => ["~", f] as const),
				...deleted.map((f) => ["−", f] as const),
			];
			const overflow = files.length > max;
			for (const [marker, name] of files.slice(0, overflow ? max - 1 : max)) {
				push(fg(marker === "+" ? "success" : marker === "~" ? "warning" : "error", `${marker} ${name}`));
			}
			if (overflow) push(fg("dim", t.ellipsis));
		}
	}

	// TAREAS — the todo list as a section inside the sidebar (T1/S2); the same
	// row, fold and hide rules as the above-editor card (shared helpers in
	// src/todo/card.ts). Hidden entirely when there is nothing to show.
	const todoRows = data.todos
		? todoSectionRows(data.todos, { width: contentWidth, now: data.now ?? Date.now(), maxRows: opts.maxTodoRows }, fg)
		: [];
	if (todoRows.length > 0) {
		push("");
		push(fg("accent", t.tasks));
		for (const line of todoRows) push(line);
	}

	// MODELO
	push("");
	push(fg("accent", t.model));
	push(data.model.id ? fg("text", data.model.id) : fg("dim", t.noModel));
	if (data.model.thinking) push(fg("muted", `thinking ${data.model.thinking}`));
	const ctx = data.model.context;
	if (ctx) {
		const pct = ctx.percent == null ? "?" : fmtPercent(ctx.percent / 100);
		// The S5 thresholds: muted below 70%, warning at 70-89%, error at 90%+.
		push(
			fg(contextRole(ctx.percent), `ctx ${pct} `) +
				fg("accent", contextBar(ctx.percent)) +
				" " +
				fg("dim", `${fmtTokens(ctx.used)}/${fmtTokens(ctx.window)}`),
		);
	}

	// USO
	push("");
	push(fg("accent", t.usage));
	push(fg("dim", `↑${fmtTokens(data.usage.tokensIn)} ↓${fmtTokens(data.usage.tokensOut)}`));
	push(fg("muted", fmtCost(data.usage.cost)));

	while (out.length < rows) push("");
	return out.slice(0, rows);
}
