/**
 * usage — the arithmetic behind /usage and /context.
 *
 * The footer and the sidebar already paint these numbers; the two commands
 * show them in full, including the per-model split, which nothing else shows
 * and which is the only part that costs money when the session runs on a paid
 * model. The sums live here, not in the extension, so they are testable
 * without a terminal: the input is plain entries, not a session manager.
 */

import { COMPACT_AT } from "./context-warning.ts";
import { fmtCost, fmtPercent, fmtTokens } from "./format.ts";
import { context as contextT, usage as t } from "./i18n.ts";

/** The part of a branch entry this module reads. Everything else is ignored,
 * so Pi's own types are not needed (and must not be, in a pure module). */
export interface UsageEntry {
	type?: string;
	message?: {
		role?: string;
		model?: string;
		usage?: {
			input?: number;
			output?: number;
			cacheRead?: number;
			cacheWrite?: number;
			cost?: { total?: number };
		};
	};
}

export interface Totals {
	/** Assistant messages counted, i.e. how many times the model answered. */
	replies: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

export interface ModelTotals extends Totals {
	/** Empty when the message recorded no model id. */
	model: string;
}

export interface SessionUsage {
	total: Totals;
	/** Costliest first, ties broken by tokens and then by name, so the same
	 * session always renders in the same order. */
	byModel: ModelTotals[];
}

const zero = (): Totals => ({ replies: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });

/** A missing field, NaN and Infinity all count as zero: one malformed message
 * must not turn the session's total into NaN. */
function num(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type MessageUsage = NonNullable<NonNullable<UsageEntry["message"]>["usage"]>;

function add(into: Totals, u: MessageUsage): void {
	into.replies += 1;
	into.input += num(u.input);
	into.output += num(u.output);
	into.cacheRead += num(u.cacheRead);
	into.cacheWrite += num(u.cacheWrite);
	into.cost += num(u.cost?.total);
}

/** Sum the branch's assistant messages, in total and per model. */
export function collectUsage(entries: Iterable<UsageEntry>): SessionUsage {
	const total = zero();
	const perModel = new Map<string, ModelTotals>();
	for (const entry of entries) {
		if (!entry || entry.type !== "message") continue;
		const message = entry.message;
		if (!message || message.role !== "assistant" || !message.usage) continue;
		add(total, message.usage);
		const model = typeof message.model === "string" ? message.model : "";
		let bucket = perModel.get(model);
		if (!bucket) {
			bucket = { model, ...zero() };
			perModel.set(model, bucket);
		}
		add(bucket, message.usage);
	}
	const byModel = [...perModel.values()].sort(
		(a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output) || a.model.localeCompare(b.model),
	);
	return { total, byModel };
}

function modelName(totals: ModelTotals): string {
	return totals.model || t.unknownModel;
}

/** What /usage prints, one line per element. */
export function usageLines(usage: SessionUsage): string[] {
	const { total, byModel } = usage;
	if (total.replies === 0) return [t.empty];
	// With a single model the per-model list would just repeat the total, so
	// the model's name goes in the title instead.
	const only = byModel.length === 1 ? byModel[0]! : undefined;
	const lines = [only ? t.titleWithModel(total.replies, modelName(only)) : t.title(total.replies)];
	lines.push(t.tokens(fmtTokens(total.input), fmtTokens(total.output), fmtCost(total.cost)));
	if (total.cacheRead + total.cacheWrite > 0) lines.push(t.cache(fmtTokens(total.cacheRead), fmtTokens(total.cacheWrite)));
	if (!only) {
		lines.push(t.byModel);
		for (const m of byModel) {
			lines.push(t.modelLine(modelName(m), m.replies, `↑${fmtTokens(m.input)} ↓${fmtTokens(m.output)}`, fmtCost(m.cost)));
		}
	}
	return lines;
}

/** The shape `ctx.getContextUsage()` returns, with every field optional
 * because a session that has not called the model yet reports nothing. */
export interface ContextUsage {
	percent?: number | null;
	tokens?: number | null;
	contextWindow?: number | null;
}

/** What /context prints, one line per element. */
export function contextLines(usage: ContextUsage | null | undefined): string[] {
	const window = num(usage?.contextWindow);
	// Pi reports tokens: null when it cannot estimate them (right after a
	// compaction, before the next answer). Saying "0%" there would be a lie.
	const tokens = usage?.tokens;
	if (!usage || window <= 0 || typeof tokens !== "number" || !Number.isFinite(tokens)) return [contextT.unknown];
	const used = Math.min(Math.max(tokens, 0), window);
	// The percent Pi reports is authoritative (it knows what it counts); the
	// division is only a fallback for a reading that omits it.
	const percent = typeof usage.percent === "number" && Number.isFinite(usage.percent) ? usage.percent : (used / window) * 100;
	const lines = [contextT.line(fmtPercent(percent / 100), fmtTokens(window)), contextT.usedFree(fmtTokens(used), fmtTokens(window - used))];
	// The same 80% threshold the footer warns at, so the two never disagree.
	if (percent >= COMPACT_AT) lines.push(contextT.compactSuggest);
	return lines;
}
