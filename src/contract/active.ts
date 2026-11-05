/** Which contract is active in THIS session (S8, estado-de-tareas).
 *
 * The model names a contract once — `contract_check` passing the lint is the
 * natural moment, and the only one wired — and the session remembers it. The
 * record is a custom session entry on the branch, the same mechanism the todo
 * list uses (`src/todo/persist.ts`): `appendEntry` writes it, replaying the
 * branch reads it back, so the answer survives `/compact` and `/resume` without
 * the model naming anything again. Nothing is kept in memory as the source of
 * truth: a replay of the branch IS the answer, which is why the panel, the
 * writer of `estado:` rows and the verifier behind it cannot disagree.
 *
 * The fallback is `DEFAULT_CONTRACT`, the convention `tasks/<name>.md` that T5
 * rode on. An empty branch — a fresh session, or a project where nobody adopted
 * anything — yields that same path the panel has always read, so a project whose
 * contract lives there keeps working exactly as before (S3), and a project with
 * no such file gets the model's own list, exactly as it did before this feature.
 * The alternative, "no contract at all until one is adopted", would change the
 * behaviour S3 froze, so the convention stays.
 *
 * Everything here is pure and defensive: the data is whatever a session file
 * holds, so a junk entry is skipped, never thrown on. */

export const ACTIVE_CONTRACT_ENTRY_TYPE = "violeta-active-contract";

/** The convention T5 read and this module keeps as the fallback (S3). */
export const DEFAULT_CONTRACT = "tasks/estado-de-tareas.md";

interface SessionEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

/** The plain data stored in the custom entry. */
export function activeContractSnapshot(path: string): { path: string } {
	return { path };
}

function pathOf(raw: unknown): string | undefined {
	if (typeof raw !== "string") return undefined;
	const path = raw.trim();
	return path === "" ? undefined : path;
}

/** The path the last adoption on the branch names, or undefined when the
 * session never adopted one. Junk entries are skipped, not fatal. */
export function replayActiveContract(entries: readonly unknown[]): string | undefined {
	let active: string | undefined;
	for (const entry of entries as SessionEntry[]) {
		if (entry?.type !== "custom" || entry.customType !== ACTIVE_CONTRACT_ENTRY_TYPE) continue;
		const found = pathOf((entry.data as { path?: unknown } | undefined)?.path);
		if (found !== undefined) active = found;
	}
	return active;
}

/** The contract this session reads: what it adopted, or the convention. */
export function activeContract(entries: readonly unknown[]): string {
	return replayActiveContract(entries) ?? DEFAULT_CONTRACT;
}

/** The same answer straight from a session manager, whose `getBranch` is the
 * branch. Optional-property access on purpose: an event context without one (a
 * fake in a test, a child process) reads as "nothing adopted" and gets the
 * convention, never a crash in the middle of a tool call. */
export function activeContractFrom(sessionManager: unknown): string {
	const branch = (sessionManager as { getBranch?: () => unknown[] } | undefined)?.getBranch?.();
	return activeContract(Array.isArray(branch) ? branch : []);
}
