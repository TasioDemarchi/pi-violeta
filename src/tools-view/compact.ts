/** Compact tool renderer wrapper (T2/S2): given a tool definition, returns the
 * SAME definition with only `renderCall`/`renderResult` overridden, so the
 * model-facing `execute` (and therefore every tool result the model receives)
 * is byte-identical. Collapsed, calls and results draw ONE line; expanded
 * (Pi's `app.tools.expand` toggle, ctrl+o) the full result text is revealed.
 * Colors go only through theme roles via the passed-in theme. */

import { Text, type Component } from "@earendil-works/pi-tui";
import {
	glyphFor,
	summarizeCall,
	summarizeResult,
	truncateLine,
	type SummaryExtra,
	type SummaryRole,
	type ToolPhase,
	type ToolSummary,
} from "./summarize.ts";

export type CompactFg = (role: string, text: string) => string;

export interface ThemeLike {
	fg(role: string, text: string): string;
	bold(text: string): string;
}

/** The slice of ToolRenderContext the renderers use. Note: the TUI passes the
 * result to renderResult as `{ content, details }` WITHOUT `isError` — the
 * error flag and the session duration arrive on the CONTEXT. */
export interface CompactRenderContext {
	args: Record<string, unknown> | undefined;
	state: Record<string, unknown>;
	cwd: string;
	isError?: boolean;
	durationMs?: number;
}

export interface CompactRenderOptions {
	expanded: boolean;
	isPartial: boolean;
}

export interface ResultLike {
	content?: Array<{ type: string; text?: string }>;
	details?: unknown;
	isError?: boolean;
}

export interface CompactOptions {
	/** Extension-supplied extras for the result line (ids, counts, status words). */
	extra?: (result: ResultLike, args: Record<string, unknown> | undefined) => SummaryExtra[];
}

interface TimerState {
	vsStartedAt?: number;
	vsEndedAt?: number;
}

const GLYPH_ROLE: Record<ToolPhase, SummaryRole> = { running: "accent", success: "success", error: "error" };

/** A summary with colors applied from theme roles only. */
export function styledSummary(summary: ToolSummary, fg: CompactFg): string {
	let line = `${fg(GLYPH_ROLE[summary.phase], glyphFor(summary.phase))} ${fg("accent", summary.name)}`;
	if (summary.args) line += ` ${summary.args}`;
	for (const extra of summary.extras) line += `${extra.inline ? " " : " · "}${fg(extra.role ?? "dim", extra.text)}`;
	if (summary.errorLine) line += ` · ${fg("error", summary.errorLine)}`;
	return line;
}

/** A component that draws exactly one terminal line, truncated ANSI-safely. */
function oneLine(text: string): Component {
	return {
		invalidate() {},
		render(width: number): string[] {
			return [truncateLine(text, width)];
		},
	};
}

function fullText(result: ResultLike): string {
	return (result.content ?? [])
		.filter((item) => item.type === "text" && typeof item.text === "string")
		.map((item) => item.text as string)
		.join("\n");
}

function timerOf(context: CompactRenderContext): TimerState {
	const state = (context.state ??= {}) as TimerState;
	return state;
}

/** The `{ renderCall, renderResult }` pair for one tool name. Spread it into
 * an existing `registerTool` call (violeta's own tools) or wrap a full
 * definition with `withCompactRenderer` (Pi's built-ins). */
export function compactRenderers(name: string, opts?: CompactOptions) {
	// theme.fg must be called BOUND: extracting it (`theme.fg`) detaches `this`
	// and the renderer throws, making Pi fall back to the built-in renderer.
	const fgOf = (theme: ThemeLike): CompactFg => (role, text) => theme.fg(role, text);
	return {
		renderCall(args: Record<string, unknown> | undefined, theme: ThemeLike, context: CompactRenderContext): Component {
			timerOf(context).vsStartedAt ??= Date.now();
			return oneLine(styledSummary(summarizeCall(name, args, { cwd: context.cwd }), fgOf(theme)));
		},
		renderResult(result: ResultLike, options: CompactRenderOptions, theme: ThemeLike, context: CompactRenderContext): Component {
			const fg = fgOf(theme);
			if (options.isPartial) {
				return oneLine(styledSummary(summarizeCall(name, context.args, { cwd: context.cwd }), fg));
			}
			const state = timerOf(context);
			let durationMs = context.durationMs;
			if (durationMs === undefined && state.vsStartedAt !== undefined) {
				// Fallback clock (Pi reports context.durationMs on final results).
				state.vsEndedAt ??= Date.now();
				durationMs = Math.max(0, state.vsEndedAt - state.vsStartedAt);
			}
			const summary = summarizeResult(
				name,
				context.args,
				{ isError: context.isError ?? result.isError, text: fullText(result), details: result.details },
				{ cwd: context.cwd, durationMs, extra: opts?.extra?.(result, context.args) },
			);
			const line = styledSummary(summary, fg);
			if (options.expanded) {
				const full = fullText(result);
				return new Text(full ? `${line}\n\n${full}` : line, 0, 0);
			}
			return oneLine(line);
		},
	};
}

/** The original definition with ONLY the renderers overridden: `execute`,
 * `parameters`, `description`, `label` and everything else stay the same
 * objects, so the tool's behavior — and what the model receives — is
 * byte-identical to the built-in tool. */
export function withCompactRenderer<T extends object>(name: string, original: T, opts?: CompactOptions): T {
	return { ...original, ...compactRenderers(name, opts) } as T;
}
