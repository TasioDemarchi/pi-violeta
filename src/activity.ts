/**
 * Activity line, pure logic: which phase label to show for a tool in flight
 * and how the animated dots look at a given animation tick.
 */

import { activity as t } from "./i18n.ts";

export type Fg = (role: string, text: string) => string;

/** The three dots animate through these frames, one per tick. */
const DOTS_FRAMES = ["", ".", "..", "..."];

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const EDIT_TOOLS = new Set(["edit", "write"]);
// A bash command that looks like a test/check run gets its own phase.
const CHECK_PATTERN = /test|pytest|vitest|jest|node --test|npm test|tsc|lint/;

/** The dot frame for an animation tick: "", ".", ".." or "..." cycling. */
export function dotsFrame(tick: number): string {
	return DOTS_FRAMES[((tick % DOTS_FRAMES.length) + DOTS_FRAMES.length) % DOTS_FRAMES.length];
}

/**
 * The phase label for a tool call: exploring for read-only lookups,
 * implementing for edits, checking for test-like bash commands, running for
 * other bash, and thinking for anything unknown (the model generating).
 */
export function phaseForTool(name: string, args: unknown): string {
	if (name === "bash") {
		const command = (args as { command?: unknown } | undefined)?.command;
		return typeof command === "string" && CHECK_PATTERN.test(command) ? t.phases.checking : t.phases.running;
	}
	if (EDIT_TOOLS.has(name)) return t.phases.implementing;
	if (READ_ONLY_TOOLS.has(name) || name.includes("codegraph")) return t.phases.exploring;
	return t.phases.thinking;
}

/**
 * One activity line: `▍ <phase>` plus the animated dots, padded to a constant
 * width so the text never shifts while the dots appear and disappear.
 */
export function activityLine(phase: string, tick: number, fg: Fg): string {
	const dots = dotsFrame(tick);
	return fg("borderAccent", "▍") + " " + fg("accent", phase) + fg("muted", dots) + " ".repeat(3 - dots.length);
}
