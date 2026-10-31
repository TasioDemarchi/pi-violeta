/** Changes diff — pure reading and coloring of a diff into lines: classification
 * of `git diff` output, untracked-content rendering, the 3000-line cap, and the
 * one-line `path · +A −D` header. No Pi API here: the view and the extension
 * feed data and a theme-like `fg` function. */

import { visibleWidth } from "@earendil-works/pi-tui";

import type { ViewFg } from "./view.ts";

export type DiffLineKind = "add" | "del" | "context" | "meta";

export interface DiffLine {
	kind: DiffLineKind;
	text: string;
}

/** At most this many diff lines are rendered; the rest fold into the dim
 * `… N líneas más` notice. */
export const DIFF_MAX_LINES = 3000;

export interface DiffData {
	path: string;
	added: number;
	deleted: number;
	binary: boolean;
	truncated: number;
	lines: readonly DiffLine[];
}

/** Kind → theme role for diff lines (dim for headers and hunk markers). */
export const DIFF_ROLES: Record<DiffLineKind, string> = {
	add: "toolDiffAdded",
	del: "toolDiffRemoved",
	context: "toolDiffContext",
	meta: "dim",
};

const META_PREFIXES = [
	"diff --git ",
	"index ",
	"+++ ",
	"--- ",
	"new file mode",
	"deleted file mode",
	"old mode",
	"new mode",
	"similarity index",
	"rename from",
	"rename to",
	"copy from",
	"copy to",
	"Binary files",
	"GIT binary patch",
];

function classify(line: string): DiffLine {
	if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) return { kind: "meta", text: line };
	if (line.startsWith("@@")) return { kind: "meta", text: line };
	if (line.startsWith("+")) return { kind: "add", text: line };
	if (line.startsWith("-")) return { kind: "del", text: line };
	return { kind: "context", text: line };
}

/** Split raw `git diff` output into classified lines (no trailing blank). */
export function parseDiff(raw: string): DiffLine[] {
	const lines = raw.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.map(classify);
}

/** Added/deleted counts: only real +/- body lines, never `+++`/`---`. */
export function countDiff(lines: readonly DiffLine[]): { added: number; deleted: number } {
	let added = 0;
	let deleted = 0;
	for (const line of lines) {
		if (line.kind === "add") added++;
		else if (line.kind === "del") deleted++;
	}
	return { added, deleted };
}

/** Untracked file content rendered as `+` lines. */
export function untrackedLines(text: string): DiffLine[] {
	const lines = text.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
	return lines.map((line) => ({ kind: "add" as const, text: line }));
}

/** Cap the rendered lines; the rest are reported so the view can show a notice. */
export function capDiff(lines: readonly DiffLine[]): { lines: DiffLine[]; truncated: number } {
	if (lines.length <= DIFF_MAX_LINES) return { lines: [...lines], truncated: 0 };
	return { lines: lines.slice(0, DIFF_MAX_LINES), truncated: lines.length - DIFF_MAX_LINES };
}

/** git marks binary content with a notice instead of a patch. */
export function isBinaryDiff(raw: string): boolean {
	return /(^|\n)(Binary files|GIT binary patch)/.test(raw);
}

/** `path · +A −D` — the one-line diff header, path clipped to the pane width. */
export function diffHeader(data: DiffData, width: number, fg: ViewFg): string {
	const tail = ` · +${data.added} −${data.deleted}`;
	const pathWidth = Math.max(1, width - tail.length);
	const path = clip(data.path, pathWidth);
	return `${fg("accent", path)}${fg("dim", " · ")}${fg("success", `+${data.added}`)} ${fg("error", `−${data.deleted}`)}`;
}

/** One diff line colored through its theme role. */
export function colorDiffLine(line: DiffLine, fg: ViewFg): string {
	return fg(DIFF_ROLES[line.kind], line.text);
}

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
