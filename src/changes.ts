import { execFile } from "node:child_process";

export interface Changes {
	created: number;
	updated: number;
	deleted: number;
}

export interface ChangeFiles {
	created: string[];
	updated: string[];
	deleted: string[];
}

export const emptyChanges = (): Changes => ({ created: 0, updated: 0, deleted: 0 });

/** Parse `git status --porcelain=v1 -z` output into created/updated/deleted file-name lists. */
export function parseStatusFiles(raw: string): ChangeFiles {
	const out: ChangeFiles = { created: [], updated: [], deleted: [] };
	const entries = raw.split("\0");
	for (let i = 0; i < entries.length; i++) {
		const entry = entries[i];
		if (entry.length < 3) continue;
		const x = entry[0];
		const y = entry[1];
		// Renames and copies are followed by the original path as a separate entry.
		if (x === "R" || x === "C") i++;
		const path = entry.slice(3);
		if (x === "?" || x === "A") out.created.push(path);
		else if (x === "D" || y === "D") out.deleted.push(path);
		else out.updated.push(path);
	}
	return out;
}

/** Parse `git status --porcelain=v1 -z` output into created/updated/deleted counts. */
export function parseStatus(raw: string): Changes {
	const files = parseStatusFiles(raw);
	return {
		created: files.created.length,
		updated: files.updated.length,
		deleted: files.deleted.length,
	};
}

/** Working-tree changes for `cwd`, or null when it is not inside a git repository. */
export function readChanges(cwd: string): Promise<Changes | null> {
	return new Promise((resolve) => {
		execFile("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
			resolve(err ? null : parseStatus(stdout));
		});
	});
}

/** Like readChanges, but returns the changed file names instead of counts. */
export function readChangesFiles(cwd: string): Promise<ChangeFiles | null> {
	return new Promise((resolve) => {
		execFile("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
			resolve(err ? null : parseStatusFiles(stdout));
		});
	});
}
