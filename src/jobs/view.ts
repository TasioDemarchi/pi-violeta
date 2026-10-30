/**
 * Jobs view — pure rendering and key handling for the model-facing job list,
 * the one-line indicator above the editor, and the /jobs overlay. No Pi API:
 * the extension feeds data, a theme-like `fg` function and terminal size.
 */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { jobs as t } from "../i18n.ts";
import type { JobRecord } from "./registry.ts";

export type ViewFg = (role: string, text: string) => string;

const ELLIPSIS = "…";

/** `4s`, `1m 24s`, `1h 2m` — the one duration format for lists and notices. */
export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/** Running jobs first (newest started first), then finished (newest ended first). */
export function orderedJobs(jobs: readonly JobRecord[]): JobRecord[] {
	const running = jobs.filter((job) => job.status === "running").sort((a, b) => b.startedAt - a.startedAt);
	const finished = jobs
		.filter((job) => job.status !== "running")
		.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0) || b.startedAt - a.startedAt);
	return [...running, ...finished];
}

/** One-line outcome, shared by the list and the notices. */
export function jobStatusText(job: JobRecord): string {
	if (job.status === "running") return t.jobRunning;
	if (job.status === "stopped") return t.jobStopped;
	if (job.status === "failed") return t.jobFailed(job.error);
	if (job.exitCode === null || job.exitCode === undefined) return t.jobSignal(job.signal);
	return t.jobExited(job.exitCode);
}

/** `job-1 · job · build check · salió con código 0 · 4s` */
export function listLine(job: JobRecord, now: number): string {
	const elapsed = formatDuration((job.endedAt ?? now) - job.startedAt);
	return `${job.id} · ${job.kind} · ${job.label} · ${jobStatusText(job)} · ${elapsed}`;
}

/** The model-facing list text: running first, newest first. */
export function listText(jobs: readonly JobRecord[], now: number): string {
	const ordered = orderedJobs(jobs);
	return ordered.length > 0 ? ordered.map((job) => listLine(job, now)).join("\n") : t.listEmpty;
}

/** `jobs: N running` while anything runs; empty otherwise (the widget hides). */
export function indicatorLine(jobs: readonly JobRecord[]): string {
	const running = jobs.filter((job) => job.status === "running").length;
	return running > 0 ? t.indicator(running) : "";
}

// --- Overlay (/jobs) ---------------------------------------------------------

export interface Glyph {
	glyph: string;
	role: string;
}

function glyph(job: JobRecord): Glyph {
	if (job.status === "running") return { glyph: job.kind === "monitor" ? "◉" : "◐", role: "accent" };
	if (job.status === "stopped") return { glyph: "–", role: "dim" };
	if (job.status === "exited" && job.exitCode === 0) return { glyph: "✓", role: "success" };
	return { glyph: "✗", role: "error" };
}

const KIND_ROLE: Record<JobRecord["kind"], string> = { job: "muted", monitor: "accent" };

export type OverlayAction = "up" | "down" | "stop" | "close";

export interface OverlayState {
	selectedId: string | undefined;
	/** The running job an `s` press armed; a second `s` stops it. */
	confirmId: string | undefined;
	closed: boolean;
}

export function initialOverlayState(jobs: readonly Pick<JobRecord, "id">[]): OverlayState {
	return { selectedId: orderedJobs(jobs as JobRecord[])[0]?.id, confirmId: undefined, closed: false };
}

/**
 * Pure key handling. `stop` arms a confirm on the selected running job and a
 * second press returns its id in `stop` for the caller to kill; a finished
 * job is never stoppable, and moving the selection disarms the confirm.
 */
export function reduceOverlay(
	state: OverlayState,
	action: OverlayAction,
	jobs: readonly Pick<JobRecord, "id" | "status">[],
): { state: OverlayState; stop?: string } {
	const ordered = orderedJobs(jobs as JobRecord[]);
	const selected = ordered.find((job) => job.id === state.selectedId) ?? ordered[0];
	switch (action) {
		case "up":
		case "down": {
			if (ordered.length === 0) return { state };
			const index = ordered.findIndex((job) => job.id === selected?.id);
			const next = action === "up" ? Math.max(0, index - 1) : Math.min(ordered.length - 1, index + 1);
			return { state: { selectedId: ordered[next]!.id, confirmId: undefined, closed: false } };
		}
		case "stop": {
			if (!selected || selected.status !== "running") return { state };
			if (state.confirmId === selected.id) {
				return { state: { ...state, confirmId: undefined }, stop: selected.id };
			}
			return { state: { ...state, confirmId: selected.id } };
		}
		case "close":
			return { state: { ...state, closed: true } };
		default:
			return { state };
	}
}

/** `Jobs · 1 running · 1 finished` */
export function overlayHeader(jobs: readonly JobRecord[]): string {
	const running = jobs.filter((job) => job.status === "running").length;
	return t.overlayHeader(running, jobs.length - running);
}

const EMPTY_JOBS_LINE = t.listEmptyHint;

/** The overlay body: header, one row per job (selected marked), an optional
 * confirm row, and the hint. Rows clip to the width, never overflow it. */
export function renderJobOverlay(
	jobs: readonly JobRecord[],
	state: OverlayState,
	layout: { width: number; rows: number },
	now: number,
	fg: ViewFg,
): string[] {
	const ordered = orderedJobs(jobs);
	const lines: string[] = [truncateToWidth(fg("accent", overlayHeader(ordered)), layout.width)];
	if (ordered.length === 0) {
		lines.push(truncateToWidth(fg("dim", EMPTY_JOBS_LINE), layout.width));
	} else {
		for (const job of ordered) {
			const look = glyph(job);
			const selected = job.id === state.selectedId;
			const marker = selected ? fg("accent", "›") : " ";
			const idText = `${job.id} ${fg(KIND_ROLE[job.kind], job.kind)}`;
			const elapsed = formatDuration((job.endedAt ?? now) - job.startedAt);
			const labelWidth = Math.max(1, layout.width - visibleWidth(idText) - visibleWidth(elapsed) - 6);
			const label = clip(job.label, labelWidth);
			const row = `${marker} ${fg(look.role, look.glyph)} ${selected ? fg("text", idText) : fg("dim", idText)} ${selected ? fg("text", label) : fg("muted", label)} ${fg("muted", elapsed)}`;
			lines.push(truncateToWidth(row, layout.width));
		}
	}
	const running = ordered.find((job) => job.id === state.confirmId);
	if (running) lines.push(truncateToWidth(fg("warning", t.confirmStop(running.id, running.label)), layout.width));
	const rows = Math.max(3, layout.rows);
	while (lines.length < rows - 1) lines.push("");
	lines.push(truncateToWidth(fg("dim", t.hint), layout.width));
	return lines.slice(0, rows);
}

function clip(text: string, width: number): string {
	if (width <= 0) return "";
	if (visibleWidth(text) <= width) return text;
	let out = "";
	for (const char of text) {
		if (visibleWidth(out + char) > width - 1) break;
		out += char;
	}
	return `${out}${ELLIPSIS}`;
}
