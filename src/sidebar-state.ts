import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface VioletaConfig {
	sidebar?: boolean;
	[key: string]: unknown;
}

/** Read the persisted sidebar preference; missing file or corrupt JSON means off. */
export function readSidebarEnabled(file: string): boolean {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as VioletaConfig;
		return parsed?.sidebar === true;
	} catch {
		return false;
	}
}

/** Persist the sidebar preference, preserving unrelated keys. */
export function writeSidebarEnabled(file: string, enabled: boolean): void {
	let config: VioletaConfig = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as VioletaConfig) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, sidebar: enabled }, null, "\t") + "\n");
}
