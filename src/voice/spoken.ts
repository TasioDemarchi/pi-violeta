/** What gets read aloud: the closing `Voz:` section the model writes FOR THE EAR,
 * never the written reply. Lists, arrows, code and paths are tedious or
 * meaningless spoken, and a written summary squeezed into a few lines is still a
 * written text: it needs its own script. */

const SPOKEN_START = /^[ \t>*_-]*(?:🔊\s*)?\**Voz\**\s*:\s*\**\s*/gim;
/** About five minutes of speech at the default pace; kokoro took 4,000+ characters in one call. */
export const MAX_SPOKEN_CHARS = 4500;

function clean(text: string): string {
	const paragraphs = text
		.replace(/\s*(?:→|⇒|->|=>)\s*/g, ", ")
		.replace(/\p{Extended_Pictographic}\uFE0F?/gu, "")
		.replace(/`+/g, "")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/https?:\/\/\S+/g, "")
		// each list item becomes its own sentence, so items do not run together
		.replace(/^[ \t]*(?:[-*•]|\d+[.)])\s+/gm, "\n\n")
		.replace(/[*_#>|]+/g, "")
		.split(/\n\s*\n/)
		.map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
		.filter((paragraph) => paragraph !== "");
	// Paragraphs stay separate (blank line) so the player can leave a pause between
	// them, and each one ends in a mark so the voice closes the sentence.
	return paragraphs.map((paragraph) => (/[.!?…:]$/.test(paragraph) ? paragraph : `${paragraph}.`)).join("\n\n");
}

/** Everything from the LAST `Voz:` marker to the end of the reply, cleaned for
 * speech; undefined when there is none. */
export function extractSpoken(text: string | undefined): string | undefined {
	if (!text) return undefined;
	let from: number | undefined;
	for (const match of text.matchAll(SPOKEN_START)) from = match.index + match[0].length;
	if (from === undefined) return undefined;
	const spoken = clean(text.slice(from));
	if (spoken === "") return undefined;
	return fit(spoken, MAX_SPOKEN_CHARS);
}

/** Cut at the last sentence end that fits, so it never stops mid-sentence. */
function fit(spoken: string, max: number): string {
	if (spoken.length <= max) return spoken;
	const head = spoken.slice(0, max);
	const end = Math.max(head.lastIndexOf(". "), head.lastIndexOf("? "), head.lastIndexOf("! "), head.lastIndexOf(".\n"));
	return end > max / 2 ? head.slice(0, end + 1) : `${head.replace(/\s\S*$/, "")}…`;
}

/** The whole-reply mode reads much more: about twelve minutes. */
export const MAX_FULL_CHARS = 12000;

/** The WHOLE written reply, made speakable: code blocks and tables are replaced by a
 * short notice, markup and arrows disappear, each list item becomes a sentence, and a
 * closing `Voz:` section (another mode's script) is dropped so nothing is said twice. */
export function extractFull(text: string | undefined): string | undefined {
	if (!text) return undefined;
	let from: number | undefined;
	for (const match of text.matchAll(SPOKEN_START)) from = match.index;
	const body = from === undefined ? text : text.slice(0, from);
	const spoken = clean(
		body
			.replace(/```[\s\S]*?(?:```|$)/g, "\n\nHay código en pantalla.\n\n")
			.replace(/(?:^[ \t]*\|.*(?:\n|$))+/gm, "\n\nHay una tabla en pantalla.\n\n"),
	);
	return spoken === "" ? undefined : fit(spoken, MAX_FULL_CHARS);
}

/** Added while voice is on in "completo" mode: the reply itself is what is heard. */
export const LISTEN_PROMPT = `# Voice is on: your reply will be read aloud in full

The user may be listening and unable to read the screen, so the whole reply is spoken
to them. Write it so it works heard: say what the thing is before how it works, so the
subject is never assumed; explain each term when you first use it; prefer plain
sentences and a concrete example over tables, arrows and dense lists; and keep code and
file paths to what is needed, since code blocks are not read (they are replaced by a
note that there is code on screen). If the question is too open to answer well, ask
first what is missing instead of answering in the abstract.`;

/** Appended to the system prompt ONLY while voice is on, so voice off changes nothing. */
export const VOICE_PROMPT = `# Voice is on: teach, do not summarize

The user may be listening and unable to read the screen, and wants to **understand**,
not to be informed. At the end of your **final** reply of a turn (not progress
messages) add a last section that starts with the line \`Voz:\` followed by a
**spoken script**, with nothing after it. Answer fully in the text above for the
screen; the script is a separate version made for the ear.

The script **is the answer itself, spoken**, never a description of it ("te respondí",
"conté sin problemas"). If asked to count, say the numbers; if you need a decision, say
the question and the options with their benefit and cost. It must be **self-contained**:
someone who cannot read anything else has to understand it and be able to decide.

When the user asks you to explain something, **teach it**, in this order:
1. The idea in one plain sentence.
2. A concrete everyday example or comparison that carries the idea, developed over
   several sentences, not named in passing.
3. The parts, one at a time, each tied back to the example. Say the order in words
   ("primero", "segundo", "y por último").
4. The usual mistake or the exception, and what it costs.
5. A closing recap of the two or three things to keep, then offer a next step
   ("¿querés que profundice en alguna parte?").
Even if the user says "brevemente", an explanation is never squeezed into a few lines:
shorter means fewer parts, not fewer words per part. Use about one to two minutes for a
brief request and three to four for a full one (roughly 1,000 to 3,500 characters).
For a plain factual answer or a count, keep it as short as the answer.

Write for the ear, not the eye:
- Short sentences, one idea each; separate each step of the teaching into its own
  paragraph, so there is a pause between them.
- If you must use a technical term, explain it in the same breath.
- No lists, tables, arrows, parentheses, symbols, code, file paths or commands. Never
  read out what is long and technical; say the essence and where to read the rest.`;
