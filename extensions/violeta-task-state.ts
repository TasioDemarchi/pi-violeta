/**
 * violeta-task-state — the harness-side writer of a contract task's `estado:`
 * field (S4/S5, estado-de-tareas). It is the event half of "the harness records
 * on its own": the model decides what to dispatch, this file decides what that
 * dispatch means for the task row.
 *
 * The loop it closes:
 *
 *   `subagent_run` tool_call  with `contractTask: N` → `estado: en curso`
 *   `subagent_run` tool_result  isError          → `estado: fallada`
 *   `subagent_run` tool_result  no error         → the task's `Check` is run
 *                                                   (S5, src/contract/verify.ts):
 *                                                   passes → `verificada`
 *                                                   fails  → `fallada` + clipped
 *                                                            output (D8)
 *                                                   manual / absent → `por verificar`
 *   `subagent_run` tool_result  `mode: background` → nothing: no result yet (D9);
 *                                                   the row is closed when the
 *                                                   child settles (below)
 *   anything else                                 → the file is not touched
 *
 * "The model says it is done" is worth exactly the Check, and this file never
 * decides otherwise (D3): a worker that reports success and fails its own Check
 * leaves a red row with the real output, it does not leave a green one.
 *
 * The task id travels as DISPATCH DATA (`contractTask` on the call, D4). It is
 * never read out of `label`, `task` or any other prose: a dispatch whose label
 * happens to say "T1" writes nothing, and the only thing that writes is the
 * parameter. The spike read it from `label`; T6 removed that crutch.
 *
 * Writing goes through `setTaskStatus` and `setTaskCheckOutput`
 * (src/contract/state.ts), the one writer of the row and of the one line under
 * it, so `commit:` and every other byte the model owns survive untouched (S7).
 * Both writes here are also careful about WHEN they read: read, transform,
 * write — and never a snapshot held across an `await`. A Check can run for ten
 * minutes and the guard's dialog can sit waiting for the owner, so
 * `verifyDispatch` re-reads the file after the Check and applies the transforms
 * to THAT text; the model's edits made in the window survive (S7) instead of
 * being overwritten by the text that was true before the wait. The write itself
 * goes through a temp file and `renameSync` in the same directory, so a reader
 * (the panel's tick, another check) never catches half a contract.
 * The active contract is the session's answer (src/contract/active.ts): what
 * `contract_check` adopted after a clean lint, or the `tasks/<name>.md`
 * the Todo panel reads. The panel is not told about the write: it re-reads the
 * file on its own tick, because the file is the single source of truth (D2) and
 * there is no second copy to notify.
 *
 * A background dispatch is the one case where the `tool_result` is not the end
 * of the work (D9): the tool returns the runner's task id while the child keeps
 * running. This file writes nothing on that event, and it is not told when the
 * child ends either — so D9's "the row stays `en curso`" needed a second half,
 * or the row would have stayed `en curso` forever and only the model's own
 * `commit:` would have closed it (skipping D3/S5 entirely). The half lives here:
 * `armBackgroundVerification` is called from `subagent_run`'s `execute` — the
 * parent's process, which does have a real context, and which is the only place
 * that knows the `contractTask` of this dispatch (D4: it travels as data, never
 * as a guess) — and the runner's `onSettled` calls
 * `settleBackgroundVerification`, which runs the same Check through the same
 * guard. A dispatch with no `contractTask` arms nothing.
 *
 * Two guards worth naming:
 *
 *   - calls made by another tool (`parentToolCallId`, e.g. a codemode script or
 *     a nested `executeTool`) are ignored: only a first-level dispatch is the
 *     model assigning work, and a nested call would otherwise clear the state
 *     of the dispatch that is still running.
 *   - children spawned by the subagent runner load this package too, so the
 *     extension installs nothing when `VIOLETA_AGENTS_CHILD=1` (same guard as
 *     the agents and todo extensions).
 *
 * Before any of that, the RESUME BRAKE (S9) runs: a resumed session once redid a
 * spike that was already committed because it believed the panel over the
 * repository, so a dispatch for a task git already shows as built is refused
 * instead of written. `priorWork` (src/contract/resume.ts) is the decision — a
 * commit subject naming the task, or a row the harness wrote as `verificada` —
 * and the commits it is given are only those from the commit that first added
 * the contract, so an older contract's `T2` cannot freeze a new one. With an
 * owner to ask (`canAsk`: UI, not a child, not unattended) the dialog offers to
 * redo it; with nobody there the answer is no. A blocked call never reaches the
 * tool, so nothing is written and the row keeps its bytes — the agent loop skips
 * `afterToolCall` for a blocked call, so it does not land as `fallada` either.
 *
 * Running the Check is `guardedCheckExecutor` (src/guard/check-executor.ts), the
 * single place this feature spawns a process: S6 puts the guard in front of it,
 * so a destructive `Check` asks the owner first (same dialog, same `Sí`), a
 * declined one never runs, and unattended mode runs none of them. The decision
 * is the guard's own `guardDecision` — no regex is copied here — and the refusal
 * comes back as `refused` on the result, which the writer turns into
 * `por verificar` plus the motive on D8's line.
 *
 * Event handlers only get an `ExtensionContext`, which has no `executeTool()` —
 * that lives on `ExtensionToolContext`, available inside a tool's `execute()`,
 * not here — so the Check cannot go through the bash tool from a `tool_result`
 * handler. It runs in this (the parent's) process, which is why
 * `VIOLETA_AGENTS_CHILD` is not set here and the guard does raise its dialog.
 * `verifyDispatch` takes the executor as a parameter so it can be handed over
 * without changing anything else in this file's wiring — and for the same
 * reason, so can the background path: `armBackgroundVerification` builds it
 * from the context the dispatch ran in.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { parseContractTasks, setTaskCheckOutput, setTaskStatus } from "../src/contract/state.ts";
import { inspectHandoff } from "../src/authority/handoff.ts";
import { verifyTask, type CheckExecutor } from "../src/contract/verify.ts";
import { guardedCheckExecutor } from "../src/guard/check-executor.ts";
import { activeContractFrom } from "../src/contract/active.ts";
import { parseGitLog, priorWork, type CommitSubject, type ResumeProof } from "../src/contract/resume.ts";
import { canAsk } from "../src/guard/outside.ts";
import { setShared } from "../src/shared-hub.ts";
import { contract as t, guard, handoff as handoffText } from "../src/i18n.ts";

/** The tool whose dispatch carries a contract task. */
const DISPATCH_TOOL = "subagent_run";
/** The value a failed dispatch leaves on the row. */
const FAILED = "fallada";
const IN_PROGRESS = "en curso";

/** The task id of a dispatch, or undefined when the dispatch carries none. The
 * parameter is declared as `Type.Integer` on `subagent_run`, and anything that
 * is not a positive integer is treated as "no task" rather than coerced: a
 * typo must not land on somebody else's row. */
export function dispatchTaskId(input: unknown): number | undefined {
	const value = (input as { contractTask?: unknown } | undefined)?.contractTask;
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** True for a call another tool issued. Only first-level dispatches count. */
function isNested(event: unknown): boolean {
	const parent = (event as { parentToolCallId?: unknown } | undefined)?.parentToolCallId;
	return typeof parent === "string" && parent !== "";
}

/** D9: a background dispatch returns immediately, so its `tool_result` is not
 * the end of the work. */
function isBackground(input: unknown): boolean {
	return (input as { mode?: unknown } | undefined)?.mode === "background";
}

/** Write `text` to `file` through a sibling temp file and `renameSync`, so a
 * reader sees the contract before or after the write, never half of it. The
 * temp file has to be in the same directory: `rename(2)` is atomic within a
 * filesystem, and this file lives in the project the owner is working in. */
function writeAtomic(file: string, text: string): void {
	const tmp = `${file}.${process.pid}-${Math.random().toString(36).slice(2)}.tmp`;
	try {
		writeFileSync(tmp, text);
		renameSync(tmp, file);
	} catch (error) {
		try {
			rmSync(tmp, { force: true });
		} catch {
			/* nothing to clean up */
		}
		throw error;
	}
}

/** Read the active contract, and write the result back only when a byte
 * changed. A missing contract, a broken file or a failed write never reach the
 * tool call: the model's work is not worth losing over the harness's bookkeeping.
 * The read and the write are one turn of the event loop apart at most, and the
 * write is atomic, so nothing the model wrote gets clobbered here. */
function editContract(cwd: string, path: string, edit: (md: string) => string): void {
	try {
		const file = resolve(cwd, path);
		if (!existsSync(file)) return;
		const md = readFileSync(file, "utf8");
		const next = edit(md);
		if (next !== md) writeAtomic(file, next);
	} catch {
		/* a broken write must never break the tool call */
	}
}

/** The context the resume brake needs, so a test's fake can satisfy it. */
export type ResumeBrakeContext = Pick<ExtensionContext, "cwd" | "hasUI" | "ui">;

/** `git` in `cwd`, or an empty answer when there is no git (or no repository):
 * a project without version control keeps working exactly as before. */
function git(cwd: string, args: string[]): string {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
	} catch {
		return "";
	}
}

/** The commits that can speak about THIS contract's tasks: the ones after the
 * commit that first added the contract. A subject naming `T2` from an older
 * contract is a different `T2`, and a long history full of them must not freeze
 * every new T1. A contract git never saw has no birth, so nothing is dated
 * against it and only the contract's own `verificada` can brake. */
export function contractCommits(cwd: string, path: string): CommitSubject[] {
	const birth = git(cwd, ["log", "--diff-filter=A", "--format=%h", "-n", "1", "--", path]).split("\n")[0]?.trim() ?? "";
	if (birth === "") return [];
	return parseGitLog(git(cwd, ["log", "--format=%h%x09%s", `${birth}..HEAD`]));
}

/** The proof that task `taskId` is already built, or undefined. Never throws: a
 * missing contract, a broken file or a git that is not there means "no proof",
 * which is exactly the behaviour before this brake existed. */
export function proofOfPriorWork(cwd: string, path: string, taskId: number): ResumeProof | undefined {
	try {
		const file = resolve(cwd, path);
		const md = existsSync(file) ? readFileSync(file, "utf8") : "";
		return priorWork(md, taskId, contractCommits(cwd, path));
	} catch {
		return undefined;
	}
}

/** The proof in one line, for the refusal text: what the model can go check. */
function describeProof(proof: ResumeProof): string {
	return proof.kind === "commit" ? `${proof.commit.hash} «${proof.commit.subject}»` : "su Check ya pasó";
}

/** Ask the owner whether to redo a task that is already built, with the guard's
 * Spanish options. While it waits, the shared hub tells the notify extension (if
 * loaded) to ping the owner. */
async function askRedo(ctx: ResumeBrakeContext, title: string, body: string): Promise<boolean> {
	setShared({ notifyNeedsAnswer: true });
	try {
		return (await ctx.ui.select(`${title}\n${body}`, [guard.yes, guard.no])) === guard.yes;
	} finally {
		setShared({ notifyNeedsAnswer: false });
	}
}

/** The resume brake (S9): undefined when the dispatch may proceed, or the block
 * verdict for it. With nobody to ask, a redo is refused — the same rule the
 * guard and the breaker follow. */
async function resumeBrake(ctx: ResumeBrakeContext, path: string, taskId: number): Promise<{ block: true; reason: string } | undefined> {
	const proof = proofOfPriorWork(ctx.cwd, path, taskId);
	if (proof === undefined) return undefined;
	if (canAsk(ctx)) {
		const body = proof.kind === "commit" ? t.resumeCommitBody(taskId, proof.commit.hash, proof.commit.subject) : t.resumeEstadoBody(taskId);
		if (await askRedo(ctx, t.resumeTitle, body)) return undefined;
		return { block: true, reason: t.resumeDeclinedByOwner(taskId) };
	}
	return { block: true, reason: t.resumeDeclined(taskId, describeProof(proof)) };
}

/** Run the task's Check and record the real outcome on the row (S5). `run` is
 * the executor; the default is the shell, and the extension hands over the
 * guarded one (S6). A refused Check carries its motive, which goes on the D8
 * line under a `por verificar` row; a failed one carries its output.
 *
 * The Check is read from the text the dispatch saw, but the row is written onto
 * a FRESH read taken after the await: the Check can take ten minutes and the
 * guard can wait for the owner, and everything the model wrote in that window
 * has to survive (S7). Applying the pure transforms to the fresh text is what
 * makes that possible — they edit one line and one note, never the file. */
export async function verifyDispatch(cwd: string, path: string, taskId: number | undefined, run: CheckExecutor): Promise<void> {
	if (taskId === undefined) return;
	try {
		const file = resolve(cwd, path);
		if (!existsSync(file)) return;
		const outcome = await verifyTask(readFileSync(file, "utf8"), taskId, cwd, run);
		const fresh = readFileSync(file, "utf8");
		// A green or manual row carries no note, so a Check that now passes
		// removes the one a previous failure (or refusal) left behind (D8).
		const next = setTaskCheckOutput(
			setTaskStatus(fresh, taskId, outcome.status),
			taskId,
			outcome.output,
			outcome.status === "fallada" ? "failed" : "notRun",
		);
		if (next !== fresh) writeAtomic(file, next);
	} catch {
		/* a broken Check must never break the tool call */
	}
}

/** The context a background verification is built from: where the project is,
 * which contract the session adopted, and who the guard may ask (S6). An
 * `ExtensionToolContext` satisfies it, and so does a test's fake. */
export interface BackgroundVerificationContext extends Pick<ExtensionContext, "cwd" | "hasUI" | "ui"> {
	sessionManager?: unknown;
}

/** Verifications a background dispatch still owes, keyed by the runner's task
 * id (D9). It is filled by `subagent_run` and emptied by the runner's
 * `onSettled`, which is why it is keyed by the thing both of them know. */
const owedVerifications = new Map<string, () => Promise<void>>();

/** Remember the verification `runnerTaskId` owes: called by `violeta-agents`
 * when the dispatch carried a `contractTask`, because a background
 * `tool_result` arrives before the work is done (D9) and this process will not
 * hear about it again until the runner settles the task. No `contractTask`, no
 * entry: nothing is deduced from the label or the prompt (D4). */
export function armBackgroundVerification(runnerTaskId: string, contractTask: number | undefined, ctx: BackgroundVerificationContext): void {
	if (contractTask === undefined) return;
	owedVerifications.set(runnerTaskId, () => verifyDispatch(ctx.cwd, activeContractFrom(ctx.sessionManager), contractTask, guardedCheckExecutor(ctx)));
}

/** Run the verification a settled background task owes, and forget it. Called
 * by the runner's `onSettled` through `violeta-agents`: this is what stops a
 * background row from staying `en curso` forever, and it is the same Check, the
 * same guard and the same writer as the foreground path (S5/S6/D3). */
export async function settleBackgroundVerification(runnerTaskId: string): Promise<void> {
	const verify = owedVerifications.get(runnerTaskId);
	if (!verify) return;
	owedVerifications.delete(runnerTaskId);
	try {
		await verify();
	} catch {
		/* a broken Check must never break the runner's settlement */
	}
}


/** El veredicto del harness sobre la FORMA de una entrega, o nada si cumple.
 *
 * Vuelve como error para que una entrega mal formada no se pueda leer como un
 * éxito —`jarvis.md` §4: *"a worker whose answer has no `status:` line did not
 * finish"*— y el texto del trabajador va entero y primero (D1): el orquestador
 * lo necesita para continuar, y borrárselo convertiría un problema de forma en
 * pérdida de trabajo. */
function handoffVerdict(
	event: { input: Record<string, unknown>; content?: ReadonlyArray<{ type: string; text?: string }> },
	cwd: string,
	path: string,
	taskId: number | undefined,
): { isError: true; content: Array<{ type: string; text?: string }> } | undefined {
	const content = event.content ?? [];
	const said = content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("\n");
	const agent = typeof event.input?.agent === "string" ? event.input.agent : "";

	let row: string | undefined;
	if (taskId !== undefined) {
		try {
			const md = readFileSync(resolve(cwd, path), "utf8");
			row = parseContractTasks(md).find((task) => task.id === taskId)?.line;
		} catch {
			row = undefined;
		}
	}

	const problem = inspectHandoff(agent, said, row);
	if (!problem) return undefined;
	return { isError: true, content: [...content, { type: "text", text: handoffText[problem.kind] }] };
}

export default function (pi: ExtensionAPI) {
	// Children spawned by the subagent runner load this package too: no state
	// writes there (same guard as the agents and todo extensions).
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	pi.on("tool_call", async (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		const taskId = dispatchTaskId(event.input);
		const path = activeContractFrom((ctx as { sessionManager?: unknown } | undefined)?.sessionManager);
		// S9: a task the repository already shows as built is not built twice.
		if (taskId !== undefined) {
			const brake = await resumeBrake(ctx, path, taskId);
			if (brake !== undefined) return brake;
		}
		editContract(ctx.cwd, path, (md) => setTaskStatus(md, taskId ?? 0, taskId === undefined ? undefined : IN_PROGRESS));
	});

	pi.on("tool_result", async (event, ctx) => {
		if (isNested(event) || event.toolName !== DISPATCH_TOOL) return;
		const taskId = dispatchTaskId(event.input);
		const path = activeContractFrom((ctx as { sessionManager?: unknown } | undefined)?.sessionManager);
		if (event.isError) {
			// The dispatch itself failed: there is no delivery to verify.
			editContract(ctx.cwd, path, (md) => setTaskStatus(md, taskId ?? 0, taskId === undefined ? undefined : FAILED));
			return;
		}
		// D9: in background the row stays `en curso`; verification happens when the
		// work actually ends, not when the tool call returns. That end is not this
		// event: `subagent_run` armed the verification and the runner's `onSettled`
		// settles it (armBackgroundVerification / settleBackgroundVerification).
		if (isBackground(event.input)) return;
		// S6: the Check goes through the guard, and unattended mode runs none.
		await verifyDispatch(ctx.cwd, path, taskId, guardedCheckExecutor(ctx));

		// S5 (authority-handoff): and THEN the form of the delivery. The order
		// matters: the row's state is decided by the Check the harness observed,
		// never by what the worker says about itself (D2), so the verification
		// runs first and this only annotates the answer the model will read.
		return handoffVerdict(event, ctx.cwd, path, taskId);
	});
}
