/** Changes git access — thin execFile wrappers with caps. Every git invocation
 * uses an argument array (never a shell) and passes the file path after `--`,
 * so odd paths are safe. Status parsing reuses parseStatusFiles from
 * src/changes.ts. No Pi API here. */

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readChangesFiles, type ChangeFiles } from "../changes.ts";

/** The cap for command output, the same value the status reader uses. */
const GIT_MAX_BUFFER = 8 * 1024 * 1024;

/** Working-tree files for `cwd`, or null when it is not inside a git repository. */
export function statusFiles(cwd: string): Promise<ChangeFiles | null> {
	return readChangesFiles(cwd);
}

/** `git diff HEAD -- <file>` as raw text; empty when git fails or the path has
 * no diff (untracked paths included). */
export function diffHead(cwd: string, path: string): Promise<string> {
	return new Promise((resolve) => {
		execFile("git", ["diff", "HEAD", "--", path], { cwd, maxBuffer: GIT_MAX_BUFFER }, (err, stdout) => {
			resolve(err ? "" : stdout);
		});
	});
}

export interface UntrackedContent {
	binary: boolean;
	text: string;
}

/** File content for an untracked path: binary detection on the first 8000
 * bytes (a NUL byte), UTF-8 text otherwise. A missing file reads as empty. */
export async function readUntracked(cwd: string, path: string): Promise<UntrackedContent> {
	try {
		const data = await readFile(join(cwd, path));
		return { binary: data.subarray(0, 8000).includes(0), text: data.toString("utf-8") };
	} catch {
		return { binary: false, text: "" };
	}
}
