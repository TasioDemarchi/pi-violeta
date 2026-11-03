/** The persisted active mode, kept in `violeta.json` beside the other
 * preferences. Unrelated keys always survive a write, so the mode and the
 * sidebar never clobber each other. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

interface VioletaConfig {
	mode?: unknown;
	[key: string]: unknown;
}

export const DEFAULT_MODE = "jarvis";

/** The persisted mode name; a missing file, corrupt JSON or a non-string value
 * all mean the default. */
export function readActiveMode(file: string): string {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as VioletaConfig;
		const mode = parsed?.mode;
		return typeof mode === "string" && mode.trim() !== "" ? mode.trim() : DEFAULT_MODE;
	} catch {
		return DEFAULT_MODE;
	}
}

/** Persist the active mode, preserving unrelated keys. */
export function writeActiveMode(file: string, mode: string): void {
	let config: VioletaConfig = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as VioletaConfig) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, mode }, null, "\t") + "\n");
}
