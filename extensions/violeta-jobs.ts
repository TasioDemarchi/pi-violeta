/**
 * violeta-jobs — background jobs and monitors (T3/S7).
 *
 * Tools:
 * - `bash_background`: runs `bash -c <command>` detached (own process group)
 *   and returns the job id and output file at once; when the process exits the
 *   model is woken ONCE with a `violeta-job-result` message (exit code/signal,
 *   duration, last 20 lines, output path). Never poll.
 * - `monitor`: every output line becomes an event (`violeta-job-event`),
 *   batched within 200 ms, at most 20 lines per notice; auto-stops at its
 *   mandatory timeout or on a flood (more than 120 lines in 60 s) and says why.
 * - `job_list` / `job_stop`: the list (running first, newest first) and the
 *   process-tree kill. At most 25 jobs run at once; finished records stay in
 *   memory (cap 100).
 *
 * `/jobs` opens the overlay (j/k select, s stop after confirm, q/esc close)
 * and a one-line `jobs: N running` indicator sits above the editor while
 * anything runs (own widget key, next to the agents and todo cards).
 *
 * Every start goes through the guard first: violeta-guard covers these tool
 * names (SHELL_COMMAND_TOOLS), so destructive commands and outside-project
 * paths are checked exactly like bash. Children (VIOLETA_AGENTS_CHILD=1)
 * register nothing here, and every running job is killed on session_shutdown
 * and on process exit, so no background process outlives its session.
 */

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { createMonitorController, type MonitorNotice } from "../src/jobs/monitors.ts";
import { JobRegistry, MAX_RUNNING_JOBS, type JobRecord } from "../src/jobs/registry.ts";
import { jobExitNotice, jobStartText, monitorEventsNotice, monitorStartText, monitorStoppedNotice } from "../src/jobs/notices.ts";
import { indicatorLine, initialOverlayState, listText, orderedJobs, reduceOverlay, renderJobOverlay, type OverlayAction } from "../src/jobs/view.ts";
import { compactRenderers } from "../src/tools-view/compact.ts";
import { jobs as t } from "../src/i18n.ts";

const INDICATOR_KEY = "jobs-indicator";
const OVERLAY_REFRESH_MS = 500;

export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner are non-interactive: no job tools,
	// no overlay, no indicator, and no background processes can outlive them.
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	let tuiRef: TUI | undefined;
	let unsubscribe: (() => void) | undefined;
	let exitHooked = false;

	const registry = new JobRegistry({
		onSettled: (job) => deliverExit(job),
	});

	const monitors = createMonitorController({
		registry,
		now: () => Date.now(),
		schedule: (fn, ms) => {
			const timer = setTimeout(fn, ms);
			timer.unref?.();
			return () => clearTimeout(timer);
		},
		deliver: (notice) => deliverMonitorNotice(notice),
	});

	function deliverMonitorNotice(notice: MonitorNotice): void {
		const text = notice.kind === "events" ? monitorEventsNotice(notice.job, notice.batch) : monitorStoppedNotice(notice.job, notice.reason);
		pi.sendMessage(
			{
				customType: "violeta-job-event",
				content: text,
				display: true,
				details: { jobId: notice.job.id, kind: notice.kind, reason: notice.kind === "stopped" ? notice.reason : undefined },
			},
			{ triggerTurn: true },
		);
	}

	/** One wake per job that ends on its own; a stopped job never gets here. */
	function deliverExit(job: JobRecord): void {
		if (job.kind === "monitor") monitors.finish(job); // flush pending lines first
		pi.sendMessage(
			{
				customType: "violeta-job-result",
				content: jobExitNotice(job),
				display: true,
				details: { jobId: job.id, kind: job.kind, status: job.status, exitCode: job.exitCode ?? null, signal: job.signal ?? null, outputPath: job.outputPath },
			},
			{ triggerTurn: true },
		);
	}

	function error(text: string): { content: Array<{ type: "text"; text: string }>; details: { error: string }; isError: true } {
		return { content: [{ type: "text", text }], details: { error: text }, isError: true };
	}

	const text = (value: string, details: Record<string, unknown> = {}) => ({ content: [{ type: "text" as const, text: value }], details });

	function startJob(command: string, cwd: string, label: string | undefined, kind: "job" | "monitor", timeoutSeconds?: number): JobRecord {
		return kind === "monitor"
			? monitors.start({ command, cwd, label, timeoutSeconds: timeoutSeconds! })
			: registry.start({ command, cwd, label, kind: "job" });
	}

	pi.registerTool({
		name: "bash_background",
		label: "Bash (background)",
		description: [
			"Run a shell command in the background and return a job id at once. You are notified once, automatically, when it exits (exit code, last output lines, output file); do not poll, sleep, or wait for it.",
			"Use synchronous bash for quick checks and bash_background for long or unknown duration, servers, builds, and external waits; put the wait condition inside the command so its exit is the event.",
			`Stop a job with job_stop; list jobs with job_list. At most ${MAX_RUNNING_JOBS} run at once.`,
		].join(" "),
		parameters: Type.Object({
			command: Type.String({ description: "Shell command to run in the background, in the session working directory." }),
			label: Type.Optional(Type.String({ description: "Short human-readable label, e.g. 'dev server'." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let job: JobRecord;
			try {
				job = startJob(params.command, ctx.cwd, params.label, "job");
			} catch (error) {
				return error(error instanceof Error ? error.message : String(error));
			}
			return { ...text(`${jobStartText(job)}\n${t.willNotify}`), details: { jobId: job.id, outputPath: job.outputPath } };
		},

		// Compact one-line rendering (T2/S2), display-only. The job id rides along
		// as a dim extra: `✓ bash_background npm run dev · job-1`.
		...compactRenderers("bash_background", {
			extra: (result) => {
				const id = (result.details as { jobId?: string } | undefined)?.jobId;
				return id ? [{ text: id }] : [];
			},
		}),
	});

	pi.registerTool({
		name: "monitor",
		label: "Monitor",
		description: [
			"Run a command in the background and receive each output line as an event while it runs, without waiting for it to exit.",
			"Use it to react as things happen, e.g. `tail -f app.log | grep --line-buffered ERROR`. For a single result when a command ends, use bash_background.",
			"Lines within 200 ms arrive as one notice of at most 20 lines. timeout_seconds is mandatory (1-1800): the monitor stops when it expires, and also when it prints more than 120 lines in 60 s. Stop it with job_stop; list it with job_list.",
		].join(" "),
		parameters: Type.Object({
			command: Type.String({ description: "Shell command whose output lines are events, run in the session working directory." }),
			timeout_seconds: Type.Integer({ minimum: 1, maximum: 1800, description: "Mandatory: stop the monitor after this many seconds." }),
			label: Type.Optional(Type.String({ description: "Short human-readable label, e.g. 'error watch'." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			try {
				const seconds = typeof params.timeout_seconds === "number" ? params.timeout_seconds : Number.NaN;
				if (!Number.isInteger(seconds) || seconds < 1 || seconds > 1800) {
					return error(t.timeoutSecondsInvalid(1800));
				}
				const job = startJob(params.command, ctx.cwd, params.label, "monitor", seconds);
				return { ...text(`${monitorStartText(job)}\n${t.monitorWillNotify}`), details: { jobId: job.id, outputPath: job.outputPath, timeoutSeconds: seconds } };
			} catch (caught) {
				return error(caught instanceof Error ? caught.message : String(caught));
			}
		},

		// `✓ monitor tail -f app.log · job-2` (display-only, T2/S2).
		...compactRenderers("monitor", {
			extra: (result) => {
				const id = (result.details as { jobId?: string } | undefined)?.jobId;
				return id ? [{ text: id }] : [];
			},
		}),
	});

	pi.registerTool({
		name: "job_list",
		label: "List jobs",
		description: "List background jobs and monitors: running first, then finished, newest first, with id, kind, label, status, elapsed and exit code.",
		parameters: Type.Object({}),
		async execute() {
			const jobs = registry.list();
			const body = listText(jobs, Date.now());
			return {
				...text(jobs.length > 0 ? body : t.listEmptyHint),
				details: { count: jobs.length, running: registry.runningCount() },
			};
		},

		// `✓ job_list · 2` (display-only, T2/S2).
		...compactRenderers("job_list", {
			extra: (result) => {
				const count = (result.details as { count?: number } | undefined)?.count;
				return typeof count === "number" ? [{ text: String(count) }] : [];
			},
		}),
	});

	pi.registerTool({
		name: "job_stop",
		label: "Stop job",
		description: "Stop a background job or monitor by id, killing its whole process tree (SIGTERM, then SIGKILL). A stopped job sends no exit notice.",
		parameters: Type.Object({
			job_id: Type.String({ description: "Job id, as returned by bash_background or monitor (see job_list)." }),
		}),
		async execute(_id, params) {
			const job = registry.get(params.job_id);
			if (!job) {
				return error(t.jobStopUnknown(params.job_id));
			}
			if (job.status !== "running") {
				return error(t.jobStopNotRunning(job.id, job.label, job.status === "stopped" ? t.jobStopped : t.jobFinished));
			}
			monitors.cancel(job.id);
			registry.stop(job.id);
			return { ...text(t.jobStoppedNotice(job.id, job.label)), details: { jobId: job.id, stopped: true } };
		},

		// `✓ job_stop job-1` (display-only, T2/S2).
		...compactRenderers("job_stop"),
	});

	// --- Views: the indicator above the editor and the /jobs overlay -----------

	function requestRender(): void {
		tuiRef?.requestRender();
	}

	function indicatorComponent(theme: Theme): Component {
		const fg = (role: string, value: string) => theme.fg(role as ThemeColor, value);
		return {
			invalidate() {},
			render(): string[] {
				try {
					const line = indicatorLine(registry.list());
					return line !== "" ? [fg("accent", line), ""] : [];
				} catch {
					// a broken indicator must never break the editor
					return [];
				}
			},
		};
	}

	const openOverlay = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			ctx.ui.notify(t.overlayNeedsTui, "warning");
			return;
		}
		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				const fg = (role: string, value: string) => theme.fg(role as ThemeColor, value);
				let state = initialOverlayState(registry.list());
				const timer = setInterval(() => tui.requestRender(), OVERLAY_REFRESH_MS);
				timer.unref();
				const unsubscribeOverlay = registry.subscribe(() => tui.requestRender());
				const close = (): void => {
					clearInterval(timer);
					unsubscribeOverlay();
					done();
				};
				const component: Component = {
					invalidate() {},
					dispose() {
						clearInterval(timer);
						unsubscribeOverlay();
					},
					render(width: number): string[] {
						try {
							const live = registry.list();
							if (state.selectedId && !live.some((job) => job.id === state.selectedId)) {
								state = { ...state, selectedId: orderedJobs(live)[0]?.id };
							}
							return renderJobOverlay(live, state, { width, rows: tui.terminal.rows }, Date.now(), fg);
						} catch {
							return [];
						}
					},
					handleInput(data: string): void {
						const action: OverlayAction | undefined =
							data === "k" || matchesKey(data, "up") ? "up"
							: data === "j" || matchesKey(data, "down") ? "down"
							: data === "s" ? "stop"
							: data === "q" || matchesKey(data, "escape") ? "close"
							: undefined;
						if (!action) return;
						const result = reduceOverlay(state, action, registry.list());
						state = result.state;
						if (result.stop) registry.stop(result.stop);
						if (state.closed) close();
						else tui.requestRender();
					},
				};
				return component;
			},
			{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", margin: 0, anchor: "center" } },
		);
	};

	pi.registerCommand("jobs", {
		description: t.description,
		handler: async (_args: string, ctx: ExtensionContext) => openOverlay(ctx),
	});

	pi.on("session_start", async (_event, ctx) => {
		// The indicator lives above the editor, TUI mode only, under its own key
		// so it coexists with the agents and todo cards.
		if (ctx.mode !== "tui" || !ctx.hasUI) return;
		ctx.ui.setWidget(
			INDICATOR_KEY,
			(tui, theme) => {
				tuiRef = tui;
				return indicatorComponent(theme);
			},
			{ placement: "aboveEditor" },
		);
		if (!unsubscribe) {
			unsubscribe = registry.subscribe(() => requestRender());
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		// Closing violeta stops every running job (SIGKILL to the group) and
		// removes its temp directory: no background process outlives the session.
		monitors.cancelAll();
		registry.dispose();
		if (ctx.mode === "tui") {
			tuiRef = undefined;
			unsubscribe?.();
			unsubscribe = undefined;
			if (ctx.hasUI) ctx.ui.setWidget(INDICATOR_KEY, undefined);
		}
	});

	// Last-resort path: the process dies without a graceful session_shutdown.
	if (!exitHooked) {
		exitHooked = true;
		process.on("exit", () => registry.killAll("force"));
	}
}
