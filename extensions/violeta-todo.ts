/**
 * violeta-todo — the todo tool and its card above the editor (T2/S6).
 *
 * The tool is the single model entry point: write|add|update|clear|list backed
 * by the pure reducer in `src/todo/store.ts`. Every successful call returns
 * the compact rendering of the current list; every rejected call leaves the
 * list unchanged and reports `Error: <reason>`.
 *
 * The list is persisted as one custom session entry (`violeta-todo`) per
 * mutating call and restored from the branch on session_start, so /resume
 * brings it back and /new starts empty.
 *
 * The card lives above the editor under its own widget key ("todo-card"), so
 * it coexists with the agents card and the activity line. `/todo` toggles the
 * card (in memory). The card hides itself when the list is empty, and one
 * minute after every task is done/dropped — the only timer is the one-shot
 * tick at the end of that hide window, unref'd and cleaned on shutdown.
 */

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { cardVisible, renderTodoCard, TODO_HIDE_MS, type CardFg } from "../src/todo/card.ts";
import { TODO_ENTRY_TYPE, replayTodo, todoSnapshot } from "../src/todo/persist.ts";
import { applyTodo, doneCount, emptyTodo, openCount, type TodoParams, type TodoState } from "../src/todo/store.ts";

const WIDGET_KEY = "todo-card";

const StatusParam = Type.Optional(
	Type.Union(
		[
			Type.Literal("pending"),
			Type.Literal("in_progress"),
			Type.Literal("blocked"),
			Type.Literal("done"),
			Type.Literal("dropped"),
		],
		{ description: "Defaults to pending. blocked: open but waiting on something outside the list (requires a note); dropped: will not be done, on purpose." },
	),
);

export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner load this package too: no todo
	// tool and no card there (same guard as the agents extension).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	let state: TodoState = emptyTodo();
	let visible = true; // /todo toggle, in memory only
	let tuiRef: TUI | undefined;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;

	function requestRender(): void {
		tuiRef?.requestRender();
	}

	/** One-shot tick when the hide window closes; only armed while it is pending. */
	function armHideTimer(): void {
		if (hideTimer) {
			clearTimeout(hideTimer);
			hideTimer = undefined;
		}
		if (state.settledAt === undefined) return;
		const remaining = state.settledAt + TODO_HIDE_MS - Date.now();
		if (remaining <= 0) {
			requestRender();
			return;
		}
		hideTimer = setTimeout(() => {
			hideTimer = undefined;
			requestRender();
		}, remaining);
		hideTimer.unref();
	}

	function stopHideTimer(): void {
		if (hideTimer) {
			clearTimeout(hideTimer);
			hideTimer = undefined;
		}
	}

	pi.registerTool({
		name: "todo",
		label: "Todo",
		description:
			"Plan and track multi-step work. Use write to set the whole list, add for a new task, update to move one task by id, clear to reset, list to read it back.",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("write"),
					Type.Literal("add"),
					Type.Literal("update"),
					Type.Literal("clear"),
					Type.Literal("list"),
				],
				{ description: "write replaces the whole list; add appends one task; update changes one task by id; clear empties the list; list reports it." },
			),
			tasks: Type.Optional(
				Type.Array(
					Type.Object({
						id: Type.Optional(Type.Integer({ description: "Existing task id to keep (write only); omit it for new tasks." })),
						title: Type.String({ description: "Short imperative title, e.g. 'Write the parser'." }),
						status: StatusParam,
						note: Type.Optional(Type.String({ description: "Extra context shown on the card; required when status is blocked, naming what it waits for." })),
					}),
					{ description: "For write: the complete ordered list. Keep the id of tasks that already exist; omit it for new ones." },
				),
			),
			id: Type.Optional(Type.Integer({ description: "Task id for update." })),
			title: Type.Optional(Type.String({ description: "Title for add, or a new title for update." })),
			status: StatusParam,
			note: Type.Optional(Type.String({ description: "Note for add or update; required when the resulting status is blocked." })),
		}),
		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const result = applyTodo(state, params as TodoParams, Date.now());
			if (result.error !== undefined) {
				return {
					content: [{ type: "text" as const, text: result.text }],
					details: { error: result.error },
					isError: true,
				};
			}
			state = result.state;
			if (params.action !== "list") pi.appendEntry(TODO_ENTRY_TYPE, todoSnapshot(state));
			armHideTimer();
			requestRender();
			return {
				content: [{ type: "text" as const, text: result.text }],
				details: { total: state.tasks.length, open: openCount(state.tasks), done: doneCount(state.tasks) },
			};
		},
	});

	pi.registerCommand("todo", {
		description: "Toggle the todo card above the editor",
		handler: async (_args: string, ctx: ExtensionContext) => {
			visible = !visible;
			if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.notify(visible ? "Todo card shown." : "Todo card hidden.", "info");
			requestRender();
		},
	});

	pi.on("session_start", async (event, ctx) => {
		// Restore the list from the branch: the last violeta-todo entry wins, so
		// /resume brings the list back and /new (no entries yet) starts empty.
		state = replayTodo(ctx.sessionManager.getBranch());
		visible = true;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		ctx.ui.setWidget(
			WIDGET_KEY,
			(tui, theme) => {
				tuiRef = tui;
				return todoCardComponent(theme);
			},
			{ placement: "aboveEditor" },
		);
		armHideTimer();
		void event;
	});

	function todoCardComponent(theme: Theme): Component {
		const fg: CardFg = (role, text) => theme.fg(role as ThemeColor, text);
		return {
			invalidate() {},
			render(width: number): string[] {
				try {
					if (!visible) return [];
					const now = Date.now();
					if (!cardVisible(state, now)) return [];
					const lines = renderTodoCard(state, { width, now }, fg);
					return lines.length > 0 ? [...lines, ""] : [];
				} catch {
					// a broken card must never break the editor
					return [];
				}
			},
		};
	}

	pi.on("session_shutdown", async (_event, ctx) => {
		// The card goes with the session: stop the hide timer and drop the widget.
		stopHideTimer();
		state = emptyTodo();
		visible = true;
		tuiRef = undefined;
		if (ctx.mode === "tui" && ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
	});
}
