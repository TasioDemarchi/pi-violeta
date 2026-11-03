/**
 * violeta-btw — the side chat: `/btw` and `/btwn`.
 *
 * An aside. `/btw <question>` asks with the session's conversation as context
 * and the answer lands in its own framed window; the main agent never sees the
 * question and the session never takes a turn for it, so asking something does
 * not interrupt — or pollute — the work in progress. `/btwn` is the same window
 * with no memory and no context: a clean question.
 *
 * Where the window is drawn is decided elsewhere, by whoever owns the space:
 * while the sidebar is active violeta-ui draws the panel in the sidebar column
 * (the sidebar BECOMES the chat), and this extension's widget above the editor
 * draws nothing. When there is no sidebar the widget draws the same panel. Both
 * read the same state from the shared hub and call the same renderer, so the two
 * placements cannot drift.
 *
 * The request is one model call through `ctx.modelRegistry.complete`, which is
 * authenticated by Pi: no key handling here. It uses the session's current
 * model on purpose — the aside answers with the same head as the main thread.
 * The call is deliberately NOT awaited by the command handler: the panel says
 * `pensando…` and you keep typing in the main editor meanwhile.
 *
 * Nothing is persisted: the conversation is in memory and goes with the process.
 */

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { renderBtwPanel, type Fg } from "../src/btw/panel.ts";
import { blocksText, branchTurns, buildBtwPrompt, recentTurns } from "../src/btw/request.ts";
import {
	answerBtw,
	askBtw,
	clearBtw,
	emptyBtw,
	failBtw,
	parseBtwArgs,
	toggleBtw,
	type BtwState,
} from "../src/btw/state.ts";
import { btw as t } from "../src/i18n.ts";
import { getShared, setShared, subscribeShared } from "../src/shared-hub.ts";

const WIDGET_KEY = "btw-panel";

export default function (pi: ExtensionAPI) {
	// Subagent children load this package too: an aside is for the person at the
	// keyboard, and there is nobody there.
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	let state: BtwState = emptyBtw();
	let tuiRef: TUI | undefined;

	/** Publish for violeta-ui (it draws the panel in the sidebar) and repaint. */
	function publish(): void {
		setShared({ btw: state });
		tuiRef?.requestRender();
	}

	function say(ctx: ExtensionContext, message: string, level: "info" | "warning" = "info"): void {
		if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.notify(message, level);
	}

	/** One question. `withContext` is false for /btwn, which asks as if the
	 * session did not exist. Never throws: a failure becomes a turn in the panel,
	 * where it stays readable, instead of a notification that scrolls away. */
	async function ask(ctx: ExtensionContext, question: string, withContext: boolean): Promise<void> {
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
			const transcript = withContext ? recentTurns(branchTurns(ctx.sessionManager.getBranch())) : [];
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

	pi.registerCommand("btw", {
		description: t.description,
		handler: async (args: string, ctx: ExtensionContext) => {
			const command = parseBtwArgs(args);
			if (command.kind === "window") {
				state = toggleBtw(state);
				publish();
				say(ctx, state.open ? t.opened : t.closed);
				return;
			}
			if (state.asking) {
				say(ctx, t.busy, "warning");
				return;
			}
			// Not awaited on purpose: the editor stays yours while it answers.
			void ask(ctx, command.message, true);
		},
	});

	pi.registerCommand("btwn", {
		description: t.descriptionNew,
		handler: async (args: string, ctx: ExtensionContext) => {
			const command = parseBtwArgs(args);
			if (state.asking && command.kind === "ask") {
				say(ctx, t.busy, "warning");
				return;
			}
			state = clearBtw(state);
			if (command.kind === "window") {
				publish();
				say(ctx, t.cleared);
				return;
			}
			void ask(ctx, command.message, false);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		state = emptyBtw();
		publish();
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		// Repaint when the sidebar flag flips (/sidebar, a resize across the
		// width threshold): the window must move between the two placements
		// without a restart.
		const unsub = subscribeShared(() => tuiRef?.requestRender());
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				tuiRef = tui;
				return panelComponent(theme, unsub);
			},
			{ placement: "aboveEditor" },
		);
	});

	function panelComponent(theme: Theme, onDispose: () => void): Component {
		const fg: Fg = (role, text) => theme.fg(role as ThemeColor, text);
		return {
			invalidate() {},
			dispose() {
				onDispose();
			},
			render(width: number): string[] {
				try {
					if (!state.open) return [];
					// While the sidebar is active it owns the window; drawing it
					// here too would show the same chat twice.
					if (getShared().sidebarActive === true) return [];
					return [...renderBtwPanel(state, { width }, fg), ""];
				} catch {
					// a broken panel must never break the editor
					return [];
				}
			},
		};
	}

	pi.on("session_shutdown", async (_event, ctx) => {
		state = emptyBtw();
		publish();
		tuiRef = undefined;
		if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
	});
}
