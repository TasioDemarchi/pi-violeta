/**
 * violeta-agents — the neutral subagent engine for violeta.
 *
 * Registers five model-callable tools backed by `src/agents/`:
 * - `subagent_list_agents`: definitions from `${PI_CODING_AGENT_DIR}/agents/*.md`
 * - `subagent_run`: launch one child `pi --mode rpc` ("task" mode waits and
 *   returns the answer; "background" returns the task id and the result is
 *   delivered later as a custom message that starts a turn when idle)
 * - `subagent_status` / `subagent_result` / `subagent_cancel`
 *
 * The engine is neutral: no roles, no ODD, no philosophy. It ships no agent
 * definitions; users create their own markdown files.
 *
 * Views (the card above the editor and the alt+a overlay, built separately)
 * consume `getAgentStore()` from `src/agents/store.ts`.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { FINISHED_TTL_MS, renderAgentsCard, type CardFg } from "../src/agents/card.ts";
import { listAgentDefinitions, type AgentDefinition } from "../src/agents/definitions.ts";
import { loadTaskHistory } from "../src/agents/history.ts";
import { SubagentRunner } from "../src/agents/runner.ts";
import { displayTitle } from "../src/agents/summary.ts";
import { isFinished, getAgentStore, type AgentTask } from "../src/agents/store.ts";
import { compactRenderers } from "../src/tools-view/compact.ts";
import { agents as t } from "../src/i18n.ts";
import {
	initialOverlayState,
	overlayLayout,
	overlayTasks,
	reduceOverlay,
	renderOverlay,
	type OverlayAction,
	type ViewFg,
} from "../src/agents/view.ts";

const AGENTS_DIR = "agents";
const HISTORY_DIR = "agents-history";
const AGENTS_WIDGET_KEY = "agents-card";

const ModeParam = Type.Optional(
	Type.Union([Type.Literal("task"), Type.Literal("background")], {
		description: "\"task\" (default): wait for the child and return its answer. \"background\": return the task id now; the result is delivered later.",
	}),
);

const IdParam = Type.String({ description: "Task id, as returned by subagent_run." });

export default function (pi: ExtensionAPI) {
	// Recursion guard: children spawned by the runner load this package too, so
	// they register no subagent tools and no card/shortcut (VIOLETA_AGENTS_CHILD
	// is set by the runner's child environment).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	const store = getAgentStore();
	let runner: SubagentRunner | undefined;
	let runnerCwd: string | undefined;
	let historyLoaded = false;
	let exitHooked = false;

	const agentDir = (): string | undefined => {
		const dir = process.env.PI_CODING_AGENT_DIR;
		return dir && dir.trim() !== "" ? dir : undefined;
	};

	function listDefinitions(): { definitions: AgentDefinition[]; errors: Array<{ source: string; message: string }> } {
		const dir = agentDir();
		return dir ? listAgentDefinitions(join(dir, AGENTS_DIR)) : { definitions: [], errors: [] };
	}

	function deliverBackgroundResult(task: AgentTask, mode: "task" | "background"): void {
		// Keep it simple: one custom message that starts a turn when idle. The
		// model then sees the result on its next turn without polling.
		if (mode !== "background" || task.status === "aborted") return;
		pi.sendMessage(
			{
				customType: "violeta-subagent-result",
				content: `${t.finishedMessage(displayTitle(task), task.name, task.id, t.statuses[task.status] ?? task.status)}\n\n${task.result ?? task.error ?? t.noOutput}`,
				display: true,
				details: { taskId: task.id, name: task.name, title: displayTitle(task), status: task.status, tokens: task.tokens, cost: task.cost },
			},
			{ triggerTurn: true },
		);
	}

	/** A ceiling override from the environment: it wins over every definition, so
	 * ceilings can be retuned for a whole run without editing agent files. */
	function positiveEnv(name: string): number | undefined {
		const value = Number.parseInt(process.env[name] ?? "", 10);
		return Number.isFinite(value) && value >= 1 ? value : undefined;
	}

	function getRunner(cwd: string): SubagentRunner {
		if (runner && runnerCwd === cwd) return runner;
		runner?.killAll();
		const configured = Number.parseInt(process.env.VIOLETA_AGENTS_MAX_CONCURRENCY ?? "", 10);
		runner = new SubagentRunner(store, {
			agentDir: agentDir(),
			cwd,
			maxConcurrency: Number.isFinite(configured) && configured >= 1 ? configured : undefined,
			maxTurns: positiveEnv("VIOLETA_AGENT_MAX_TURNS"),
			maxTokens: positiveEnv("VIOLETA_AGENT_MAX_TOKENS"),
			onSettled: deliverBackgroundResult,
		});
		runnerCwd = cwd;
		if (!exitHooked) {
			exitHooked = true;
			// Children are detached, so a plain exit handler must kill the tree.
			process.on("exit", () => runner?.killAll());
		}
		return runner;
	}

	function summarize(task: AgentTask): Record<string, unknown> {
		return {
			id: task.id,
			name: task.name,
			title: displayTitle(task),
			label: task.label,
			status: task.status,
			model: task.model,
			effort: task.effort,
			tokens: task.tokens,
			turns: task.turns,
			...(task.stoppedBy ? { stoppedBy: task.stoppedBy } : {}),
			cost: task.cost,
			endedAt: task.endedAt ?? null,
			summary: task.summary,
			error: task.error,
		};
	}

	function taskText(task: AgentTask): string {
		return `${displayTitle(task)} — ${task.name} (${task.id}): ${t.statuses[task.status] ?? task.status}${task.error ? ` — ${task.error}` : ""}`;
	}

	pi.registerTool({
		name: "subagent_list_agents",
		label: "List subagents",
		description: "List the available subagent definitions (markdown files in the agent directory) with their names, descriptions, models and tools.",
		parameters: Type.Object({}),
		async execute() {
			const { definitions, errors } = listDefinitions();
			const lines = definitions.map((def) =>
				`- ${def.name}${def.description ? `: ${def.description}` : ""} (model: ${def.model}${def.thinking ? `, thinking: ${def.thinking}` : ""}${def.tools.length ? `, tools: ${def.tools.join(", ")}` : ""})`,
			);
			for (const error of errors) lines.push(`- ! ${error.source}: ${error.message}`);
			const text = lines.length > 0 ? lines.join("\n") : t.noDefinitions;
			return { content: [{ type: "text" as const, text }], details: { count: definitions.length, errors } };
		},

		// `✓ subagent_list_agents · 3` (display-only, T2/S2).
		...compactRenderers("subagent_list_agents", {
			extra: (result) => {
				const count = (result.details as { count?: number } | undefined)?.count;
				return typeof count === "number" ? [{ text: String(count) }] : [];
			},
		}),
	});

	pi.registerTool({
		name: "subagent_run",
		label: "Run subagent",
		description: "Launch a subagent as a child pi process using one of the definitions from subagent_list_agents. Mode \"task\" waits and returns the final answer; mode \"background\" returns the task id immediately and the result is delivered later as a message.",
		parameters: Type.Object({
			agent: Type.String({ description: "Name of the agent definition to run (from subagent_list_agents)." }),
			task: Type.String({ description: "What the subagent should do." }),
			label: Type.String({ description: "what this agent does, 3 to 6 words, phrased as an action" }),
			context: Type.Optional(Type.String({ description: "Extra context the subagent needs (paths, constraints, prior findings)." })),
			mode: ModeParam,
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			const { definitions } = listDefinitions();
			const definition = definitions.find((def) => def.name === params.agent);
			if (!definition) {
				const available = definitions.map((def) => def.name).join(", ") || t.noneAvailable;
				return {
					content: [{ type: "text" as const, text: t.unknownAgent(params.agent, available) }],
					details: { error: "unknown agent" },
					isError: true,
				};
			}
			const started = getRunner(ctx.cwd).start(definition, {
				task: params.task,
				label: params.label,
				context: params.context,
				mode: params.mode ?? "task",
			});
			if ((params.mode ?? "task") === "background") {
				return {
					content: [{ type: "text" as const, text: t.backgroundStarted(params.agent, started.id) }],
					details: { taskId: started.id, mode: "background" },
				};
			}
			const finished = await runnerWait(started.id, signal);
			if (!finished) {
				// The caller aborted (Esc): stop the child instead of leaving it
				// running unattended.
				store.cancel(started.id);
				return {
					content: [{ type: "text" as const, text: t.cancelledByCaller(params.agent, started.id) }],
					details: { taskId: started.id, cancelled: true },
					isError: true,
				};
			}
			// A ceiling stop is a planned handoff, not an error: the caller gets the
			// partial answer plus what continues it. Flagging it as an error would
			// invite the caller to retry the same oversized unit instead of splitting it.
			if (finished.status === "budget") {
				const head = t.budgetStopped(finished.stoppedBy ?? "maxTurns", finished.turns, finished.tokens);
				return {
					content: [{ type: "text" as const, text: `${head}\n\n${finished.result ?? t.noAnswer}` }],
					details: {
						taskId: finished.id,
						status: finished.status,
						stoppedBy: finished.stoppedBy,
						turns: finished.turns,
						tokens: finished.tokens,
						cost: finished.cost,
					},
				};
			}
			return {
				content: [{ type: "text" as const, text: finished.status === "completed" ? finished.result ?? t.noAnswer : `${taskText(finished)}` }],
				details: { taskId: finished.id, status: finished.status, tokens: finished.tokens, turns: finished.turns, cost: finished.cost, error: finished.error },
				isError: finished.status !== "completed",
			};
		},

		// `✓ subagent_run coder Fix the login bug · completado`, the status word in
		// the active language (display-only, T2/S2).
		...compactRenderers("subagent_run", {
			extra: (result) => {
				const status = (result.details as { status?: string } | undefined)?.status;
				return status ? [{ text: t.statuses[status] ?? status }] : [];
			},
		}),
	});

	async function runnerWait(id: string, signal: AbortSignal | undefined): Promise<AgentTask | undefined> {
		if (!runner) return undefined;
		const wait = runner.waitFor(id);
		if (!signal) return wait;
		const aborted = new Promise<undefined>((resolve) => {
			if (signal.aborted) resolve(undefined);
			else signal.addEventListener("abort", () => resolve(undefined), { once: true });
		});
		return Promise.race([wait, aborted]);
	}

	pi.registerTool({
		name: "subagent_status",
		label: "Subagent status",
		description: "Report the status of one subagent task (by id) or of all tasks.",
		parameters: Type.Object({ id: Type.Optional(IdParam) }),
		async execute(_id, params) {
			if (params.id) {
				const task = store.get(params.id);
				const text = task ? JSON.stringify(summarize(task), null, 2) : t.unknownTaskId(params.id);
				return { content: [{ type: "text" as const, text }], details: { found: !!task }, isError: !task };
			}
			const tasks = store.list();
			const text = tasks.length > 0 ? tasks.map(taskText).join("\n") : t.noTasksYet;
			return { content: [{ type: "text" as const, text }], details: { count: tasks.length, active: store.activeCount() } };
		},

		// `✓ subagent_status · 2` (display-only, T2/S2).
		...compactRenderers("subagent_status", {
			extra: (result) => {
				const count = (result.details as { count?: number } | undefined)?.count;
				return typeof count === "number" ? [{ text: String(count) }] : [];
			},
		}),
	});

	pi.registerTool({
		name: "subagent_result",
		label: "Subagent result",
		description: "Get the final answer of a finished subagent task (or its current status if it is still running).",
		parameters: Type.Object({ id: IdParam }),
		async execute(_id, params) {
			const task = store.get(params.id);
			if (!task) {
				return { content: [{ type: "text" as const, text: t.unknownTaskId(params.id) }], details: { found: false }, isError: true };
			}
			if (task.status === "queued" || task.status === "running") {
				return { content: [{ type: "text" as const, text: `${taskText(task)} ${t.noResultYet}` }], details: { found: true, status: task.status } };
			}
			const body = task.status === "completed" ? task.result ?? t.noAnswer : task.error ?? t.taskStatusWord(task.status);
			return {
				content: [{ type: "text" as const, text: `${displayTitle(task)} — ${task.name} (${task.id}) ${task.status}:\n\n${body}` }],
				details: { found: true, status: task.status, title: displayTitle(task), summary: task.summary, tokens: task.tokens, cost: task.cost },
				isError: task.status !== "completed",
			};
		},

		// `✓ subagent_result task-1` (display-only, T2/S2).
		...compactRenderers("subagent_result"),
	});

	pi.registerTool({
		name: "subagent_cancel",
		label: "Cancel subagent",
		description: "Cancel a running or queued subagent task (SIGTERM, then SIGKILL if it does not exit).",
		parameters: Type.Object({ id: IdParam }),
		async execute(_id, params) {
			const cancelled = store.cancel(params.id);
			const text = cancelled
				? t.cancelled(params.id)
				: t.notCancellable(params.id);
			return { content: [{ type: "text" as const, text }], details: { cancelled }, isError: !cancelled };
		},

		// `✓ subagent_cancel task-1` (display-only, T2/S2).
		...compactRenderers("subagent_cancel"),
	});

	// --- Views: the card above the editor and the alt+a · /agents overlay ---

	let tuiRef: TUI | undefined;
	let cardUnsubscribe: (() => void) | undefined;
	let cardTimer: ReturnType<typeof setInterval> | undefined;
	let cardExpiryTimer: ReturnType<typeof setTimeout> | undefined;

	const cardFg = (theme: Theme): CardFg => (role, text) => theme.fg(role as ThemeColor, text);

	function requestRender(): void {
		tuiRef?.requestRender();
	}

	function stopCardTimers(): void {
		if (cardTimer) {
			clearInterval(cardTimer);
			cardTimer = undefined;
		}
		if (cardExpiryTimer) {
			clearTimeout(cardExpiryTimer);
			cardExpiryTimer = undefined;
		}
	}

	/** One frame when the next finished row leaves the card (TTL). */
	function armCardExpiry(): void {
		if (cardExpiryTimer) {
			clearTimeout(cardExpiryTimer);
			cardExpiryTimer = undefined;
		}
		if (store.activeCount() > 0) return;
		const now = Date.now();
		const deadlines = store
			.list()
			.filter((task) => isFinished(task.status) && task.endedAt !== undefined)
			.map((task) => task.endedAt! + FINISHED_TTL_MS - now)
			.filter((ms) => ms > 0);
		if (deadlines.length === 0) return;
		cardExpiryTimer = setTimeout(() => {
			cardExpiryTimer = undefined;
			requestRender();
			armCardExpiry();
		}, Math.max(1, Math.min(...deadlines)));
		cardExpiryTimer.unref();
	}

	/** The 1-second elapsed clock: only while something is running. */
	function ensureCardTimers(): void {
		if (cardTimer) return;
		cardTimer = setInterval(() => {
			requestRender();
			if (store.activeCount() === 0) {
				stopCardTimers();
				armCardExpiry();
			}
		}, 1000);
		cardTimer.unref();
	}

	function agentsCardComponent(theme: Theme): Component {
		return {
			invalidate() {},
			render(width: number): string[] {
				try {
					const lines = renderAgentsCard(
						store.list(),
						{ width, rows: tuiRef?.terminal?.rows, now: Date.now() },
						cardFg(theme),
					);
					return lines.length > 0 ? [...lines, ""] : [];
				} catch {
					// a broken card must never break the editor
					return [];
				}
			},
		};
	}

	function agentsOverlayComponent(tui: TUI, theme: Theme, done: () => void): Component {
		const ids = (): string[] => overlayTasks(store.list()).map((task) => task.id);
		let state = initialOverlayState(ids());
		const unsubscribe = store.subscribe(() => tui.requestRender());
		const timer = setInterval(() => tui.requestRender(), 1000);
		timer.unref();
		const fg: ViewFg = (role, text) => theme.fg(role as ThemeColor, text);
		const close = (): void => {
			clearInterval(timer);
			unsubscribe();
			done();
		};
		return {
			invalidate() {},
			dispose() {
				clearInterval(timer);
				unsubscribe();
			},
			render(width: number): string[] {
				try {
					const live = ids();
					if (state.selectedId && !live.includes(state.selectedId)) {
						state = { ...state, selectedId: live[0] };
					}
					return renderOverlay(store.list(), state, overlayLayout(width, tui.terminal.rows), Date.now(), fg);
				} catch {
					return [];
				}
			},
			handleInput(data: string): void {
				const action: OverlayAction | undefined =
					matchesKey(data, "up") || data === "k" ? "up"
					: matchesKey(data, "down") || data === "j" ? "down"
					: matchesKey(data, "ctrl+j") ? "scrollDown"
					: matchesKey(data, "ctrl+k") ? "scrollUp"
					: data === "f" ? "follow"
					: matchesKey(data, "enter") ? "open"
					: matchesKey(data, "escape") || matchesKey(data, "esc") ? "back"
					: data === "q" ? "close"
					: undefined;
				if (!action) return;
				state = reduceOverlay(state, action, ids());
				if (state.closed) {
					close();
					return;
				}
				tui.requestRender();
			},
		};
	}

	const openOverlay = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify(t.overlayNeedsTui, "warning");
			return;
		}
		// Closing the overlay never cancels the children: done() only disposes it.
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => agentsOverlayComponent(tui, theme, done),
			{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } },
		);
	};

	const stopAllActive = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui") return;
		const count = store.activeCount();
		if (count === 0) {
			ctx.ui.notify(t.stopNone, "info");
			return;
		}
		// select instead of confirm so the OPTIONS are Spanish; only "Sí" approves.
		const confirmed = (await ctx.ui.select(`${t.stopTitle}\n${t.stopBody(count)}`, [t.yes, t.no])) === t.yes;
		if (!confirmed) return;
		const cancelled = store.cancelAll();
		ctx.ui.notify(t.stopCancelled(cancelled), "info");
	};

	pi.registerCommand("agents", {
		description: t.agentsDescription,
		handler: async (_args: string, ctx: ExtensionContext) => openOverlay(ctx),
	});

	pi.registerShortcut("alt+a", {
		description: t.shortcutOverlay,
		handler: async (ctx) => openOverlay(ctx),
	});

	pi.registerShortcut("alt+s", {
		description: t.shortcutStop,
		handler: async (ctx) => stopAllActive(ctx),
	});

	pi.on("session_start", async (event, ctx) => {
		// Finished tasks reload into the store so the views can show history.
		const dir = agentDir();
		if (dir && !historyLoaded) {
			historyLoaded = true;
			store.history(loadTaskHistory(join(dir, HISTORY_DIR)));
		}
		// The card lives above the editor, TUI mode only.
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		ctx.ui.setWidget(
			AGENTS_WIDGET_KEY,
			(tui, theme) => {
				tuiRef = tui;
				return agentsCardComponent(theme);
			},
			{ placement: "aboveEditor" },
		);
		if (!cardUnsubscribe) {
			cardUnsubscribe = store.subscribe(() => {
				requestRender();
				ensureCardTimers();
			});
		}
		ensureCardTimers();
		armCardExpiry();
		void event;
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		// Closing violeta stops running children (SIGKILL; no graceful wait).
		runner?.killAll();
		// And the card goes with the session: unsubscribe and stop the clock.
		if (ctx.mode === "tui") {
			stopCardTimers();
			cardUnsubscribe?.();
			cardUnsubscribe = undefined;
			tuiRef = undefined;
			if (ctx.hasUI) ctx.ui.setWidget(AGENTS_WIDGET_KEY, undefined);
		}
	});
}
