/**
 * Destructive-command recognizer, pure logic.
 *
 * Recognizable executable forms only, deliberately not a shell/SQL
 * interpreter or a sandbox: no expansion, no script loading, no remote
 * inspection. A match needs a destructive head command (after wrappers,
 * assignments and reserved words) in a shell segment; quoted strings and
 * heredoc bodies are data and never match. Ideas ported (simplified) from
 * gentle-pi's MIT-licensed destructive-command-guard.
 */

import { guardReasons, guard as i18nGuard } from "../i18n.ts";

export type DestructionKind = "filesystem" | "git" | "database" | "process";

/** Tools whose `command` input runs in a shell. The guard treats every one of
 * them exactly like `bash` (destructive forms, catastrophic targets, and
 * outside-project path grants), or the background tools would bypass it. */
export const SHELL_COMMAND_TOOLS: ReadonlySet<string> = new Set(["bash", "bash_background", "monitor"]);

export interface DestructiveMatch {
	kind: DestructionKind;
	/** Short human-readable reason, shown in the confirmation dialog. */
	reason: string;
	/** Catastrophic target (e.g. recursive removal of `/` or `~`): deny without asking. */
	hardDeny: boolean;
}

export type DestructiveDecision =
	| { action: "allow" }
	| { action: "confirm"; reasons: string[] }
	| { action: "block"; reasons: string[] }
	| { action: "deny"; reason: string };

export interface Token {
	value: string;
	raw: string;
	operator: boolean;
}

const OPERATORS = new Set([";", "&&", "||", "|", "&", "\n", "(", ")"]);

/** Literal, named heredocs are data, not executable shell segments; offsets are preserved. */
const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g;

function blankHeredocs(command: string): string {
	return command.replace(HEREDOC_RE, (raw) => {
		const headerLength = raw.indexOf("\n") + 1;
		return raw.slice(0, headerLength) + " ".repeat(raw.length - headerLength);
	});
}

/**
 * Split into tokens; quoted arguments stay whole so their contents can never
 * become a command head or an operator, and quoted/escaped operators are words.
 *
 * Exported because the authority's shell rule reads the very same command: two
 * definitions of what a token is would eventually disagree about a quote, a
 * heredoc or a subshell, and the owner would get two different answers for one
 * command (S1/D1, tasks/authority-bash.md).
 */
export function tokenize(command: string): Token[] {
	const tokens: Token[] = [];
	const pattern = /(?:"(?:\\.|[^"\\])*"|'[^']*'|\\.|[^\s;&|()'"\\])+|&&|\|\||[;&|()\n]/g;
	for (const match of command.matchAll(pattern)) {
		const raw = match[0];
		const value = raw.replace(
			/"((?:\\.|[^"\\])*)"|'([^']*)'|\\(.)/g,
			(_raw, double: string | undefined, single: string | undefined, escaped: string | undefined) => {
				if (double !== undefined) return double.replace(/\\(["\\$`])/g, (_escape, char: string) => char);
				return single ?? escaped ?? "";
			},
		);
		tokens.push({ value, raw, operator: OPERATORS.has(raw) });
	}
	return tokens;
}

export const executable = (value: string) => value.split("/").at(-1) ?? value;

/** Flags of familiar wrappers whose next token is a value, not a command argument. */
const WRAPPER_VALUE_FLAGS: Record<string, readonly string[]> = {
	env: ["-u", "--unset", "-C", "--chdir"],
	sudo: ["-u", "-g", "-h", "-p", "-C", "--user", "--group", "--host", "--prompt", "--chdir"],
	timeout: ["-s", "--signal", "-k", "--kill-after"],
	xargs: ["-n", "-I", "-P", "--max-args", "--replace", "--max-procs"],
};
const WRAPPERS = ["env", "sudo", "command", "exec", "nohup", "timeout", "xargs"];
// Unquoted reserved words that open a compound body are followed by a command.
const RESERVED = new Set(["then", "else", "elif", "do", "{", "!", "if", "while", "until"]);

/** Index of the executable token after reserved words, assignments and familiar
 * wrappers. Exported with `tokenize` and `segments` so the authority's shell
 * rule finds the same head this guard does, `sudo sed -i` included (D1). */
export function headCursor(segment: readonly Token[]): number {
	let cursor = 0;
	while (cursor < segment.length && segment[cursor].raw === segment[cursor].value && RESERVED.has(segment[cursor].value)) cursor++;
	while (cursor < segment.length) {
		const token = segment[cursor];
		if (token.raw === token.value && /^[A-Za-z_][A-Za-z_0-9]*=/.test(token.value)) {
			cursor++;
			continue;
		}
		const name = executable(token.value);
		if (token.raw !== token.value || !WRAPPERS.includes(name)) break;
		cursor++;
		while (cursor < segment.length && segment[cursor].value.startsWith("-") && segment[cursor].raw === segment[cursor].value) {
			const flag = segment[cursor++].value;
			if (flag === "--") break;
			if (WRAPPER_VALUE_FLAGS[name]?.includes(flag)) cursor++;
		}
		// `timeout 10 rm ...`: the duration is a plain positional value.
		if (name === "timeout") cursor++;
	}
	return cursor;
}

/** Catastrophic removal targets: `/`, `/*`, `~`, `$HOME` (optionally with a trailing slash or `/.`). */
const CATASTROPHIC = /^(?:\/+|\/\*+\/?|(?:~|\$\{?HOME\}?)\/?(?:\*+|\.\*|\.)?)$/;
// Top-level system directories: recursive chmod/chown on these is "broad".
const BROAD_DIR = /^(?:\/+|\/\*+\/?|~\/?\.?|\$\{?HOME\}?\/?\.?|\/(?:etc|usr|var|home|opt|bin|sbin|lib|lib64|boot|dev|srv|root|proc|sys)(?:\/|$))/;
const hasShortFlag = (args: readonly string[], letters: string) => args.some((arg) => new RegExp(`^-[^-]*[${letters}]`).test(arg));

/** Operands of a plain `rm` invocation: unquoted, non-flag arguments after the option region. */
function rmTargets(args: readonly Token[]): string[] {
	const targets: string[] = [];
	let options = true;
	for (const arg of args) {
		if (arg.raw !== arg.value) continue;
		if (options && arg.value === "--") options = false;
		else if (options && arg.value.startsWith("-")) continue;
		else targets.push(arg.value);
	}
	return targets;
}

function rmMatches(args: readonly Token[]): DestructiveMatch | undefined {
	const values = args.map((arg) => arg.value);
	const recursive = hasShortFlag(values, "rR") || values.includes("--recursive");
	const forced = hasShortFlag(values, "f") || values.includes("--force");
	if (!recursive && !forced) return undefined;
	const targets = rmTargets(args);
	const hardDeny = recursive && targets.some((target) => CATASTROPHIC.test(target));
	return {
		kind: "filesystem",
		reason: recursive ? guardReasons.recursiveRemoval : guardReasons.forcedRemoval,
		hardDeny,
	};
}

/** A signal spec: `-9`, `-KILL`, `-SIGKILL`, `-s 9`, `--signal=TERM`. Everything
 * else after the command name is a target. */
const SIGNAL_FLAG = /^-(?:[0-9]{1,2}|[A-Za-z]+)$/;
const SIGNAL_VALUE_FLAG = /^(?:-s|--signal)$/;

/**
 * `kill`, `pkill` and `killall`.
 *
 * This exists because of a real incident: `ps -eo pid,ppid --ppid "$D"` ignores
 * the `--ppid` filter when `-e` is present, so `$H` held EVERY pid on the
 * machine, and `kill -9 $H` took down the owner's whole graphical session --
 * compositor, editor, terminals and the agent itself. The guard allowed it
 * without a word, because it had no rule for killing anything at all.
 *
 * The line drawn here: a literal pid is the one case the harness can bound, so
 * it passes. Anything the harness cannot count -- a variable, a substitution, a
 * pattern -- asks first. A process GROUP (`-1`, `0`, a negative pid) is denied
 * outright: `kill -9 -1` means "every process I am allowed to signal", which is
 * exactly what happened, and there is no version of it that is a good idea
 * inside a coding session.
 */
function killMatches(name: string, args: readonly Token[]): DestructiveMatch | undefined {
	// pkill and killall take patterns, never pids: the blast radius is whatever
	// the pattern happens to match, which is the other way this went wrong
	// (`pkill -f` repeatedly killed the agent's own shell).
	if (name === "pkill" || name === "killall") {
		const pattern = args.some((arg) => !arg.value.startsWith("-"));
		return pattern ? { kind: "process", reason: guardReasons.killPattern(name), hardDeny: false } : undefined;
	}
	const targets: Token[] = [];
	let signalSeen = false;
	for (let i = 0; i < args.length; i++) {
		const token = args[i]!;
		if (SIGNAL_VALUE_FLAG.test(token.value)) {
			i++; // its value is the signal name, not a target
			signalSeen = true;
			continue;
		}
		if (token.value.startsWith("--")) continue;
		// The FIRST `-9`-shaped token is the signal; a later one is a process group.
		if (!signalSeen && SIGNAL_FLAG.test(token.value)) {
			signalSeen = true;
			continue;
		}
		targets.push(token);
	}
	if (targets.length === 0) return undefined;
	// A process group, or init: `kill -9 -1` is "everything I can signal".
	if (targets.some((target) => /^-\d+$/.test(target.value) || target.value === "0" || target.value === "1")) {
		return { kind: "process", reason: guardReasons.killEverything, hardDeny: true };
	}
	// A pid the harness can read is a pid it can bound. Anything else -- `$H`,
	// `$(pgrep ...)`, a backtick -- is an unknown number of unknown processes.
	if (targets.every((target) => /^\d+$/.test(target.value) && target.raw === target.value)) return undefined;
	return { kind: "process", reason: guardReasons.killUnknownTarget, hardDeny: false };
}

function gitMatches(args: readonly Token[]): DestructiveMatch | undefined {
	// Skip global git options (and their values) before the action.
	let index = 0;
	while (index < args.length && args[index].value.startsWith("-")) {
		const flag = args[index++].value;
		if (["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--super-project"].includes(flag)) index++;
	}
	const action = args[index]?.value;
	const flags = args.slice(index + 1).map((arg) => arg.value);
	// `git push origin +main` forces by refspec; the leading `+` is the force marker.
	const force = flags.some((flag) => /^--force/.test(flag) || hasShortFlag([flag], "f") || (action === "push" && /^\+\S/.test(flag)));
	const match = (reason: string): DestructiveMatch => ({ kind: "git", reason, hardDeny: false });
	// Targets that mean "the whole tree" for checkout/restore.
	const wholeTree = (values: readonly string[]) => values.some((v) => v === "." || v === ".*" || v.startsWith(":/"));
	if (action === "push" && force) return match(guardReasons.gitForcePush);
	if (action === "reset" && flags.includes("--hard")) return match(guardReasons.gitResetHard);
	if (action === "clean" && force) return match(guardReasons.gitCleanForce);
	if (action === "branch" && (hasShortFlag(flags, "D") || (force && (flags.includes("--delete") || hasShortFlag(flags, "d"))))) {
		return match(guardReasons.gitBranchDelete);
	}
	if (action === "stash" && flags.some((flag) => flag === "drop" || flag === "clear")) return match(guardReasons.gitStashDropClear);
	if (action === "checkout" && (force || wholeTree(flags))) return match(guardReasons.gitCheckoutWholeTree);
	if (action === "restore" && wholeTree(flags)) return match(guardReasons.gitRestoreWholeTree);
	// rebase is deliberately not covered.
	return undefined;
}

/** Strip SQL comments and quoted strings/identifiers, then look at each statement. */
function sqlDestroys(sql: string): string | undefined {
	const code = sql.replace(
		/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[(?:\]\]|[^\]])*\]/g,
		(raw) => (/^["`[]/.test(raw) ? "identifier" : " "),
	);
	for (const statement of code.split(";")) {
		if (/^\s*(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)\b|TRUNCATE\s+(?:TABLE\s+)?\S)/i.test(statement)) return guardReasons.sqlDropTruncate;
		if (!/^\s*DELETE\s+FROM\s+\S/i.test(statement)) continue;
		if (!/\bWHERE\b/i.test(statement) || /\bWHERE\s+(?:1\s*=\s*1|TRUE)\s*$/i.test(statement.trim())) return guardReasons.sqlDeleteWithoutWhere;
	}
	return undefined;
}

function sqlMatches(command: string, args: readonly Token[]): DestructiveMatch | undefined {
	const payloads = args.map((arg) => arg.value.replace(/^(?:--command|--execute)=/, ""));
	const reason = payloads.map(sqlDestroys).find((found) => found !== undefined);
	return reason ? { kind: "database", reason, hardDeny: false } : undefined;
}

function matchSegment(command: string, segment: readonly Token[], depth: number): DestructiveMatch[] {
	if (depth > 4) return [];
	const cursor = headCursor(segment);
	const head = segment[cursor];
	const matches: DestructiveMatch[] = [];
	// Only unquoted heads are commands; quoted prose can never match.
	if (!head || head.raw !== head.value) return matches;
	const name = executable(head.value);
	const args = segment.slice(cursor + 1);
	const values = args.map((arg) => arg.value);
	const add = (match: DestructiveMatch) => matches.push(match);

	// `sh -c '...'`, `bash -c "..."` and `eval` run their payload as a script.
	if (["sh", "bash", "zsh", "dash"].includes(name)) {
		const flag = values.findIndex((value) => /^-[a-z]*c[a-z]*$/.test(value));
		if (flag >= 0 && values[flag + 1]) matches.push(...recognizeDestructiveCommands(values[flag + 1], depth + 1));
	}
	if (name === "eval") {
		const payload = (values[0] === "--" ? values.slice(1) : values).join(" ");
		matches.push(...recognizeDestructiveCommands(payload, depth + 1));
	}
	if (name === "rm") {
		const match = rmMatches(args);
		if (match) add(match);
	}
	if (name === "find" && values.includes("-delete")) add({ kind: "filesystem", reason: guardReasons.findDelete, hardDeny: false });
	if (name === "shred" && values.length > 0) add({ kind: "filesystem", reason: guardReasons.shred, hardDeny: false });
	if (name === "dd" && values.some((value) => /^of=\/dev\//.test(value))) {
		add({ kind: "filesystem", reason: guardReasons.ddDevice, hardDeny: false });
	}
	if (name === "mkfs" || name.startsWith("mkfs.")) add({ kind: "filesystem", reason: guardReasons.mkfs, hardDeny: false });
	if ((name === "chmod" || name === "chown") && (hasShortFlag(values, "R") || values.includes("--recursive"))) {
		const targets = args.filter((arg) => arg.raw === arg.value && !arg.value.startsWith("-")).map((arg) => arg.value);
		if (targets.some((target) => BROAD_DIR.test(target))) {
			add({ kind: "filesystem", reason: guardReasons.recursiveBroadPath(name), hardDeny: false });
		}
	}
	if (name === "kill" || name === "pkill" || name === "killall") {
		const match = killMatches(name, args);
		if (match) add(match);
	}
	if (name === "git") {
		const match = gitMatches(args);
		if (match) add(match);
	}
	if (["psql", "mysql", "mariadb", "sqlite3"].includes(name)) {
		const match = sqlMatches(command, args);
		if (match) add(match);
	}
	return matches;
}

/**
 * All destructive matches in a command string. Segments separated by `;`, `&&`,
 * `||`, `|`, `&`, newlines or parentheses are checked independently; wrappers,
 * assignments and reserved words are looked through; quoted strings and
 * heredoc bodies are data and never match.
 */
export function recognizeDestructiveCommands(command: string, depth = 0): DestructiveMatch[] {
	if (depth > 4) return [];
	const matches: DestructiveMatch[] = [];
	for (const segment of segments(command)) matches.push(...matchSegment(command, segment, depth));
	return matches;
}

/** The shell segments of a command, in order (quoted tokens stay whole).
 * Heredoc bodies are blanked first, so their contents are data, never code. */
export function segments(command: string): Token[][] {
	command = blankHeredocs(command);
	const tokens = tokenize(command);
	const out: Token[][] = [];
	let start = 0;
	for (let end = 0; end <= tokens.length; end++) {
		if (end < tokens.length && !tokens[end].operator) continue;
		out.push(tokens.slice(start, end));
		start = end + 1;
	}
	return out;
}

/** Interpreters that take their program inline, and the flag that introduces it: `node -e`, `python -c`, `perl -e`, `sh -c`. */
const INLINE_VALUE_FLAGS: Record<string, readonly string[]> = {
	node: ["-e", "--eval"],
	nodejs: ["-e", "--eval"],
	python: ["-c"],
	python2: ["-c"],
	python3: ["-c"],
	perl: ["-e"],
	sh: ["-c"],
	bash: ["-c"],
	zsh: ["-c"],
	dash: ["-c"],
};
const DOWNLOADERS = new Set(["curl", "wget"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);

const headName = (segment: readonly Token[]): string | undefined => {
	const head = segment[headCursor(segment)];
	// Only unquoted heads are commands; quoted prose can never be a payload.
	return head && head.raw === head.value ? executable(head.value) : undefined;
};

/** Whether this one segment hands code to an interpreter. */
function inlineIn(segment: readonly Token[]): boolean {
	const name = headName(segment);
	if (name === undefined) return false;
	if (name === "eval") return segment.length > headCursor(segment) + 1;
	const flags = INLINE_VALUE_FLAGS[name];
	if (flags === undefined) return false;
	return segment.slice(headCursor(segment) + 1).some((token) => {
		if (token.raw !== token.value) return false;
		return flags.some((flag) => token.value === flag || (flag.startsWith("--") && token.value.startsWith(`${flag}=`)));
	});
}

/**
 * Whether a command hands its program to an interpreter in a form no recognizer
 * can read: `node -e`, `node --eval`, `python -c`, `perl -e`, `sh -c`,
 * `bash -c`, `eval`, and `curl … | sh` / `wget … | bash`.
 *
 * `recognizeDestructiveCommands` answers "is this a form I know is dangerous?".
 * This answers the other question — "can I read it at all?" — which is the one
 * that matters when the harness is about to run model-written text on its own
 * (a contract `Check`, S6). Pure, and built on the same tokenizer as the
 * recognizer: quoting, wrappers and heredoc bodies behave identically.
 */
export function runsInlinePayload(command: string): boolean {
	const all = segments(blankHeredocs(command));
	const heads = all.map(headName);
	return all.some((segment, index) => {
		if (inlineIn(segment)) return true;
		// `curl … | sh`: the payload is on the other side of the pipe.
		const previous = heads[index - 1];
		const current = heads[index];
		return previous !== undefined && current !== undefined && DOWNLOADERS.has(previous) && SHELLS.has(current);
	});
}

/**
 * The extension-level decision for one bash call: `allow` when nothing
 * matches; `deny` (no prompt) for catastrophic targets; `confirm` when a UI
 * can ask; `block` when it cannot (no UI, or a non-interactive child).
 */
export function guardDecision(command: string, canAsk: boolean): DestructiveDecision {
	const matches = recognizeDestructiveCommands(command);
	if (matches.length === 0) return { action: "allow" };
	const catastrophic = matches.find((match) => match.hardDeny);
	if (catastrophic) return { action: "deny", reason: i18nGuard.catastrophic(catastrophic.reason) };
	const reasons = [...new Set(matches.map((match) => match.reason))];
	return canAsk ? { action: "confirm", reasons } : { action: "block", reasons };
}
