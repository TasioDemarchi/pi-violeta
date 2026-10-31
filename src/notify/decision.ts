/**
 * notify — pure decision and emission helpers for the opt-in finish/dialog
 * notification (T3/S3). No Pi API and no process side effects of its own:
 * the extension wires the real bell/stdout and notify-send in through the
 * `NotifyDeps` ports, so the decision table and the failure paths are
 * testable without a desktop session.
 */

import { accessSync, constants } from "node:fs";

/** A settled run must have lasted longer than this to notify. */
export const MIN_RUN_MS = 20_000;

export type NotifyKind = "finished" | "needsAnswer" | "none";

export interface NotifyDecisionInput {
	/** The /notify preference (persisted, default off). */
	enabled: boolean;
	/** A confirmation dialog is waiting for the user. */
	dialogWaiting: boolean;
	/** How long the current agent run lasted (0 when none). */
	runDurationMs: number;
}

/** Decide whether (and why) to notify: a waiting confirmation dialog always
 * wins, then a settled run longer than 20 s; off silences everything. */
export function decideNotify(input: NotifyDecisionInput): NotifyKind {
	if (!input.enabled) return "none";
	if (input.dialogWaiting) return "needsAnswer";
	if (input.runDurationMs > MIN_RUN_MS) return "finished";
	return "none";
}

/** Ports the extension fills with the real implementations. `exists` checks
 * the PATH (never a shell), `exec` runs a program with an argument array. */
export interface NotifyDeps {
	/** Write raw bytes to the terminal (the bell). */
	bell: (data: string) => void;
	/** Whether a named program exists on PATH. */
	exists: (name: string) => boolean;
	/** Run a program with an argument array (no shell). */
	exec: (file: string, args: string[]) => void;
}

export const BELL = "\x07";

/** Ring the terminal bell and, when `notify-send` exists, send a desktop
 * notification titled `violeta`. Never throws: a missing notify-send or a
 * failing spawn is swallowed. Never a shell — argument array only. */
export function emitNotification(deps: NotifyDeps, body: string): void {
	try {
		deps.bell(BELL);
	} catch {
		/* a closed stdout must not break the session */
	}
	if (!deps.exists("notify-send")) return;
	try {
		deps.exec("notify-send", ["violeta", body]);
	} catch {
		/* swallow: the bell already rang */
	}
}

/** Whether `name` is an executable found on PATH (pure PATH scan, no shell). */
export function existsOnPath(name: string): boolean {
	const dirs = (process.env.PATH ?? "").split(":").filter((d) => d !== "");
	for (const dir of dirs) {
		try {
			accessSync(`${dir}/${name}`, constants.X_OK);
			return true;
		} catch {
			/* keep scanning */
		}
	}
	return false;
}

/** The last short phrase of an assistant answer: the last non-empty line,
 * whitespace-collapsed, capped with an ellipsis. */
export function shortPhrase(text: string | undefined, max = 60): string {
	if (!text) return "";
	const lines = text
		.split("\n")
		.map((line) => line.replace(/\s+/g, " ").trim())
		.filter((line) => line !== "");
	const last = lines[lines.length - 1] ?? "";
	if (last.length <= max) return last;
	return `${last.slice(0, max - 1)}…`;
}
