import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Voice preference in `violeta.json`: missing file, corrupt JSON or a non-boolean mean off. */
export function readVoiceEnabled(file: string): boolean {
	try {
		return (JSON.parse(readFileSync(file, "utf8")) as { voice?: unknown })?.voice === true;
	} catch {
		return false;
	}
}

/** Persist the preference, keeping every unrelated key. */
export function writeVoiceEnabled(file: string, enabled: boolean): void {
	let config: Record<string, unknown> = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, voice: enabled }, null, "\t") + "\n");
}

/** The saved speaking rate; undefined when there is none or it is not a number. */
export function readVoiceSpeed(file: string): number | undefined {
	try {
		const speed = (JSON.parse(readFileSync(file, "utf8")) as { voiceSpeed?: unknown })?.voiceSpeed;
		return typeof speed === "number" && Number.isFinite(speed) ? speed : undefined;
	} catch {
		return undefined;
	}
}

export function writeVoiceSpeed(file: string, speed: number): void {
	let config: Record<string, unknown> = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, voiceSpeed: speed }, null, "\t") + "\n");
}

export type VoiceMode = "completo" | "resumen";

/** completo (the whole reply, cleaned) unless the saved value says resumen. */
export function readVoiceMode(file: string): VoiceMode {
	try {
		return (JSON.parse(readFileSync(file, "utf8")) as { voiceMode?: unknown })?.voiceMode === "resumen" ? "resumen" : "completo";
	} catch {
		return "completo";
	}
}

export function writeVoiceMode(file: string, mode: VoiceMode): void {
	let config: Record<string, unknown> = {};
	try {
		config = (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) ?? {};
	} catch {
		// missing or corrupt: start from a fresh object
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify({ ...config, voiceMode: mode }, null, "\t") + "\n");
}
