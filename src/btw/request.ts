/**
 * btw request — what the side chat actually sends, as pure string building.
 *
 * The session's context is flattened into ONE user message instead of being
 * replayed as real messages. Two reasons, both practical: the session's own
 * messages carry tool calls and tool results, which are the bulk of the tokens
 * and none of the conversation; and replaying them means hand-building
 * provider-shaped assistant messages (api, provider, usage, stopReason), which
 * breaks differently on every provider. A quoted transcript is provider-neutral
 * and is what an aside needs: what was said, not what was run.
 *
 * The section markers are English on purpose — they are structure for the model,
 * like tool names. What language the answer comes back in is decided by the
 * system prompt, which lives in the dictionary.
 */

import type { BtwTurn } from "./state.ts";

export interface TranscriptTurn {
	role: "user" | "assistant";
	text: string;
}

/** The transcript is cut to the most recent characters that fit. A session can
 * reach a million tokens; an aside that quotes all of it would cost more than
 * the question is worth. Dropping the OLDEST keeps what is being talked about. */
export const BTW_CONTEXT_CHARS = 40_000;

type BranchEntry = { type?: unknown; message?: { role?: unknown; content?: unknown } };

/** Text of one message's content, whether it is a plain string or Pi's content
 * blocks. Thinking blocks and tool calls are not text and are skipped. Exported
 * because the answer that comes back from the model is read the same way. */
export function blocksText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block): block is { type: "text"; text: string } =>
			typeof block === "object" && block !== null && (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string",
		)
		.map((block) => block.text)
		.join("\n");
}

/** The conversation of a Pi session branch: user and assistant text, in order.
 * Everything else (tool calls, tool results, custom state entries, system
 * messages) is left out. */
export function branchTurns(branch: readonly unknown[]): TranscriptTurn[] {
	const turns: TranscriptTurn[] = [];
	for (const raw of branch) {
		const entry = raw as BranchEntry;
		if (entry?.type !== "message") continue;
		const role = entry.message?.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = blocksText(entry.message?.content).trim();
		if (text === "") continue;
		turns.push({ role, text });
	}
	return turns;
}

/** The newest turns whose text fits in `maxChars`, in order. A single turn
 * longer than the budget is kept and cut at the end, so the question always
 * has at least its immediate context. */
export function recentTurns(turns: readonly TranscriptTurn[], maxChars: number = BTW_CONTEXT_CHARS): TranscriptTurn[] {
	const budget = Math.max(1, maxChars);
	const kept: TranscriptTurn[] = [];
	let used = 0;
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i]!;
		const left = budget - used;
		if (left <= 0) break;
		if (turn.text.length <= left) {
			kept.unshift(turn);
			used += turn.text.length;
			continue;
		}
		// Only the newest turn is worth cutting; an older half-sentence is noise.
		if (kept.length === 0) kept.unshift({ role: turn.role, text: turn.text.slice(0, left) });
		break;
	}
	return kept;
}

export interface PromptOptions {
	question: string;
	/** The session conversation (empty when the session has no turns yet). */
	transcript: readonly TranscriptTurn[];
	/** The side chat's own previous turns (errors excluded by the caller). */
	history: readonly BtwTurn[];
}

/** The single user message of a /btw request: the session transcript (when
 * there is one), the aside so far, then the question. */
export function buildBtwPrompt(opts: PromptOptions): string {
	const parts: string[] = [];
	const transcript = opts.transcript;
	if (transcript.length > 0) {
		const lines = transcript.map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`);
		parts.push(`=== Main session transcript (context only, do not continue it) ===\n${lines.join("\n\n")}`);
	}
	const history = opts.history.filter((turn) => turn.role !== "error");
	if (history.length > 0) {
		const lines = history.map((turn) => `${turn.role === "user" ? "Question" : "Answer"}: ${turn.text}`);
		parts.push(`=== This aside so far ===\n${lines.join("\n\n")}`);
	}
	parts.push(`=== The question ===\n${opts.question}`);
	return parts.join("\n\n");
}
