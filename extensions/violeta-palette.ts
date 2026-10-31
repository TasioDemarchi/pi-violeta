/**
 * violeta-palette — the command palette (T5/S7).
 *
 * `alt+k` and `/palette` open a small overlay listing every available
 * command: violeta's own, prompt templates and skill commands from
 * `pi.getCommands()`, plus Pi's well-known built-in slash commands from the
 * deterministic table in src/palette/view.ts (getCommands does not expose
 * built-ins). Each row shows name, description and source; the list groups
 * Session / Interface / Tools / Other and filters as you type (substring,
 * case-insensitive, over name and description). While typing, letters go to
 * the query, so navigation uses the arrows and ctrl+n/ctrl+p. Enter closes
 * the palette and inserts `/<name> ` into the editor with
 * `ctx.ui.setEditorText` so the user presses Enter — the documented path:
 * no API executes a slash command directly (pi.sendUserMessage's
 * expandPromptTemplates dispatches extension commands, but it also starts a
 * model turn, which is wrong for UI commands like /sidebar). Esc is
 * two-step: it first clears a non-empty query, then closes. The bottom of
 * the overlay lists the keyboard shortcuts as a static block. Colors only
 * through theme roles. Subagent children (VIOLETA_AGENTS_CHILD=1) register
 * nothing.
 *
 * alt+k clashes with nothing: violeta registers alt+a, alt+s, alt+g and
 * alt+m, and Pi's default keybindings use no alt+k.
 */

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import {
	filterEntries,
	initialPaletteState,
	paletteEntries,
	reducePalette,
	renderPalette,
	type PaletteAction,
	type ViewFg,
} from "../src/palette/view.ts";
import { palette as t } from "../src/i18n.ts";

export default function (pi: ExtensionAPI) {
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	const openPalette = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			ctx.ui.notify(t.overlayNeedsTui, "warning");
			return;
		}
		// Every available command, fetched when the palette opens.
		const entries = paletteEntries(pi.getCommands());

		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				const fg: ViewFg = (role, text) => theme.fg(role as ThemeColor, text);
				let state = initialPaletteState();

				const component: Component = {
					invalidate() {},
					render(width: number): string[] {
						try {
							// Body budget: terminal minus title/search, the shortcuts
							// block and the hint row, so everything fits on screen.
							const budget = Math.max(4, tui.terminal.rows - 14);
							return renderPalette(entries, state, width, budget, fg);
						} catch {
							return [];
						}
					},
					handleInput(data: string): void {
						let action: PaletteAction | undefined;
						if (matchesKey(data, "escape")) action = { type: "escape" };
						else if (matchesKey(data, "enter")) action = { type: "select" };
						else if (matchesKey(data, "up") || matchesKey(data, "ctrl+p")) action = { type: "up" };
						else if (matchesKey(data, "down") || matchesKey(data, "ctrl+n")) action = { type: "down" };
						else if (matchesKey(data, "backspace")) action = { type: "backspace" };
						else if ([...data].every((char) => char.charCodeAt(0) >= 32)) action = { type: "insert", text: data };
						if (!action) return;
						const filtered = filterEntries(entries, state.query);
						state = reducePalette(state, action, filtered);
						if (state.closed) {
							done();
							if (state.chosen) {
								// The documented path: insert the command into the
								// editor and let the user press Enter.
								ctx.ui.setEditorText(`/${state.chosen} `);
								tui.requestRender();
							}
							return;
						}
						tui.requestRender();
					},
				};

				return component;
			},
			{ overlay: true, overlayOptions: { anchor: "center" } },
		);
	};

	pi.registerCommand("palette", {
		description: t.description,
		handler: async (_args: string, ctx: ExtensionContext) => openPalette(ctx),
	});

	pi.registerShortcut("alt+k", {
		description: t.shortcut,
		handler: async (ctx) => openPalette(ctx),
	});
}
