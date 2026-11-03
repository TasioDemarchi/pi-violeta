/**
 * goodmorning-said — the stories the brief has already told, in `violeta.json`.
 *
 * The brief runs on every session, the feed barely moves in an hour and the
 * model is deterministic: the same candidates produce the same sentence, word
 * for word, so five sessions in an afternoon told the same news five times.
 * A story that has been said is dropped from the candidates, and when all of
 * them have been, the day's line falls to the joke -- which is the same path
 * as a day with no news, and the honest answer to "nothing new since you last
 * looked".
 *
 * Titles, not links: it is what a story is recognised by here, and a list of
 * forty of them is small enough to keep in the same file as the preferences.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Enough for a day of sessions; the 12 hour freshness window retires the
 * rest on its own. */
export const SAID_LIMIT = 40;

/** The titles already told. A missing file, corrupt JSON or anything that is
 * not a list of strings all mean nothing has been said. */
export function readSaidStories(file: string): string[] {
	try {
		const said = (JSON.parse(readFileSync(file, "utf8")) as { briefSaid?: unknown })?.briefSaid;
		return Array.isArray(said) ? said.filter((title): title is string => typeof title === "string") : [];
	} catch {
		return [];
	}
}

/** Add a title, newest first, keeping the list bounded and every unrelated
 * key in the file. A title already in the list is moved to the front rather
 * than duplicated. */
export function rememberSaidStory(file: string, title: string): void {
	let config: Record<string, unknown> = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	const previous = readSaidStories(file).filter((other) => other !== title);
	const briefSaid = [title, ...previous].slice(0, SAID_LIMIT);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, briefSaid }, null, "\t") + "\n");
}
