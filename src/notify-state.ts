import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface VioletaConfig {
	notify?: boolean;
	sidebar?: boolean;
	[key: string]: unknown;
}

/** Read the persisted notify preference; missing file, corrupt JSON or a
 * non-boolean value all mean the default: off. */
export function readNotifyEnabled(file: string): boolean {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as VioletaConfig;
		return parsed?.notify === true;
	} catch {
		return false;
	}
}

/** Persist the notify preference, preserving unrelated keys (sidebar-state style). */
export function writeNotifyEnabled(file: string, enabled: boolean): void {
	let config: VioletaConfig = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as VioletaConfig) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, notify: enabled }, null, "\t") + "\n");
}
