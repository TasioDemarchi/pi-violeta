/**
 * palette-view — the command palette (T5/S7), pure state, filtering and
 * rendering: every available command (violeta's own, prompt templates, skill
 * commands and Pi's well-known built-ins) grouped Session / Interface / Tools
 * / Other, filtered as you type (substring, case-insensitive, over name and
 * description), a small key reducer, and the overlay line builder with the
 * static shortcuts block at the bottom. No Pi API here — the extension wires
 * `pi.getCommands()`, the theme-like `fg` function and the terminal size.
 *
 * While typing, letters go to the query, so navigation uses the arrows and
 * ctrl+n/ctrl+p (never j/k: those letters edit the query). Enter selects;
 * the extension then inserts `/<name> ` into the editor with
 * `ctx.ui.setEditorText` (no documented API executes a slash command
 * directly) and closes, so the user presses Enter.
 *
 * Pi's well-known built-in commands are not exposed by `pi.getCommands()`
 * (which only lists extension, prompt and skill commands), so they live in a
 * deterministic static table below, with Pi's own English descriptions (Pi
 * core strings are not translatable from an extension — see src/i18n.ts).
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { palette as t } from "../i18n.ts";

export type ViewFg = (role: string, text: string) => string;

export type PaletteSource = "extension" | "prompt" | "skill" | "pi";
export type PaletteGroup = "session" | "interface" | "tools" | "other";

export interface PaletteCommand {
	name: string;
	description?: string;
	source: PaletteSource;
}

export interface PaletteEntry extends PaletteCommand {
	group: PaletteGroup;
}

// --- The deterministic classification table -------------------------------------

/** violeta's own commands (the groups they render under). */
const VIOLETA_COMMAND_GROUPS: Record<string, PaletteGroup> = {
	sidebar: "interface",
	language: "interface",
	models: "interface",
	palette: "interface",
	todo: "interface",
	changes: "interface",
	notify: "interface",
	agents: "tools",
	jobs: "tools",
	grants: "tools",
	btw: "tools",
	btwn: "tools",
};

/** Pi's well-known built-in slash commands, with Pi's own descriptions
 * (English — Pi core strings are not translated by extensions). */
export const PI_BUILTIN_COMMANDS: readonly (PaletteCommand & { group: PaletteGroup })[] = [
	{ name: "changelog", description: "Show changelog entries", source: "pi", group: "session" },
	{ name: "clone", description: "Duplicate the current session at the current position", source: "pi", group: "session" },
	{ name: "compact", description: "Manually compact the session context", source: "pi", group: "session" },
	{ name: "copy", description: "Copy last agent message to clipboard", source: "pi", group: "session" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)", source: "pi", group: "session" },
	{ name: "fork", description: "Create a new fork from a previous user message", source: "pi", group: "session" },
	{ name: "import", description: "Import and resume a session from a JSONL file", source: "pi", group: "session" },
	{ name: "name", description: "Set session display name", source: "pi", group: "session" },
	{ name: "new", description: "Start a new session", source: "pi", group: "session" },
	{ name: "resume", description: "Resume a different session", source: "pi", group: "session" },
	{ name: "session", description: "Show session info and stats", source: "pi", group: "session" },
	{ name: "share", description: "Share session via a Radius artifact or a GitHub gist", source: "pi", group: "session" },
	{ name: "tree", description: "Navigate session tree (switch branches)", source: "pi", group: "session" },
	{ name: "model", description: "Select model (opens selector UI)", source: "pi", group: "interface" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling", source: "pi", group: "interface" },
	{ name: "settings", description: "Open settings menu", source: "pi", group: "interface" },
	{ name: "thinking", description: "Set thinking level", source: "pi", group: "interface" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts", source: "pi", group: "tools" },
	{ name: "login", description: "Configure provider authentication", source: "pi", group: "tools" },
	{ name: "logout", description: "Remove provider authentication", source: "pi", group: "tools" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files", source: "pi", group: "tools" },
	{ name: "trust", description: "Save project trust decision for future sessions", source: "pi", group: "tools" },
	{ name: "bug", description: "Report a bug to the Pi developers", source: "pi", group: "other" },
	{ name: "quit", description: "Quit pi", source: "pi", group: "other" },
];

/** Which group a command renders under: violeta's table, then Pi's well-known
 * built-ins, then everything else in `other`. */
export function classifyCommand(name: string): PaletteGroup {
	const bare = name.startsWith("skill:") ? name.slice("skill:".length) : name;
	if (VIOLETA_COMMAND_GROUPS[bare] !== undefined) return VIOLETA_COMMAND_GROUPS[bare]!;
	if (VIOLETA_COMMAND_GROUPS[name] !== undefined) return VIOLETA_COMMAND_GROUPS[name]!;
	return PI_BUILTIN_COMMANDS.find((command) => command.name === name)?.group ?? "other";
}

/** The full entry list: the live commands from pi.getCommands() (violeta's,
 * templates, skills) first, then Pi's well-known built-ins that no live
 * command already covers, each classified deterministically. */
export function paletteEntries(commands: readonly PaletteCommand[]): PaletteEntry[] {
	const byName = new Map<string, PaletteEntry>();
	for (const command of commands) {
		if (byName.has(command.name)) continue;
		byName.set(command.name, { ...command, group: classifyCommand(command.name) });
	}
	for (const builtin of PI_BUILTIN_COMMANDS) {
		if (byName.has(builtin.name)) continue;
		byName.set(builtin.name, { ...builtin });
	}
	return [...byName.values()];
}

// --- Filtering, grouping and sorting ---------------------------------------------

const GROUP_ORDER: PaletteGroup[] = ["session", "interface", "tools", "other"];

/** Substring, case-insensitive match over the name (with and without the
 * leading `/`) and the description; grouped in the fixed Session / Interface
 * / Tools / Other order and sorted by name inside each group. */
export function filterEntries(entries: readonly PaletteEntry[], query: string): PaletteEntry[] {
	const needle = query.trim().toLowerCase();
	const matched = entries.filter((entry) => {
		if (needle === "") return true;
		const haystack = `${entry.name} ${entry.description ?? ""}`.toLowerCase();
		return haystack.includes(needle) || `/${entry.name}`.toLowerCase().includes(needle);
	});
	return matched.sort((a, b) => {
		const groupDelta = GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
		if (groupDelta !== 0) return groupDelta;
		return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
	});
}

// --- State -----------------------------------------------------------------------

export interface PaletteState {
	query: string;
	/** Index into the filtered entry list. */
	index: number;
	/** Set by `select`, undefined until then. */
	chosen: string | undefined;
	closed: boolean;
}

export type PaletteAction =
	| { type: "insert"; text: string }
	| { type: "backspace" }
	| { type: "up" }
	| { type: "down" }
	| { type: "select" }
	| { type: "escape" };

export function initialPaletteState(): PaletteState {
	return { query: "", index: 0, chosen: undefined, closed: false };
}

const clamp = (index: number, count: number): number => Math.max(0, Math.min(index, Math.max(0, count - 1)));

/** Pure key handling. Letters and paste go to the query (the selection is
 * clamped so it stays valid); navigation is up/down only; enter records the
 * selected command's name and closes (a no-op on an empty result); esc clears
 * a non-empty query first and closes with an empty one. `filtered` is the
 * filtered entry list the state's index points into. */
export function reducePalette(state: PaletteState, action: PaletteAction, filtered: readonly PaletteEntry[]): PaletteState {
	const count = filtered.length;
	switch (action.type) {
		case "insert":
			return { ...state, query: state.query + action.text, index: clamp(state.index, count) };
		case "backspace":
			return { ...state, query: state.query.slice(0, -1), index: clamp(state.index, count) };
		case "up":
			return { ...state, index: Math.max(0, state.index - 1) };
		case "down":
			return { ...state, index: clamp(state.index + 1, count) };
		case "select":
			return count > 0 ? { ...state, chosen: filtered[state.index]?.name, closed: true } : state;
		case "escape":
			if (state.query !== "") return { ...state, query: "", index: 0 };
			return { ...state, closed: true };
		default:
			return state;
	}
}

// --- Render ---------------------------------------------------------------------

interface BodyRow {
	line: string;
	/** Index into the filtered entries for command rows; -1 for headers. */
	entryIndex: number;
}

/** The static shortcuts block (violeta's overlays plus Pi's expand toggle). */
const SHORTCUTS: readonly { key: string; label: keyof typeof t.shortcuts }[] = [
	{ key: "alt+a", label: "agents" },
	{ key: "alt+g", label: "changes" },
	{ key: "alt+m", label: "models" },
	{ key: "alt+k", label: "palette" },
	{ key: "alt+s", label: "stop" },
	{ key: "ctrl+o", label: "expandTools" },
];

const sourceLabel = (source: PaletteSource): string =>
	source === "pi" ? t.sources.pi : source === "extension" ? t.sources.extension : source === "prompt" ? t.sources.prompt : t.sources.skill;

/** The overlay: title and search line, then the grouped command list (windowed
 * to `bodyBudget` body lines so the selection always stays visible), then the
 * static shortcuts block and the hint row. Narrow terminals get the same
 * single-column list, truncated to the width. */
export function renderPalette(
	entries: readonly PaletteEntry[],
	state: PaletteState,
	width: number,
	bodyBudget: number,
	fg: ViewFg,
): string[] {
	const filtered = filterEntries(entries, state.query);
	const selected = filtered[state.index];

	// Build every body line with its entry index so the window can keep the
	// selected row visible.
	const body: BodyRow[] = [];
	let lastGroup: PaletteGroup | undefined;
	for (let i = 0; i < filtered.length; i++) {
		const entry = filtered[i]!;
		if (entry.group !== lastGroup) {
			lastGroup = entry.group;
			body.push({ line: fg("dim", `── ${t.groups[entry.group]} ──`), entryIndex: -1 });
		}
		const marker = i === state.index ? fg("accent", "›") : " ";
		const name = fg(i === state.index ? "text" : "muted", `/${entry.name}`);
		const description = entry.description ? `  ${fg("dim", entry.description)}` : "";
		const source = ` · ${fg("dim", sourceLabel(entry.source))}`;
		const line = `${marker} ${name}${description}${source}`;
		body.push({ line: truncateToWidth(line, width), entryIndex: i });
	}

	// Window: keep the selected row inside the budget, centered when possible.
	const selectedIndex = body.findIndex((row) => row.entryIndex === state.index);
	const budget = Math.max(1, bodyBudget);
	let start = 0;
	if (body.length > budget) {
		start = Math.max(0, Math.min((selectedIndex < 0 ? 0 : selectedIndex) - Math.floor(budget / 2), body.length - budget));
	}
	const windowed = body.slice(start, start + budget);

	const lines: string[] = [];
	lines.push(fg("accent", t.title));
	lines.push(truncateToWidth(`${fg("accent", "›")} ${state.query}▌`, width));
	if (filtered.length === 0) {
		lines.push(fg("dim", t.empty));
	} else {
		lines.push(...windowed.map((row) => row.line));
	}
	lines.push("");
	lines.push(fg("dim", t.shortcutsTitle));
	for (const shortcut of SHORTCUTS) {
		lines.push(truncateToWidth(fg("dim", `  ${shortcut.key.padEnd(7)}${t.shortcuts[shortcut.label]}`), width));
	}
	lines.push(truncateToWidth(fg("dim", t.hint), width));
	return lines;
}
