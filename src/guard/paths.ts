/**
 * Path resolution and inside/outside decisions for the guard, pure logic.
 * Resolution is lexical (no symlink following, no filesystem access).
 */

import { dirname, isAbsolute, join, normalize, sep } from "node:path";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Expand `~`/`$HOME`, join relative paths to `cwd`, and normalize `..` lexically. */
export function resolvePath(input: string, cwd: string, home: string): string {
	let path = input.trim();
	if (path === "~") return normalize(home);
	if (path.startsWith("~/")) path = join(home, path.slice(2));
	else if (path.startsWith("$HOME/")) path = join(home, path.slice(6));
	else if (path.startsWith("${HOME}/")) path = join(home, path.slice(8));
	if (!isAbsolute(path)) path = join(cwd, path);
	const normalized = normalize(path);
	// path.normalize keeps a trailing slash; drop it (but keep the filesystem root).
	return normalized.length > 1 ? normalized.replace(new RegExp(escapeRegExp(sep) + "$"), "") : normalized;
}

/** True when `candidate` is `root` itself or lies underneath it. */
export function isInside(candidate: string, root: string): boolean {
	const base = root.endsWith(sep) ? root : root + sep;
	return candidate === root || candidate.startsWith(base);
}

/** Inside the project root or inside the violeta agent dir is always allowed. */
export function allowedLocation(resolved: string, root: string, agentDir?: string): boolean {
	if (isInside(resolved, root)) return true;
	return agentDir !== undefined && agentDir !== "" && isInside(resolved, agentDir);
}

/**
 * Literal path arguments of a bash command that resolve OUTSIDE the root.
 * A token counts as a path only when it is unquoted, has no whitespace and
 * looks path-like (contains a slash, or is/starts with `.` or `~`); quoted
 * prose and flags are ignored. Heredoc bodies are data and never count.
 */
export function bashPathTargets(command: string, root: string, home: string): string[] {
	const blanked = command.replace(
		/<<-?\s*(['"]?)([A-Za-z_]\w*)\1[^\n]*\n[\s\S]*?\n\2(?=\n|$)/g,
		(raw) => raw.slice(0, raw.indexOf("\n") + 1) + " ".repeat(raw.length - raw.indexOf("\n") - 1),
	);
	const targets = new Set<string>();
	for (const token of tokenizeForPaths(blanked)) {
		if (!isPathLike(token.value)) continue;
		const resolved = resolvePath(token.value, root, home);
		if (!isInside(resolved, root)) targets.add(resolved);
	}
	return [...targets].sort();
}

interface Token {
	value: string;
	raw: string;
	operator: boolean;
}

const OPERATORS = new Set([";", "&&", "||", "|", "&", "\n", "(", ")"]);

function tokenizeForPaths(command: string): Token[] {
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

function isPathLike(value: string): boolean {
	if (/\s/.test(value)) return false;
	return value.includes("/") || value === "." || value === ".." || value.startsWith("./") || value.startsWith("../") || value.startsWith("~");
}

/**
 * The path arguments a grantable tool call would touch. Tools without an
 * explicit `path` default to the working directory (always allowed), so they
 * return no targets.
 */
export function toolCallPaths(toolName: string, input: Record<string, unknown>): string[] {
	const pathField = input?.path;
	if (!["read", "write", "edit", "grep", "find", "ls"].includes(toolName)) return [];
	return typeof pathField === "string" && pathField.trim() !== "" ? [pathField.trim()] : [];
}

/** The grant key for a target path: the directory itself when it exists, else its parent. */
export function targetDir(resolved: string, exists: (path: string) => boolean): string {
	if (exists(resolved)) return resolved;
	return dirname(resolved);
}

/**
 * The directory a grant should cover for `resolved`.
 *
 * A grant on a freshly created temp directory is worth almost nothing: `mktemp
 * -d` returns a different name each time, so every run asks again and the user
 * approves `/tmp/abc123`, `/tmp/def456`, and so on forever. Anything inside the
 * system temp root is covered by one grant on that root instead — it is scratch
 * space by definition, so widening the scope there costs no safety.
 *
 * `isInside` does the containment test so the boundary is the same one the rest
 * of the guard uses: `/tmpfoo` is not inside `/tmp`.
 */
export function grantScope(resolved: string, tempRoot: string): string {
	const normalized = normalize(tempRoot);
	if (isInside(resolved, normalized)) return normalized;
	return resolved;
}
