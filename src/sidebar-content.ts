import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { fmtCost, fmtPercent, fmtTokens } from "./format.ts";

export type Fg = (role: string, text: string) => string;

export interface SidebarData {
	project: { name: string; path: string; branch?: string | null };
	/** null when the directory is not inside a git repository */
	changes: { created: string[]; updated: string[]; deleted: string[] } | null;
	model: {
		id?: string;
		thinking?: string;
		/** percent is 0..100 or null when usage is unknown */
		context?: { percent: number | null; used: number; window: number } | null;
	};
	usage: { tokensIn: number; tokensOut: number; cost: number };
}

export const SIDEBAR_MAX_FILES = 12;
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
export function buildSidebarLines(data: SidebarData, opts: { width: number; rows: number; maxFiles?: number }, fg: Fg): string[] {
	const width = Math.max(3, opts.width);
	const contentWidth = width - 2;
	const rows = Math.max(1, opts.rows);
	const out: string[] = [];
	const push = (...segments: string[]) => {
		const fitted = truncateToWidth(segments.join(""), contentWidth);
		out.push(fg("borderAccent", "│") + " " + fitted + " ".repeat(Math.max(0, contentWidth - visibleWidth(fitted))));
	};

	// PROJECT
	push(fg("accent", "PROJECT"));
	push(fg("text", data.project.name));
	push(fg("dim", data.project.path));
	if (data.project.branch) push(fg("muted", data.project.branch));

	// CHANGES
	push("");
	push(fg("accent", "CHANGES"));
	if (data.changes === null) {
		push(fg("dim", "no repo"));
	} else {
		const { created, updated, deleted } = data.changes;
		if (!created.length && !updated.length && !deleted.length) {
			push(fg("dim", "clean"));
		} else {
			if (created.length) push(fg("success", `+${created.length} created`));
			if (updated.length) push(fg("warning", `~${updated.length} updated`));
			if (deleted.length) push(fg("error", `−${deleted.length} deleted`));
			const max = Math.max(0, opts.maxFiles ?? SIDEBAR_MAX_FILES);
			const files: Array<[marker: "+" | "~" | "−", name: string]> = [
				...created.map((f) => ["+", f] as const),
				...updated.map((f) => ["~", f] as const),
				...deleted.map((f) => ["−", f] as const),
			];
			for (const [marker, name] of files.slice(0, max)) {
				push(fg(marker === "+" ? "success" : marker === "~" ? "warning" : "error", `${marker} ${name}`));
			}
			if (files.length > max) push(fg("dim", `+${files.length - max} more`));
		}
	}

	// MODEL
	push("");
	push(fg("accent", "MODEL"));
	push(data.model.id ? fg("text", data.model.id) : fg("dim", "no model"));
	if (data.model.thinking) push(fg("muted", `thinking ${data.model.thinking}`));
	const ctx = data.model.context;
	if (ctx) {
		const pct = ctx.percent == null ? "?" : fmtPercent(ctx.percent / 100);
		push(fg("muted", `ctx ${pct} `) + fg("accent", contextBar(ctx.percent)) + " " + fg("dim", `${fmtTokens(ctx.used)}/${fmtTokens(ctx.window)}`));
	}

	// USAGE
	push("");
	push(fg("accent", "USAGE"));
	push(fg("dim", `↑${fmtTokens(data.usage.tokensIn)} ↓${fmtTokens(data.usage.tokensOut)}`));
	push(fg("muted", fmtCost(data.usage.cost)));

	while (out.length < rows) push("");
	return out.slice(0, rows);
}
