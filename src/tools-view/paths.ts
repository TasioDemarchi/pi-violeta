/** Shorten a tool-argument path for one-line display (T2/S2): relative to the
 * project when under the cwd, `~`-prefixed when under the home directory,
 * untouched otherwise. Pure and tested. */

import { isAbsolute } from "node:path";

export function shortenPath(path: string, cwd?: string, home?: string): string {
	if (!path) return "";
	let candidate = path;
	if (home && (candidate === "~" || candidate.startsWith("~/"))) {
		candidate = home + candidate.slice(1);
	}
	if (!isAbsolute(candidate)) return candidate;
	if (home && (candidate === home || candidate.startsWith(home + "/"))) {
		return "~" + candidate.slice(home.length);
	}
	if (cwd && candidate === cwd) return ".";
	if (cwd && candidate.startsWith(cwd + "/")) {
		return candidate.slice(cwd.length + 1);
	}
	return candidate;
}
