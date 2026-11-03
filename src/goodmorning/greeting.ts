/**
 * goodmorning-greeting — the spoken morning brief, as pure text.
 *
 * Everything here is a function of its arguments: the clock and whatever the
 * sources answered. Two rules shape it, and both come from the brief being
 * heard rather than read:
 *
 * - Numbers are spelled out. A small TTS reads "18,9" unevenly and "19" with
 *   no unit, while "diecinueve grados" is unambiguous.
 * - Every clause is optional. A source that failed drops its own clause; the
 *   brief never says it has no data and never reads an error.
 *
 * The text is Spanish here rather than in src/i18n.ts on purpose: it is
 * content, not interface chrome. The voice that reads it is a Spanish voice,
 * and the owner dictated this line in Spanish, word for word.
 */

const SMALL = [
	"cero",
	"uno",
	"dos",
	"tres",
	"cuatro",
	"cinco",
	"seis",
	"siete",
	"ocho",
	"nueve",
	"diez",
	"once",
	"doce",
	"trece",
	"catorce",
	"quince",
	"dieciséis",
	"diecisiete",
	"dieciocho",
	"diecinueve",
];
const TWENTIES = [
	"veinte",
	"veintiuno",
	"veintidós",
	"veintitrés",
	"veinticuatro",
	"veinticinco",
	"veintiséis",
	"veintisiete",
	"veintiocho",
	"veintinueve",
];
const TENS: Record<number, string> = { 30: "treinta", 40: "cuarenta", 50: "cincuenta" };

/** A whole number in Spanish words, for an hour, a minute or a temperature.
 * Rounded, since no spoken brief needs a decimal, and negatives become
 * "menos tres" for a cold morning. Out of 0..59 it falls back to the digits:
 * nothing this brief says reaches that, and inventing more words for a case
 * that cannot happen would be untested code. */
export function numberInWords(value: number): string {
	const n = Math.round(value);
	if (n < 0) return `menos ${numberInWords(-n)}`;
	if (n < 20) return SMALL[n]!;
	if (n < 30) return TWENTIES[n - 20]!;
	const tens = TENS[Math.floor(n / 10) * 10];
	if (tens === undefined) return String(n);
	const unit = n % 10;
	return unit === 0 ? tens : `${tens} y ${SMALL[unit]}`;
}

/** The greeting the hour deserves. `/goodmorn` is a morning command, but the
 * owner runs it whenever, and "buenos días" at five in the afternoon is the
 * kind of detail that makes the whole thing feel canned. */
export function greetingFor(hour: number): string {
	if (hour >= 5 && hour <= 11) return "Buenos días";
	if (hour >= 12 && hour <= 19) return "Buenas tardes";
	return "Buenas noches";
}

/** Which part of the day the clock is in, as the phrase that follows the hour. */
export function partOfDay(hour: number): string {
	if (hour === 12) return "del mediodía";
	if (hour >= 20 || hour <= 4) return hour <= 4 ? "de la madrugada" : "de la noche";
	if (hour >= 13) return "de la tarde";
	return "de la mañana";
}

/** The clock as it is said out loud: "Son las cinco y veinte de la tarde". */
export function timeInWords(now: Date): string {
	const hour24 = now.getHours();
	const minutes = now.getMinutes();
	const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
	const isOne = hour12 === 1;
	const head = isOne ? "Es la una" : `Son las ${numberInWords(hour12)}`;
	const minutePart = minutes === 0 ? " en punto" : minutes === 15 ? " y cuarto" : minutes === 30 ? " y media" : ` y ${numberInWords(minutes)}`;
	return `${head}${minutePart} ${partOfDay(hour24)}`;
}

export interface BriefParts {
	/** What the owner is called, on its own: no title in front of it. */
	name: string;
	now: Date;
	/** The city the IP resolved to; absent when that lookup failed. */
	place?: string;
	tempC?: number;
	/** The sky in Spanish ("chaparrones"), already translated from the code. */
	sky?: string;
	/** The day's line: a real headline, or the joke that stands in for it. */
	extra?: string;
}

/** Symbols a headline is written with and nobody says out loud. Money comes
 * first and in that order, because the dollar forms contain the peso sign:
 * in Argentina a bare `$` is pesos, and `USD $500` is not "u-s-d five
 * hundred". Product names are deliberately left alone -- a model asked to
 * spell numbers out turned "RTX 5090" into "el modelo cinco mil noventa",
 * which is worse than the symbol ever was. */
// A number must end in a digit: `[\d.,]+` swallows the full stop that ends
// the sentence, and "aumentó 500. dólares" is read exactly as it looks.
const NUMBER = "\\d(?:[\\d.,]*\\d)?";
const FOR_THE_EAR: readonly [RegExp, string][] = [
	[new RegExp(`\\b(?:USD|US\\$|U\\$S|u\\$s)\\s?\\$?\\s?(${NUMBER})`, "g"), "$1 dólares"],
	[/\bUSD\b/g, "dólares"],
	[new RegExp(`\\$\\s?(${NUMBER})`, "g"), "$1 pesos"],
	[new RegExp(`(${NUMBER})\\s?%`, "g"), "$1 por ciento"],
	[/\s?°\s?C\b/g, " grados"],
];

/** A line written to be read, made sayable. Only the symbols: the words are
 * the model's or the outlet's, and rewriting those would be editing the news. */
export function forTheEar(text: string): string {
	let out = text;
	for (const [pattern, replacement] of FOR_THE_EAR) out = out.replace(pattern, replacement);
	return out.replace(/\s{2,}/g, " ").trim();
}

/** `extra` comes from a headline or from a model, so it arrives with or
 * without a full stop; one is added when it is missing. */
function asSentence(text: string): string {
	const trimmed = forTheEar(text);
	return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** The brief as its sentences, which is how it is spoken: each one is
 * synthesized on its own and the silence between them is measured, instead of
 * being whatever the voice model does with a full stop. Weather needs the
 * temperature and the sky together: "es de diecinueve grados" with no sky, or
 * a sky with no number, reads like something broke. */
export function briefSentences(parts: BriefParts): string[] {
	const said: string[] = [`${greetingFor(parts.now.getHours())} ${parts.name}.`, `${timeInWords(parts.now)}.`];
	if (parts.tempC !== undefined && parts.sky) {
		const where = parts.place ? ` en ${parts.place}` : "";
		// "grados", not "grados centígrados": nobody says the scale out loud.
		said.push(`El clima${where} es de ${numberInWords(parts.tempC)} grados con ${parts.sky}.`);
	}
	if (parts.extra && parts.extra.trim() !== "") said.push(asSentence(parts.extra));
	said.push("¿En qué trabajaremos hoy?");
	return said;
}

/** The same brief as one line, which is how it is shown on screen. */
export function buildBrief(parts: BriefParts): string {
	return briefSentences(parts).join(" ");
}
