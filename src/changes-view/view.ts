/** Changes view (/changes · alt+g), pure rendering and key handling: the split
 * list/diff layout, the grouped list line builders, and a key reducer the
 * extension feeds raw input into. No Pi API here — the extension only wires
 * data (status files + the lazily loaded diff), a theme-like `fg` function and
 * terminal size, following the same structure as src/agents/view.ts. */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { changes as t } from "../i18n.ts";
import type { ChangeFiles } from "../changes.ts";
import { colorDiffLine, diffHeader, type DiffData } from "./diff.ts";

export type ViewFg = (role: string, text: string) => string;

export type ChangeGroup = "created" | "updated" | "deleted";

export interface ChangeEntry {
	group: ChangeGroup;
	path: string;
}

export const SPLIT_MIN_COLS = 60;
export const GROUPS: readonly ChangeGroup[] = ["created", "updated", "deleted"];

export const GROUP_GLYPH: Record<ChangeGroup, { glyph: string; role: string }> = {
	created: { glyph: "+", role: "success" },
	updated: { glyph: "~", role: "warning" },
	deleted: { glyph: "−", role: "error" },
};

/** Created, then updated, then deleted — the sidebar CAMBIOS order. */
export function changeEntries(files: ChangeFiles): ChangeEntry[] {
	return [
		...files.created.map((path) => ({ group: "created" as const, path })),
		...files.updated.map((path) => ({ group: "updated" as const, path })),
		...files.deleted.map((path) => ({ group: "deleted" as const, path })),
	];
}

/** Selection key: the same path can appear in one group only, but the group
 * disambiguates anyway. */
export function entryKey(entry: ChangeEntry): string {
	return `${entry.group}:${entry.path}`;
}

// --- Layout -----------------------------------------------------------------

export interface OverlayLayout {
	mode: "split" | "narrow";
	width: number;
	bodyRows: number;
	listWidth: number;
	diffWidth: number;
}

const LIST_MAX_WIDTH = 34;
const LIST_MIN_WIDTH = 22;
const LIST_RATIO = 0.32;

/** At `SPLIT_MIN_COLS`+ the list and the diff sit side by side with a one-cell
 * divider; below that the list fills the width and Enter opens the diff. */
export function overlayLayout(width: number, height: number): OverlayLayout {
	// One header row and one hint row frame the body.
	const bodyRows = Math.max(1, height - 2);
	if (width < SPLIT_MIN_COLS) {
		return { mode: "narrow", width, bodyRows, listWidth: width, diffWidth: width };
	}
	const listWidth = Math.min(LIST_MAX_WIDTH, Math.max(LIST_MIN_WIDTH, Math.floor(width * LIST_RATIO)));
	const diffWidth = Math.max(1, width - listWidth - 1);
	return { mode: "split", width, bodyRows, listWidth, diffWidth };
}

// --- File list ---------------------------------------------------------------

const GROUP_LABEL: Record<ChangeGroup, (n: number) => string> = {
	created: (n) => t.created(n),
	updated: (n) => t.updated(n),
	deleted: (n) => t.deleted(n),
};

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

/** The first list row: `+1 ~1 −1` counts (zero groups skipped), or the dim
 * empty message on a clean tree. The frame truncates the row to width. */
export function countsHeader(entries: readonly ChangeEntry[], _width: number, fg: ViewFg): string {
	if (entries.length === 0) return fg("dim", t.empty);
	const parts: string[] = [];
	for (const group of GROUPS) {
		const count = entries.filter((entry) => entry.group === group).length;
		if (count > 0) {
			const look = GROUP_GLYPH[group];
			parts.push(fg(look.role, `${look.glyph}${count}`));
		}
	}
	return parts.join(" ");
}

/** One line per group header and file: group header `+ N creado` colored with
 * the group role, then rows `› + path` with the selected row marked. */
export function listLines(entries: readonly ChangeEntry[], opts: { width: number; selectedKey?: string }, fg: ViewFg): string[] {
	const lines = [countsHeader(entries, opts.width, fg)];
	for (const group of GROUPS) {
		const groupEntries = entries.filter((entry) => entry.group === group);
		if (groupEntries.length === 0) continue;
		const look = GROUP_GLYPH[group];
		const label = clip(GROUP_LABEL[group](groupEntries.length), Math.max(1, opts.width - 2));
		lines.push(`${fg(look.role, look.glyph)} ${fg("dim", label)}`);
		for (const entry of groupEntries) {
			const selected = entryKey(entry) === opts.selectedKey;
			const marker = selected ? fg("accent", "›") : " ";
			const text = clip(entry.path, Math.max(1, opts.width - 4));
			lines.push(`${marker} ${fg(look.role, look.glyph)} ${selected ? fg("text", text) : fg("muted", text)}`);
		}
	}
	return lines;
}

// --- Key reducer --------------------------------------------------------------

export type OverlayAction =
	| "up"
	| "down"
	| "scrollUp"
	| "scrollDown"
	| "top"
	| "bottom"
	| "open"
	| "openEditor"
	| "back"
	| "close";

export interface OverlayState {
	selectedKey: string | undefined;
	/** Diff scroll offset from the top; clamped at render time. */
	scroll: number;
	/** Narrow mode only: the selected file's diff replaces the list. */
	detail: boolean;
	closed: boolean;
}

export function initialOverlayState(entries: readonly ChangeEntry[]): OverlayState {
	return { selectedKey: entries[0] ? entryKey(entries[0]) : undefined, scroll: 0, detail: false, closed: false };
}

/** Pure key handling: selection clamps at the list ends and resets the diff
 * scroll, scroll clamps at the top (bottom clamps at render), back leaves a
 * narrow detail view before closing, and `openEditor` changes nothing — the
 * extension runs the editor itself. */
export function reduceOverlay(state: OverlayState, action: OverlayAction, keys: readonly string[]): OverlayState {
	switch (action) {
		case "up":
		case "down": {
			if (keys.length === 0) return state;
			const index = keys.indexOf(state.selectedKey ?? "");
			const next = action === "up" ? Math.max(0, index - 1) : Math.min(keys.length - 1, index + 1);
			return { ...state, selectedKey: keys[Math.max(0, next)], scroll: 0 };
		}
		case "scrollUp":
			return { ...state, scroll: Math.max(0, state.scroll - 1) };
		case "scrollDown":
			return { ...state, scroll: state.scroll + 1 };
		case "top":
			return { ...state, scroll: 0 };
		case "bottom":
			return { ...state, scroll: Number.MAX_SAFE_INTEGER };
		case "open":
			return { ...state, detail: true };
		case "openEditor":
			return state;
		case "back":
			return state.detail ? { ...state, detail: false } : { ...state, closed: true };
		case "close":
			return { ...state, closed: true };
		default:
			return state;
	}
}

// --- Frame --------------------------------------------------------------------

function listWindowStart(rows: number, selectedRow: number, bodyRows: number): number {
	if (rows <= bodyRows) return 0;
	const centered = selectedRow - Math.floor(bodyRows / 2);
	return Math.max(0, Math.min(centered, rows - bodyRows));
}

/** The full overlay frame, padded to the exact height and width. In split mode
 * the body is `list │ diff`; in narrow mode the list alone (or the diff when
 * `state.detail`). The diff scroll clamps at both ends. */
export function renderOverlay(
	entries: readonly ChangeEntry[],
	diff: DiffData | undefined,
	state: OverlayState,
	layout: OverlayLayout,
	fg: ViewFg,
): string[] {
	const selected = entries.find((entry) => entryKey(entry) === state.selectedKey) ?? entries[0];
	const list = listLines(entries, { width: layout.listWidth, selectedKey: selected ? entryKey(selected) : undefined }, fg);
	const detail = layout.mode === "narrow" && state.detail;

	let diffBody: string[];
	if (!diff) diffBody = [fg("dim", t.loading)];
	else if (diff.binary) diffBody = [fg("dim", t.binary)];
	else {
		diffBody = diff.lines.map((line) => colorDiffLine(line, fg));
		if (diff.truncated > 0) diffBody.push(fg("dim", t.moreLines(diff.truncated)));
	}

	// Header row: counts header left and diff header right around the divider
	// in split mode; the list counts alone in the narrow list; the diff header
	// alone in the narrow detail.
	let header: string;
	if (detail) {
		header = diff ? diffHeader(diff, layout.width, fg) : fg("dim", t.loading);
	} else if (layout.mode === "split") {
		const left = list[0] ?? "";
		const right = diff ? diffHeader(diff, layout.diffWidth, fg) : fg("dim", t.loading);
		header =
			truncateToWidth(
				left + " ".repeat(Math.max(0, layout.listWidth - visibleWidth(left))) + fg("borderAccent", "│") + right,
				layout.width,
			);
	} else {
		header = list[0] ?? "";
	}

	const rows: string[] = [header];

	if (detail) {
		const maxScroll = Math.max(0, diffBody.length - layout.bodyRows);
		const scroll = Math.min(state.scroll, maxScroll);
		for (const line of diffBody.slice(scroll, scroll + layout.bodyRows)) {
			rows.push(truncateToWidth(line, layout.width));
		}
	} else {
		const listRows = list.slice(1);
		let selectedRow = 0;
		if (selected) {
			let index = 0;
			for (const group of GROUPS) {
				const groupEntries = entries.filter((entry) => entry.group === group);
				if (groupEntries.length === 0) continue;
				index++; // the group header row
				for (const entry of groupEntries) {
					if (selected && entryKey(entry) === entryKey(selected)) selectedRow = index;
					index++;
				}
			}
		}
		const start = listWindowStart(listRows.length, selectedRow, layout.bodyRows);
		const windowed = listRows.slice(start, start + layout.bodyRows);
		if (layout.mode === "split") {
			const maxScroll = Math.max(0, diffBody.length - layout.bodyRows);
			const scroll = Math.min(state.scroll, maxScroll);
			const diffRows = diffBody.slice(scroll, scroll + layout.bodyRows);
			for (let row = 0; row < layout.bodyRows; row++) {
				const left = windowed[row] ?? "";
				const leftPadded = left + " ".repeat(Math.max(0, layout.listWidth - visibleWidth(left)));
				const right = diffRows[row] ?? "";
				const gap = " ".repeat(Math.max(0, layout.diffWidth - visibleWidth(right)));
				rows.push(truncateToWidth(leftPadded + fg("borderAccent", "│") + right + gap, layout.width));
			}
		} else {
			for (let row = 0; row < layout.bodyRows; row++) {
				rows.push(truncateToWidth(windowed[row] ?? "", layout.width));
			}
		}
	}

	const hint = fg("dim", t.hint(detail || layout.mode === "narrow" ? "narrow" : "split"));
	rows.push(hint);
	return rows.slice(0, layout.bodyRows + 2).map((row) =>
		truncateToWidth(row + " ".repeat(Math.max(0, layout.width - visibleWidth(row))), layout.width),
	);
}
