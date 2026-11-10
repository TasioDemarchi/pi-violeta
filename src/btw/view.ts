/**
 * btw overlay view — the side chat's scrollable reader, pure logic.
 *
 * The panel (`panel.ts`) is the glance: it always shows the END of the
 * conversation and silently drops what does not fit, because it lives in a
 * widget or a sidebar column, and neither of those has the keyboard focus —
 * there is nowhere to press a key. This view is the answer to a long reply: an
 * overlay DOES take focus, so it can scroll.
 *
 * It reuses `btwContentRows`, the same function the panel uses to turn a
 * conversation into lines. One way to lay out a turn, two places that draw it.
 *
 * It opens at the bottom, where the panel left off: `Number.MAX_SAFE_INTEGER`
 * is clamped to the last page at render time, so the first thing you see is the
 * newest answer and `k` walks back from there.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { btw as t } from "../i18n.ts";
import { btwContentRows, btwRowColor, type BtwRow } from "./panel.ts";
import type { BtwState } from "./state.ts";

export type Fg = (role: string, text: string) => string;

// --- Key reducer -------------------------------------------------------------

export type BtwViewAction = "up" | "down" | "pageUp" | "pageDown" | "top" | "bottom" | "close";

export interface BtwViewState {
	/** Rows scrolled past the top. Clamped at render, never here: the reducer
	 * does not know how tall the terminal is or how many rows the text wraps to. */
	scroll: number;
	closed: boolean;
}

/** Open at the bottom: an aside is read for its last answer, like the panel. */
export function initialBtwView(): BtwViewState {
	return { scroll: Number.MAX_SAFE_INTEGER, closed: false };
}

/** Pure key handling. `page` is the body height, so a page jump matches what
 * the terminal is actually showing. */
export function reduceBtwView(state: BtwViewState, action: BtwViewAction, page: number): BtwViewState {
	const step = Math.max(1, page);
	switch (action) {
		case "up":
			return { ...state, scroll: Math.max(0, state.scroll - 1) };
		case "down":
			return { ...state, scroll: state.scroll + 1 };
		case "pageUp":
			return { ...state, scroll: Math.max(0, state.scroll - step) };
		case "pageDown":
			return { ...state, scroll: state.scroll + step };
		case "top":
			return { ...state, scroll: 0 };
		case "bottom":
			return { ...state, scroll: Number.MAX_SAFE_INTEGER };
		case "close":
			return { ...state, closed: true };
		default:
			return state;
	}
}

// --- Layout ------------------------------------------------------------------

export interface BtwViewLayout {
	width: number;
	/** Content rows between the header and the hint. */
	bodyRows: number;
}

/** One header row and one hint row frame the body, as in the changes overlay. */
export function btwViewLayout(width: number, height: number): BtwViewLayout {
	return { width: Math.max(12, width), bodyRows: Math.max(1, height - 2) };
}

/** Rows scrolled past, clamped so the last page is the furthest you can go. */
export function clampScroll(scroll: number, total: number, bodyRows: number): number {
	return Math.max(0, Math.min(scroll, Math.max(0, total - bodyRows)));
}

// --- Frame -------------------------------------------------------------------

/** `12-31/84`, or nothing at all when everything fits: a position you only
 * need when there is something off screen. */
function position(start: number, shown: number, total: number): string {
	if (total === 0 || shown >= total) return "";
	return t.viewPosition(start + 1, start + shown, total);
}

/** The whole overlay: header, the scrolled window of content, hint. Every line
 * is padded to exactly `layout.width`, so nothing drawn before shows through. */
export function renderBtwView(state: BtwViewState, rows: readonly BtwRow[], layout: BtwViewLayout, fg: Fg): string[] {
	const scroll = clampScroll(state.scroll, rows.length, layout.bodyRows);
	const window = rows.slice(scroll, scroll + layout.bodyRows);

	const where = position(scroll, window.length, rows.length);
	const title = fg("accent", t.title);
	const header = where === "" ? title : `${title}  ${fg("dim", where)}`;

	const body: string[] = [];
	for (let row = 0; row < layout.bodyRows; row++) {
		const line = window[row];
		if (line === undefined || line.text === "") {
			body.push("");
			continue;
		}
		body.push(fg(btwRowColor(line.role), truncateToWidth(line.text, layout.width)));
	}

	const lines = [header, ...body, fg("dim", t.viewHint)];
	return lines.map((line) => {
		// Measure what is actually drawn: truncateToWidth may stop short of the
		// limit on a wide-character boundary, and it appends a reset sequence.
		const clipped = truncateToWidth(line, layout.width);
		return clipped + " ".repeat(Math.max(0, layout.width - visibleWidth(clipped)));
	});
}

/** The conversation as rows for this width: the overlay has no frame of its
 * own, so the text may use the whole width. */
export function btwViewRows(state: BtwState, width: number): BtwRow[] {
	return btwContentRows(state, Math.max(1, width));
}
