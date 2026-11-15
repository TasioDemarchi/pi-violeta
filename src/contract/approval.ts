/** What the owner approved, and whether a write would change it
 * (contrato-aprobado, pieza 1).
 *
 * Approval 1 used to be a sentence in the chat ("¿Apruebo el contrato?" /
 * "apruebo"): nothing in the harness knew it had happened, and the contract
 * file stayed writable for the session forever. Measured on 2026-11-15: after
 * the guard refused a code write, a Jarvis added "— quién: Jarvis" to an
 * approved row and wrote the code itself. The escape hatch was a door because
 * the contract had no "approved" state.
 *
 * Now `contract_approve` asks the owner in a dialog and, on yes, records a
 * snapshot of the FROZEN VIEW of the contract as a custom session entry — the
 * same branch mechanism `active.ts` uses, so it survives `/compact` and
 * `/resume`. The guard compares every write to the approved contract against
 * that snapshot.
 *
 * The frozen view is what the owner approved, and only that:
 *   - everything before the first `##` (name, intent, Runner);
 *   - `## No-objetivos` and `## Specs`, line by line;
 *   - the `## Tasks` ROWS, with the two fields that must keep moving
 *     normalized away: `— estado:` (the harness's) and the value of `commit:`
 *     (the model's done marker). Continuation lines under a row are notes and
 *     the harness's own Check output (state.ts), not the approved plan.
 * Open on purpose: `## Decisiones` and `## Log`, which the philosophy tells the
 * model to keep writing during the build.
 *
 * Blank lines and trailing spaces never count: reflowing the file is not a
 * change of plan. Everything here is pure and total. */

import { find, sections } from "./lint.ts";

export const CONTRACT_APPROVAL_ENTRY_TYPE = "violeta-contract-approval";

const TASK_ROW = /^T\d+\.\s/;
const ESTADO = /\s+—\s+estado:[^—\n]*/gi;
const COMMIT_VALUE = /(commit:)[^—\n]*/gi;

const clean = (line: string) => line.replace(/\s+$/, "");

/** The approved part of a contract, as one comparable string. */
export function frozenView(text: string): string {
	const out: string[] = [];
	for (const line of text.split("\n")) {
		if (/^##\s/.test(line)) break;
		if (line.trim() !== "") out.push(clean(line));
	}
	const all = sections(text);
	for (const [label, names] of [
		["## No-objetivos", ["no-objetivos", "no objetivos", "non-goals"]],
		["## Specs", ["specs"]],
	] as const) {
		const section = find(all, ...names);
		if (!section) continue;
		out.push(label);
		for (const { text: line } of section.lines) if (line.trim() !== "") out.push(clean(line));
	}
	const tasks = find(all, "tasks", "tareas");
	if (tasks) {
		out.push("## Tasks");
		for (const { text: line } of tasks.lines) {
			if (!TASK_ROW.test(line)) continue;
			out.push(clean(line.replace(ESTADO, "").replace(COMMIT_VALUE, "$1")));
		}
	}
	return out.join("\n");
}

/** The data stored in the custom entry. */
export function approvalSnapshot(path: string, text: string): { path: string; frozen: string } {
	return { path: path.trim(), frozen: frozenView(text) };
}

interface SessionEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

/** The frozen view the owner last approved for `path`, or undefined when they
 * never approved it. Junk entries are skipped, never thrown on. */
export function replayApproval(entries: readonly unknown[], path: string): string | undefined {
	const wanted = path.trim();
	let frozen: string | undefined;
	for (const entry of entries as SessionEntry[]) {
		if (entry?.type !== "custom" || entry.customType !== CONTRACT_APPROVAL_ENTRY_TYPE) continue;
		const data = entry.data as { path?: unknown; frozen?: unknown } | undefined;
		if (typeof data?.path !== "string" || typeof data.frozen !== "string") continue;
		if (data.path.trim() === wanted) frozen = data.frozen;
	}
	return frozen;
}

/** The same answer from a session manager; a context without one (a fake, a
 * child process) reads as "never approved". */
export function approvalFrom(sessionManager: unknown, path: string): string | undefined {
	const branch = (sessionManager as { getBranch?: () => unknown[] } | undefined)?.getBranch?.();
	return replayApproval(Array.isArray(branch) ? branch : [], path);
}

/** What a new version changes in the approved view: the approved lines that
 * would go and the lines that would arrive, in order. For the owner's dialog. */
export function frozenChanges(approved: string, text: string): { removed: string[]; added: string[] } {
	const before = approved.split("\n");
	const after = frozenView(text).split("\n");
	const count = (lines: string[]) => lines.reduce((m, l) => m.set(l, (m.get(l) ?? 0) + 1), new Map<string, number>());
	const keep = (lines: string[], other: Map<string, number>) =>
		lines.filter((line) => {
			const left = other.get(line) ?? 0;
			if (left > 0) {
				other.set(line, left - 1);
				return false;
			}
			return true;
		});
	return { removed: keep(before, count(after)), added: keep(after, count(before)) };
}

type Edit = { oldText?: unknown; newText?: unknown };

/** The contract's text after a write, or undefined when it cannot be known
 * (a shell command: its result is not in its arguments). An edit whose text is
 * not found changes nothing — the tool itself will fail — so it yields the
 * current text. */
export function contractAfterWrite(tool: string, input: Record<string, unknown>, current: string): string | undefined {
	if (tool === "write") return typeof input?.content === "string" ? input.content : undefined;
	if (tool !== "edit") return undefined;
	const edits: Edit[] = Array.isArray(input?.edits) ? (input.edits as Edit[]) : [{ oldText: input?.oldText, newText: input?.newText }];
	let text = current;
	for (const edit of edits) {
		if (typeof edit?.oldText !== "string" || typeof edit.newText !== "string") return undefined;
		if (!text.includes(edit.oldText)) continue;
		text = text.replace(edit.oldText, () => edit.newText as string);
	}
	return text;
}
