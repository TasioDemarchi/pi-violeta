import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Language } from "./i18n.ts";

const LANGUAGES: ReadonlySet<string> = new Set(["es", "en"]);

export interface VioletaConfig {
	sidebar?: boolean;
	language?: Language;
	[key: string]: unknown;
}

/**
 * Read the persisted language preference; a missing file, corrupt JSON or an
 * unknown value all mean the default `es`.
 */
export function readLanguage(file: string): Language {
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as VioletaConfig;
		const value = parsed?.language;
		return typeof value === "string" && LANGUAGES.has(value) ? (value as Language) : "es";
	} catch {
		return "es";
	}
}

/** Persist the language preference, preserving unrelated keys (sidebar-state style). */
export function writeLanguage(file: string, language: Language): void {
	let config: VioletaConfig = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as VioletaConfig) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, language }, null, "\t") + "\n");
}
