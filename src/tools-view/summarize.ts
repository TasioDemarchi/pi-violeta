/** One-line tool summaries (T2/S2): tool name + args + result collapsed to a
 * single transcript line — `✓ read README.md`, `✓ bash npm test · 0 · 1.2s`,
 * `✗ bash … · exit 1 · <first error line>`, `✓ edit src/a.ts +3 −1`, with a
 * running glyph (`◐`) while the call is in flight. Pure formatting only: the
 * model-facing tool results are never touched. Colors are applied later, from
 * theme roles, by `styledSummary` in compact.ts. */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { shortenPath } from "./paths.ts";

export type ToolPhase = "running" | "success" | "error";

/** Theme roles the one-liners may use (S2: colors only through theme roles). */
export type SummaryRole = "success" | "error" | "dim" | "accent" | "toolDiffAdded" | "toolDiffRemoved";

export interface SummaryExtra {
	text: string;
	role?: SummaryRole;
	/** Join with a space instead of ` · ` (the `+A −R` diff counts stay one visual unit). */
	inline?: boolean;
}

export interface ToolSummary {
	phase: ToolPhase;
	name: string;
	args: string;
	extras: SummaryExtra[];
	errorLine?: string;
}

export interface SummarizePaths {
	cwd?: string;
	home?: string;
}

export interface ResultInput {
	isError?: boolean;
	text?: string;
	details?: unknown;
}

export interface SummarizeResultOptions extends SummarizePaths {
	/** Milliseconds between the call and the final result, when known. */
	durationMs?: number;
	/** Extension-supplied extras (ids, status words, counts), appended in order. */
	extra?: SummaryExtra[];
}

/** The glyphs match violeta's existing visual language (todo card: ◐ running, ✓ done, ✗ failed). */
export function glyphFor(phase: ToolPhase): string {
	return phase === "running" ? "◐" : phase === "success" ? "✓" : "✗";
}

function firstLine(value: unknown): string {
	return typeof value === "string" ? value.split("\n")[0].trim() : "";
}

/** Short argument display per tool: path for the file tools, the command's
 * first line for the shell tools, the pattern for grep/find; violeta's own
 * tools fall back to their first meaningful string arguments. */
function displayArgs(name: string, args: Record<string, unknown> | undefined, paths: SummarizePaths): string {
	if (!args) return "";
	switch (name) {
		case "read":
		case "edit":
		case "write":
		case "ls":
			return shortenPath(typeof args.path === "string" ? args.path : "", paths.cwd, paths.home);
		case "bash":
		case "bash_background":
		case "monitor":
			return firstLine(args.command);
		case "grep":
		case "find":
			return firstLine(args.pattern);
		default: {
			const parts: string[] = [];
			for (const key of ["command", "path", "pattern", "agent", "label", "action", "title"]) {
				const line = firstLine(args[key]);
				if (line) parts.push(line);
			}
			for (const key of ["job_id", "id"]) {
				const value = args[key];
				if (typeof value === "string" && value.trim() !== "") parts.push(value.trim());
				else if (typeof value === "number") parts.push(String(value));
			}
			return parts.join(" ");
		}
	}
}

export function summarizeCall(name: string, args: Record<string, unknown> | undefined, paths: SummarizePaths = {}): ToolSummary {
	return { phase: "running", name, args: displayArgs(name, args, paths), extras: [] };
}

/** `Command exited with code N` (and friends) is Pi's status footer on failed
 * shell results, not an error line; the exit code is shown as an extra. */
const SHELL_STATUS_LINE = /^Command (exited with code \d+|terminated without an exit code|aborted)$/;

export function firstErrorLine(text: string | undefined): string | undefined {
	if (!text) return undefined;
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || SHELL_STATUS_LINE.test(trimmed)) continue;
		return trimmed;
	}
	return undefined;
}

/** Exit code of a failed shell result, parsed from Pi's status footer. */
function shellExitCode(text: string | undefined): number | undefined {
	if (!text) return undefined;
	const match = text.match(/Command exited with code (\d+)\s*$/);
	return match ? Number(match[1]) : undefined;
}

/** Display-oriented diff → `+A −R` counts (headers `+++`/`---` excluded). */
export function diffStats(diff: string | undefined): { additions: number; removals: number } {
	let additions = 0;
	let removals = 0;
	if (!diff) return { additions, removals };
	for (const line of diff.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) additions++;
		else if (line.startsWith("-") && !line.startsWith("---")) removals++;
	}
	return { additions, removals };
}

/** Duration as `4.2s` below a minute, then `1m 5s` and `1h 2m 3s`. */
export function formatDuration(ms: number): string {
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const seconds = Math.floor(ms / 1000);
	const parts: string[] = [];
	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const rest = seconds % 60;
	if (hours > 0) parts.push(`${hours}h`);
	if (hours > 0 || minutes > 0) parts.push(`${minutes}m`);
	parts.push(`${rest}s`);
	return parts.join(" ");
}

export function summarizeResult(
	name: string,
	args: Record<string, unknown> | undefined,
	result: ResultInput,
	opts: SummarizeResultOptions = {},
): ToolSummary {
	const phase: ToolPhase = result.isError ? "error" : "success";
	const extras: SummaryExtra[] = [];

	if (name === "bash") {
		if (result.isError) {
			const code = shellExitCode(result.text);
			if (code !== undefined) extras.push({ text: `exit ${code}` });
		} else {
			extras.push({ text: "0" });
		}
		if (opts.durationMs !== undefined) extras.push({ text: formatDuration(opts.durationMs) });
	}

	if (name === "edit") {
		const details = result.details as { diff?: string } | undefined;
		const { additions, removals } = diffStats(details?.diff);
		if (additions > 0) extras.push({ text: `+${additions}`, role: "toolDiffAdded", inline: true });
		if (removals > 0) extras.push({ text: `−${removals}`, role: "toolDiffRemoved", inline: true });
	}

	if (opts.extra) extras.push(...opts.extra);

	const errorLine = result.isError ? firstErrorLine(result.text) : undefined;
	return { phase, name, args: displayArgs(name, args, opts), extras, errorLine };
}

/** The plain (unstyled) one-line rendering of a summary. */
export function formatToolSummary(summary: ToolSummary): string {
	let line = `${glyphFor(summary.phase)} ${summary.name}`;
	if (summary.args) line += ` ${summary.args}`;
	for (const extra of summary.extras) line += `${extra.inline ? " " : " · "}${extra.text}`;
	if (summary.errorLine) line += ` · ${summary.errorLine}`;
	return line;
}

/** ANSI-safe truncation to one terminal line: escape sequences are preserved
 * and never counted as visible width (pi-tui's grapheme-aware truncator). */
export function truncateLine(line: string, width: number): string {
	return truncateToWidth(line, width, "…");
}
