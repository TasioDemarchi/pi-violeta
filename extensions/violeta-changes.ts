/**
 * violeta-changes — the `/changes` command and `alt+g` overlay (T1/S1).
 *
 * A full-terminal viewer for the working tree: on the left the changed files
 * grouped created (+) / updated (~) / deleted (−) from `git status`, on the
 * right the diff of the selected file with a one-line `path · +A −D` header.
 * Diffs load lazily on selection: tracked files via `git diff HEAD -- <file>`,
 * untracked files as `+` lines of their content (binary files show a notice),
 * deleted files via their removed content. `o` opens the selected file in
 * $VISUAL/$EDITOR with the Pi external-editor handoff (stop the TUI, run the
 * editor with inherited stdio, restart the TUI).
 *
 * Pure rendering and key handling live in `src/changes-view/` (tested); this
 * file only wires data, theme and input. Subagent children register nothing.
 */

import { execFile } from "node:child_process";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { diffHead, readUntracked, statusFiles } from "../src/changes-view/git.ts";
import {
	capDiff,
	countDiff,
	isBinaryDiff,
	parseDiff,
	untrackedLines,
	type DiffData,
} from "../src/changes-view/diff.ts";
import {
	changeEntries,
	entryKey,
	initialOverlayState,
	overlayLayout,
	reduceOverlay,
	renderOverlay,
	type ChangeEntry,
	type OverlayAction,
	type ViewFg,
} from "../src/changes-view/view.ts";
import { changes as t, sidebar as sidebarT } from "../src/i18n.ts";

export default function (pi: ExtensionAPI) {
	// Subagent children have no UI; they register no overlay or shortcut.
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	const openOverlay = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			ctx.ui.notify(t.overlayNeedsTui, "warning");
			return;
		}
		// The file list refreshes on every open.
		const files = await statusFiles(ctx.cwd);
		if (!files) {
			ctx.ui.notify(sidebarT.noRepo, "info");
			return;
		}
		const cwd = ctx.cwd;
		const entries = changeEntries(files);
		const keys = entries.map(entryKey);

		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				const fg: ViewFg = (role, text) => theme.fg(role as ThemeColor, text);
				let state = initialOverlayState(entries);
				const cache = new Map<string, DiffData>();
				let loadingKey: string | undefined;

				const selected = (): ChangeEntry | undefined =>
					entries.find((entry) => entryKey(entry) === state.selectedKey) ?? entries[0];

				/** Lazy per-file diff load: untracked content as `+` lines, or
				 * `git diff HEAD -- <file>` for tracked and deleted files. */
				const loadDiff = async (entry: ChangeEntry): Promise<void> => {
					const key = entryKey(entry);
					loadingKey = key;
					let data: DiffData;
					if (entry.group === "created") {
						const content = await readUntracked(cwd, entry.path);
						const capped = capDiff(content.binary ? [] : untrackedLines(content.text));
						data = {
							path: entry.path,
							added: capped.lines.length,
							deleted: 0,
							binary: content.binary,
							truncated: capped.truncated,
							lines: capped.lines,
						};
					} else {
						const raw = await diffHead(cwd, entry.path);
						const capped = capDiff(parseDiff(raw));
						const counts = countDiff(capped.lines);
						data = {
							path: entry.path,
							added: counts.added,
							deleted: counts.deleted,
							binary: isBinaryDiff(raw),
							truncated: capped.truncated,
							lines: capped.lines,
						};
					}
					cache.set(key, data);
					loadingKey = undefined;
					if (state.selectedKey === key) tui.requestRender();
				};

				/** The documented external-editor handoff: stop the TUI, run the
				 * editor with inherited stdio (argument arrays, never a shell),
				 * restart the TUI when it exits. Same pattern as Pi's own
				 * ExtensionEditorComponent. */
				const openInEditor = (entry: ChangeEntry): void => {
					const command = process.env.VISUAL || process.env.EDITOR || (process.platform === "win32" ? "notepad" : "nano");
					const [program, ...editorArgs] = command.split(" ");
					if (!program) return;
					tui.stop();
					execFile(program, [...editorArgs, join(cwd, entry.path)], { stdio: "inherit" }, () => {
						tui.start();
						tui.requestRender(true);
					});
				};

				const close = (): void => {
					done();
				};

				const component: Component = {
					invalidate() {},
					dispose() {},
					render(width: number): string[] {
						try {
							const entry = selected();
							// Kick off the lazy diff load for the current selection.
							if (entry) {
								const key = entryKey(entry);
								if (!cache.has(key) && loadingKey !== key) void loadDiff(entry);
							}
							const diff = entry ? cache.get(entryKey(entry)) : undefined;
							return renderOverlay(entries, diff, state, overlayLayout(width, tui.terminal.rows), fg);
						} catch {
							// a broken overlay must never break the editor
							return [];
						}
					},
					handleInput(data: string): void {
						const action: OverlayAction | undefined =
							data === "k" || matchesKey(data, "up") ? "up"
							: data === "j" || matchesKey(data, "down") ? "down"
							: matchesKey(data, "ctrl+j") ? "scrollDown"
							: matchesKey(data, "ctrl+k") ? "scrollUp"
							: data === "g" ? "top"
							: data === "G" ? "bottom"
							: data === "o" ? "openEditor"
							: matchesKey(data, "enter") ? "open"
							: matchesKey(data, "escape") || matchesKey(data, "esc") ? "back"
							: data === "q" ? "close"
							: undefined;
						if (!action) return;
						if (action === "openEditor") {
							const entry = selected();
							if (entry) openInEditor(entry);
							return;
						}
						state = reduceOverlay(state, action, keys);
						if (state.closed) {
							close();
							return;
						}
						tui.requestRender();
					},
				};
				return component;
			},
			{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } },
		);
	};

	pi.registerCommand("changes", {
		description: t.description,
		handler: async (_args: string, ctx: ExtensionContext) => openOverlay(ctx),
	});

	pi.registerShortcut("alt+g", {
		description: t.shortcut,
		handler: async (ctx) => openOverlay(ctx),
	});
}
