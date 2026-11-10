/** The resume brake (S9, estado-de-tareas): a task that is already built is
 * not built again.
 *
 * The failure this exists for: a session resumed mid-contract, believed the
 * Todo panel over the repository, redispatched a spike that was already
 * committed, and overwrote working code. The rule had been written in the
 * mode's prose, which is exactly what a resumed session does not re-read — so
 * it is enforced here, at the single choke point every dispatch goes through.
 *
 * The decision is a pure function over two facts, and nothing else is evidence:
 *
 *   - a commit SUBJECT that names the task (`T2(spike): el cache`,
 *     `contrato(estado-de-tareas): T2 cerrado`). The id must be a whole token:
 *     `T12` is not `T2`, and `fixT2` is not a task id.
 *   - the row the HARNESS wrote as `verificada` — its `Check` ran and passed.
 *
 * Deliberately NOT evidence:
 *
 *   - `commit: <hash>` on the row. That is the model's own marker, and the model
 *     is what got this wrong; a session that trusts it over the repository is
 *     the bug, not the proof.
 *   - `fallada`: a task whose Check failed is still open, and a second dispatch
 *     is how it gets fixed.
 *
 * Which commits may speak is not this module's call: the caller passes only the
 * ones that cover the contract (from the commit that first added it), because a
 * subject from an older contract names a different `T2`. The brake only speaks
 * about a task the contract actually has a row for: an unknown id is a typo,
 * and the row writer ignores it (`setTaskStatus`), so refusing over it would be
 * noise. `priorWork` answers in the order the refusal should speak: the commit
 * when there is one, the row otherwise.
 *
 * The brake itself — dialog, refusal, wiring — lives in
 * `extensions/violeta-task-state.ts`; this file has no I/O so it can be tested
 * without a terminal or a repository. */

import { parseContractTasks, readTaskStatus } from "./state.ts";

/** One line of `git log --format=%h%x09%s`. */
export interface CommitSubject {
	hash: string;
	subject: string;
}

/** Parse that format: hash, a tab, the subject. A line without a tab (a merge
 * subject the caller asked for in another format, junk in a hand-made fixture)
 * is skipped instead of guessed at. */
export function parseGitLog(text: string): CommitSubject[] {
	const commits: CommitSubject[] = [];
	for (const line of text.split("\n")) {
		const tab = line.indexOf("\t");
		if (tab === -1) continue;
		const hash = line.slice(0, tab).trim();
		const subject = line.slice(tab + 1).trim();
		if (hash !== "" && subject !== "") commits.push({ hash, subject });
	}
	return commits;
}

/** True when `subject` names task `taskId` as its own token: `\bT2\b` matches
 * `T2(spike)` and `T2 cerrado`, and refuses `T12`, `T21` and `fixT2`. The `T#`
 * row convention is upper-case, so a lower-case `t2` is not a task either. */
export function namesTask(subject: string, taskId: number): boolean {
	return new RegExp(`\\bT${taskId}\\b`).test(subject);
}

/** What proves a task is already built. */
export type ResumeProof = { kind: "commit"; commit: CommitSubject } | { kind: "estado" };

/** The proof that task `taskId` already exists, or undefined when it does not.
 * `commits` are the ones that cover this contract, newest first or oldest — the
 * first match wins, and any match is enough. */
export function priorWork(md: string, taskId: number, commits: readonly CommitSubject[]): ResumeProof | undefined {
	if (!parseContractTasks(md).some((row) => row.id === taskId)) return undefined;
	const commit = commits.find((candidate) => namesTask(candidate.subject, taskId));
	if (commit) return { kind: "commit", commit };
	if (readTaskStatus(md, taskId) === "verificada") return { kind: "estado" };
	return undefined;
}
