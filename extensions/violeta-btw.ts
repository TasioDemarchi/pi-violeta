/**
 * violeta-btw — the side chat: `/btw` and `alt+b`.
 *
 * An aside. `/btw <question>` asks with the session's conversation as context
 * and the answer is shown in the fullscreen reader; the main agent never sees
 * the question and the session never takes a turn for it, so asking something
 * does not interrupt — or pollute — the work in progress.
 *
 * The reader is the only way to see the conversation. It is an overlay, so it
 * takes the keyboard focus and `j/k` scrolls it — a long answer fits there.
 * `/btw` with no question and `alt+b` open it too; nothing is drawn above the
 * editor and the sidebar no longer swaps.
 *
 * The request is one model call through `ctx.modelRegistry.complete`, which is
 * authenticated by Pi: no key handling here. It uses the session's current
 * model on purpose — the aside answers with the same head as the main thread.
 * The call is deliberately NOT awaited by the command handler: the reader says
 * `thinking…` and you keep typing in the main editor meanwhile.
 *
 * Nothing is persisted: the conversation is in memory and goes with the process.
 */

import type { ExtensionAPI, ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import {
	btwViewLayout,
	btwViewRows,
	initialBtwView,
	reduceBtwView,
	renderBtwView,
	type BtwViewAction,
	type BtwViewState,
	type Fg,
} from "../src/btw/view.ts";
import { blocksText, branchTurns, buildBtwPrompt, recentTurns } from "../src/btw/request.ts";
import { answerBtw, askBtw, emptyBtw, failBtw, openBtw, parseBtwArgs, type BtwState } from "../src/btw/state.ts";
import { btw as t } from "../src/i18n.ts";
import { setShared, subscribeShared } from "../src/shared-hub.ts";

export default function (pi: ExtensionAPI) {
	// Subagent children load this package too: an aside is for the person at the
	// keyboard, and there is nobody there.
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	let state: BtwState = emptyBtw();

	/** Publish so the reader repaints while an answer streams in. */
	function publish(): void {
		setShared({ btw: state });
	}

	function say(ctx: ExtensionContext, message: string, level: "info" | "warning" = "info"): void {
		if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.notify(message, level);
	}

	/** One question. Never throws: a failure becomes a turn in the reader,
	 * where it stays readable, instead of a notification that scrolls away. */
	async function ask(ctx: ExtensionContext, question: string): Promise<void> {
		// The history as it was BEFORE this question: the question itself is
		// passed on its own, so the prompt would otherwise carry it twice.
		const history = state.turns;
		state = askBtw(state, question);
		publish();

		const model = ctx.model;
		if (!model) {
			state = failBtw(state, t.noModel);
			publish();
			return;
		}
		try {
			const transcript = recentTurns(branchTurns(ctx.sessionManager.getBranch()));
			const prompt = buildBtwPrompt({ question, transcript, history });
			const answer = await ctx.modelRegistry.complete(model, {
				systemPrompt: t.systemPrompt,
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			});
			const text = blocksText(answer?.content).trim();
			// A model that settles without text is a failure, not an empty answer
			// (the same lesson the subagent runner learned the hard way).
			if (answer?.errorMessage) state = failBtw(state, t.failed(answer.errorMessage));
			else if (text === "") state = failBtw(state, t.failed(String(answer?.stopReason ?? "")));
			else state = answerBtw(state, text);
		} catch (error) {
			state = failBtw(state, t.failed(error instanceof Error ? error.message : String(error)));
		}
		publish();
	}

	/** The conversation in an overlay, scrollable because an overlay has focus.
	 * Read-only: it draws state, never changes it, so opening it mid-answer is
	 * safe — the reader keeps filling as the answer streams. */
	async function openReader(ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			// notify directly, not through `say`: `say` is silent without a UI,
			// which is exactly the case this branch has to report. Same shape as
			// the changes, jobs and palette overlays.
			ctx.ui.notify(t.overlayNeedsTui, "warning");
			return;
		}
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				const fg: Fg = (role, text) => theme.fg(role as ThemeColor, text);
				let view: BtwViewState = initialBtwView();
				let page = 1;
				let closed = false;
				const close = () => {
					if (closed) return;
					closed = true;
					done();
				};
				// Repaint while the answer streams in, so the reader is not a frozen
				// snapshot of a conversation that is still growing.
				const unsub = subscribeShared(() => tui.requestRender());
				return {
					invalidate() {},
					dispose() {
						unsub();
					},
					render(width: number): string[] {
						try {
							const layout = btwViewLayout(width, tui.terminal.rows);
							page = layout.bodyRows;
							return renderBtwView(view, btwViewRows(state, layout.width), layout, fg);
						} catch {
							// a broken reader must never break the editor
							return [];
						}
					},
					handleInput(data: string): void {
						const action: BtwViewAction | undefined =
							data === "k" || matchesKey(data, "up") ? "up"
							: data === "j" || matchesKey(data, "down") ? "down"
							: matchesKey(data, "ctrl+k") || matchesKey(data, "pageup") ? "pageUp"
							: matchesKey(data, "ctrl+j") || matchesKey(data, "pagedown") ? "pageDown"
							: data === "g" ? "top"
							: data === "G" ? "bottom"
							: matchesKey(data, "escape") || matchesKey(data, "esc") || data === "q" ? "close"
							: undefined;
						if (!action) return;
						view = reduceBtwView(view, action, page);
						if (view.closed) {
							close();
							return;
						}
						tui.requestRender();
					},
				} satisfies Component;
			},
			{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } },
		);
	}

	pi.registerCommand("btw", {
		description: t.description,
		handler: async (args: string, ctx: ExtensionContext) => {
			const command = parseBtwArgs(args);
			if (command.kind === "window") {
				state = openBtw(state);
				publish();
				say(ctx, t.opened);
				void openReader(ctx);
				return;
			}
			if (state.asking) {
				say(ctx, t.busy, "warning");
				return;
			}
			// Not awaited on purpose: the editor stays yours while it answers.
			// The reader opens on top, also without blocking the ask.
			void ask(ctx, command.message);
			void openReader(ctx);
		},
	});

	pi.registerShortcut("alt+b", {
		description: t.viewShortcut,
		handler: async (ctx) => openReader(ctx),
	});

	pi.on("session_start", async () => {
		state = emptyBtw();
		publish();
	});

	pi.on("session_shutdown", async () => {
		state = emptyBtw();
		publish();
	});
}
