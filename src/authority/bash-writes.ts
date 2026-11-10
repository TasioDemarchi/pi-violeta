/** What a shell command writes — the paths, not the permission.
 *
 * `edit` and `write` are not the only way to put bytes on disk, and in the
 * measured window the session spent 68,9% of its turns in `bash`. A lock that
 * covers the two file tools and leaves the shell open is a closed door next to
 * an open window.
 *
 * This is a **whitelist of shapes that write** (D2), never a blacklist of
 * shapes that do not. An unknown command writes nothing as far as this module
 * is concerned, because the two mistakes do not cost the same: a false
 * negative lets one write through, a false positive stops the owner from
 * working. `rm` is deliberately absent — deleting already opens the guard's
 * destructive dialog, and two guards over one fact would give two different
 * messages for it (D3).
 *
 * The tokenizer is the guard's own (D1), so quotes, heredoc bodies, wrappers
 * and subshells are read exactly as the destructive check reads them.
 *
 * It answers paths and stops there: whether a path is the caller's business is
 * the rule's question, not this module's. */

import { type Token, executable, headCursor, segments } from "../guard/command-guard.ts";
import { resolvePath } from "../guard/paths.ts";

/** `>`, `>>`, `2>`, `>f`, `2>>f` — but never `>&`, so `2>&1` is not a write. */
const REDIRECT = /^\d*>>?(?!&)(.*)$/;

/** Sumideros del sistema: escribirles no escribe nada. Lo encontró la prueba
 * por prompt — un `scout` frenado por `cat archivo 2>/dev/null`, que es una
 * lectura. Tratarlos como escritura haría insoportable al agente que sólo
 * mira, y no protege de nada. */
const SINKS: ReadonlySet<string> = new Set(["/dev/null", "/dev/stdout", "/dev/stderr", "/dev/tty", "/dev/fd/1", "/dev/fd/2"]);

/** In-place editors: the flag that turns a filter into a writer. */
const IN_PLACE: Record<string, RegExp> = {
	sed: /^-[^-]*i/,
	perl: /^-[^-]*i/,
	awk: /^-i$|^--in-place/,
};

/** Commands that create or overwrite the LAST operand. */
const WRITES_LAST = new Set(["cp", "mv", "install", "ln"]);
/** Commands that create or overwrite EVERY operand. */
const WRITES_ALL = new Set(["touch", "truncate", "tee"]);

const isFlag = (value: string) => value.startsWith("-") && value !== "-";

/** Flags whose NEXT token is a value, not a file. Without this, `truncate -s 0
 * file` reads `0` as a file and `sed -e 's/a/b/' file` reads the script as one. */
const VALUE_FLAGS: Record<string, readonly string[]> = {
	sed: ["--expression", "--file", "-l", "--line-length"],
	perl: ["-0", "-m", "-M", "-F"],
	awk: ["-i", "-v", "--source", "--assign"],
	truncate: ["-s", "--size", "-r", "--reference"],
	install: ["-m", "--mode", "-o", "--owner", "-g", "--group", "-t", "--target-directory"],
	cp: ["-t", "--target-directory", "-S", "--suffix"],
	mv: ["-t", "--target-directory", "-S", "--suffix"],
	ln: ["-t", "--target-directory", "-S", "--suffix"],
};

/** Commands whose first bare operand is a program, not a file: `sed 's/a/b/'`. */
const SCRIPT_FIRST = new Set(["sed", "perl", "awk"]);
/** A short-flag cluster ending in `e` or `f` takes the next token: `-pe`, `-ne`, `-f`. */
const TAKES_NEXT = /^-[^-]*[ef]$/;

/** Redirection targets in a segment: `> f`, `>f`, `>> f`. The form is read from
 * the RAW token, so a `>` that arrived inside quotes is text (D4). Returns the
 * targets and every token index they consumed, so an operand scan does not
 * count a redirection target twice. */
function redirects(tokens: readonly Token[]): { targets: string[]; consumed: Set<number> } {
	const targets: string[] = [];
	const consumed = new Set<number>();
	for (let index = 0; index < tokens.length; index++) {
		const token = tokens[index]!;
		if (token.operator) continue;
		const match = REDIRECT.exec(token.raw);
		if (!match) continue;
		consumed.add(index);
		const glued = match[1]!.trim();
		if (glued !== "") {
			targets.push(glued);
			continue;
		}
		const next = tokens[index + 1];
		if (next && !next.operator) {
			targets.push(next.value);
			consumed.add(++index);
		}
	}
	return { targets, consumed };
}

/** The bare words of a command that name files: flags are dropped, the value of
 * a value-taking flag is dropped with it, and an inline script is dropped when
 * no `-e`/`-f` introduced one. */
function fileOperands(name: string, args: readonly Token[], offset: number, consumed: ReadonlySet<number>): string[] {
	const valueFlags = new Set(VALUE_FLAGS[name] ?? []);
	const words: string[] = [];
	let skipNext = false;
	let scriptGiven = false;
	for (let index = 0; index < args.length; index++) {
		const token = args[index]!;
		if (token.operator || consumed.has(offset + index)) continue;
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (isFlag(token.value)) {
			if (valueFlags.has(token.value) || (SCRIPT_FIRST.has(name) && TAKES_NEXT.test(token.value))) skipNext = true;
			if (SCRIPT_FIRST.has(name) && TAKES_NEXT.test(token.value)) scriptGiven = true;
			continue;
		}
		words.push(token.value);
	}
	if (SCRIPT_FIRST.has(name) && !scriptGiven) words.shift();
	return words;
}

function segmentWrites(tokens: readonly Token[], cwd: string): string[] {
	const { targets, consumed } = redirects(tokens);
	const found = [...targets];

	const cursor = headCursor(tokens);
	const head = tokens[cursor];
	if (head && !head.operator && !consumed.has(cursor)) {
		const name = executable(head.value);
		const args = tokens.slice(cursor + 1);
		const flags = args.filter((token) => !token.operator && isFlag(token.value)).map((token) => token.value);
		const words = fileOperands(name, args, cursor + 1, consumed);

		const inPlace = IN_PLACE[name];
		if (inPlace && flags.some((flag) => inPlace.test(flag))) {
			found.push(...words);
		} else if (WRITES_LAST.has(name)) {
			const last = words.at(-1);
			if (last !== undefined) found.push(last);
		} else if (WRITES_ALL.has(name)) {
			found.push(...words);
		} else if (name === "dd") {
			for (const word of words) if (word.startsWith("of=")) found.push(word.slice(3));
		} else if (name === "patch") {
			// It writes whatever the diff names, which is not in the command. The
			// honest answer is "the working directory", so a patch inside an open
			// contract is refused and one outside the project is not.
			found.push(cwd);
		}
	}
	return found;
}

/** Every path `command` would write, resolved against `cwd`. Empty for a
 * command this module does not recognise as writing. */
export function bashWrites(command: string, cwd: string, home: string): string[] {
	const found: string[] = [];
	for (const segment of segments(command)) {
		for (const target of segmentWrites(segment, cwd)) {
			if (target === "") continue;
			const resolved = resolvePath(target, cwd, home);
			if (SINKS.has(resolved)) continue;
			found.push(resolved);
		}
	}
	return found;
}
