/**
 * guard-explain — the dangerous command, in words the owner reads.
 *
 * The guard's dialog used to show the command itself, which is exactly the
 * thing the owner said he sometimes cannot read ("a veces no lo entiendo").
 * So a free model is asked what it does, and the dialog shows the answer:
 * action, files, folders. The command still appears, on one line underneath,
 * because the summary is written by a model that can be wrong and that dialog
 * is the last thing standing between a mistake and a deleted directory.
 *
 * Everything here is pure. The model call is the extension's job; this module
 * only builds the request and reads the answer, so both can be tested without
 * a network, and a mangled answer is detected rather than shown.
 */

import { guard as t } from "../i18n.ts";

export interface Explanation {
	/** What the command does, in one sentence. */
	action: string;
	/** The files it names, as the model read them. */
	files?: string;
	/** The folders it names. */
	folders?: string;
}

/** Longest a field may be before it is cut. The dialog is one box above the
 * editor, and a model that decides to write an essay must not push the Yes/No
 * off the screen. */
export const FIELD_MAX = 200;

/** Lowercase and unaccented, so "Accion", "ACCIÓN" and "acción" are one label. */
const flatten = (text: string): string => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase();

/** The Spanish words the guard model sometimes answers with instead of the
 * dictionary's English labels. Synonyms, not a second language: the parser
 * flattens case and accents, so every spelling of them matches. */
const SPANISH_ALIASES: Record<keyof Explanation, readonly string[]> = {
	action: ["accion"],
	files: ["archivos"],
	folders: ["carpetas"],
};

function cut(value: string): string {
	return value.length <= FIELD_MAX ? value : `${value.slice(0, FIELD_MAX).trimEnd()}…`;
}

/**
 * Read the model's three lines, or decide it did not answer them.
 *
 * Returning undefined is a real outcome, not an error: the caller then shows
 * the command as it always did. That is also what happens when the model
 * answers under a label nobody asked for -- an "Answer:" line is not an
 * explanation. The three dictionary labels are matched in English and in their
 * Spanish synonyms (`accion`/`archivos`/`carpetas`), because the cheap guard
 * model sometimes answers in the language the prompt asks for the content in;
 * that answer is just as readable as the English-labelled one.
 */
export function parseExplanation(text: string): Explanation | undefined {
	const labels = t.explainLabels;
	const wanted: [keyof Explanation, readonly string[]][] = [
		["action", [flatten(labels.action), ...SPANISH_ALIASES.action]],
		["files", [flatten(labels.files), ...SPANISH_ALIASES.files]],
		["folders", [flatten(labels.folders), ...SPANISH_ALIASES.folders]],
	];
	const found: Partial<Record<keyof Explanation, string>> = {};
	for (const raw of text.split("\n")) {
		// Bullets, dashes, quotes and bold are the model's decoration; the
		// content is what follows the colon.
		const line = raw.replace(/\*\*/g, "").replace(/^[\s*\-–—•>#]+/, "").trim();
		const at = line.indexOf(":");
		if (at <= 0) continue;
		const label = flatten(line.slice(0, at).trim());
		const value = line.slice(at + 1).trim();
		if (value === "") continue;
		for (const [key, wantedLabels] of wanted) {
			if (wantedLabels.includes(label) && found[key] === undefined) found[key] = cut(value);
		}
	}
	// Without the action there is nothing worth showing: the other two lines
	// alone are a list of paths, which is what the command already was.
	if (found.action === undefined) return undefined;
	return { action: found.action, files: found.files, folders: found.folders };
}

/** The dialog body: the summary first, then why the guard stopped, then the
 * command itself on one line, then the question. */
export function explainedBody(explanation: Explanation, command: string, reasons: readonly string[]): string {
	const labels = t.explainLabels;
	const lines = [`${labels.action}: ${explanation.action}`];
	if (explanation.files) lines.push(`${labels.files}: ${explanation.files}`);
	if (explanation.folders) lines.push(`${labels.folders}: ${explanation.folders}`);
	lines.push("", t.explainWhy(reasons), `${t.explainCommandLabel}: ${command}`, "", t.explainQuestion);
	return lines.join("\n");
}
