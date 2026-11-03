/**
 * btw panel — the side chat's framed window, pure rendering.
 *
 * One function draws both placements, so the sidebar and the above-editor box
 * can never drift: the frame marks it as a separate window (the point of the
 * feature — it must not read as part of the conversation), and `rows` is the
 * only difference. With `rows` the panel fills exactly that height, which is
 * what the sidebar column needs; without it the panel is as tall as its
 * content, up to `maxRows`, which is what a widget above the editor needs.
 *
 * The panel always shows the END of the conversation: an aside is read for its
 * last answer, not its first.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { btw as t } from "../i18n.ts";
import type { BtwRole, BtwState } from "./state.ts";

export type Fg = (role: string, text: string) => string;

/** Content rows the above-editor box shows before it starts dropping the oldest. */
export const BTW_MAX_WIDGET_ROWS = 14;

/** Theme role per turn: the question in accent (it is yours), the answer in
 * text, a failure in error. */
const ROLES: Record<BtwRole, string> = { user: "accent", assistant: "text", error: "error" };

/** Wrap plain text to `width` columns, breaking on spaces and hard-breaking a
 * word longer than the line. Blank lines in the text are kept: they are how a
 * model separates paragraphs. Wrapping happens before any color is applied, so
 * no escape sequence is ever cut in half. */
export function wrapText(text: string, width: number): string[] {
	const limit = Math.max(1, width);
	const out: string[] = [];
	for (const paragraph of text.replace(/\r/g, "").split("\n")) {
		if (paragraph.trim() === "") {
			out.push("");
			continue;
		}
		let line = "";
		for (const word of paragraph.split(/ +/)) {
			let rest = word;
			// A word that cannot fit on its own line is cut, not left to overflow.
			while (rest.length > limit) {
				if (line !== "") {
					out.push(line);
					line = "";
				}
				out.push(rest.slice(0, limit));
				rest = rest.slice(limit);
			}
			if (rest === "") continue;
			if (line === "") line = rest;
			else if (line.length + 1 + rest.length <= limit) line += ` ${rest}`;
			else {
				out.push(line);
				line = rest;
			}
		}
		if (line !== "") out.push(line);
	}
	return out.length > 0 ? out : [""];
}

export interface PanelOptions {
	width: number;
	/** Exact total height, frame included (the sidebar column). */
	rows?: number;
	/** Content rows before the oldest are dropped, when `rows` is absent. */
	maxRows?: number;
}

/** The conversation as plain content rows, newest last: the question prefixed
 * `› `, the answer as it came, a failure in its own color. */
function contentRows(state: BtwState, inner: number): Array<{ role: BtwRole | "hint"; text: string }> {
	const rows: Array<{ role: BtwRole | "hint"; text: string }> = [];
	for (const turn of state.turns) {
		if (rows.length > 0) rows.push({ role: "hint", text: "" });
		const prefix = turn.role === "user" ? "› " : "";
		const lines = wrapText(turn.text, Math.max(1, inner - prefix.length));
		for (const [index, line] of lines.entries()) {
			rows.push({ role: turn.role, text: (index === 0 ? prefix : prefix === "" ? "" : "  ") + line });
		}
	}
	if (state.asking) {
		if (rows.length > 0) rows.push({ role: "hint", text: "" });
		rows.push({ role: "hint", text: t.thinking });
	}
	if (rows.length === 0) for (const line of wrapText(t.empty, inner)) rows.push({ role: "hint", text: line });
	return rows;
}

/** The whole panel, frame included, every line padded to exactly `width`. */
export function renderBtwPanel(state: BtwState, opts: PanelOptions, fg: Fg): string[] {
	const width = Math.max(12, opts.width);
	const inner = width - 4;

	const title = t.title;
	const fill = Math.max(1, width - 5 - visibleWidth(title));
	const top =
		fg("borderAccent", "╭─ ") +
		fg("accent", truncateToWidth(title, Math.max(1, width - 6))) +
		" " +
		fg("borderAccent", "─".repeat(fill) + "╮");
	const bottom = fg("borderAccent", "╰" + "─".repeat(width - 2) + "╯");

	// The frame costs two rows; what is left is the conversation's window.
	const budget = opts.rows !== undefined ? Math.max(1, opts.rows - 2) : Math.max(1, opts.maxRows ?? BTW_MAX_WIDGET_ROWS);
	const rows = contentRows(state, inner);
	const shown = rows.slice(Math.max(0, rows.length - budget));
	const body = shown.map((row) => {
		const text = truncateToWidth(row.text, inner);
		const painted = text === "" ? "" : fg(row.role === "hint" ? "dim" : ROLES[row.role], text);
		return fg("borderAccent", "│ ") + painted + " ".repeat(Math.max(0, inner - visibleWidth(painted))) + fg("borderAccent", " │");
	});
	// The sidebar column asks for an exact height: fill it, or the panel would
	// leave the rest of the column to whatever was drawn there before.
	if (opts.rows !== undefined) {
		const blank = fg("borderAccent", "│ ") + " ".repeat(inner) + fg("borderAccent", " │");
		while (body.length < budget) body.push(blank);
	}
	return [top, ...body, bottom];
}
