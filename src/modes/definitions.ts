/**
 * Mode definitions: markdown files with YAML frontmatter in
 * `${PI_CODING_AGENT_DIR}/modes/*.md`. Frontmatter keys: `name`,
 * `description`, `model`, `thinking`, `agents`; the body is the text appended
 * to the main session's system prompt.
 *
 * A mode is the only place violeta carries a philosophy, and it carries it as
 * data: a prompt body, the model that should run it, and the set of agents it
 * exposes. The engine attaches no meaning to any of it, so a mode can be
 * rewritten, replaced or deleted without touching code.
 *
 * `raw` is built in and always last-resort available: no prompt, no agents, no
 * ceremony. It exists so that a harness whose mode files are missing, broken or
 * simply unwanted still has a usable session.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter.ts";

export interface ModeDefinition {
	name: string;
	description: string;
	/** Model id (`provider/id`) the main session switches to on entering. */
	model?: string;
	/** Reasoning level the main session is pinned to on entering. A mode owns
	 * this because more reasoning is not uniformly better: some models reach the
	 * right approach and then reason themselves out of it at maximum effort. */
	thinking?: string;
	/** Agent names this mode exposes. Absent means every agent; empty means none. */
	agents?: string[];
	/** Appended to the main session's system prompt. Empty for `raw`. */
	prompt: string;
	source: string;
}

export interface ModeError {
	source: string;
	message: string;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** The always-available escape hatch: no philosophy, no agents, no ceremony. */
export const RAW_MODE: ModeDefinition = {
	name: "raw",
	description: "No protocol, no agents, no ceremony.",
	agents: [],
	prompt: "",
	source: "(built-in)",
};

export function parseMode(text: string, source: string): ModeDefinition {
	const data = parseFrontmatter(text, source);
	const name = typeof data.get("name") === "string" ? (data.get("name") as string).trim() : "";
	if (!name) throw new Error(`${source}: frontmatter must define a non-empty "name"`);
	const model = typeof data.get("model") === "string" ? (data.get("model") as string).trim() : undefined;
	const thinking = typeof data.get("thinking") === "string" ? (data.get("thinking") as string).trim() : undefined;
	if (thinking && !THINKING_LEVELS.has(thinking)) {
		throw new Error(`${source}: "thinking" must be one of ${[...THINKING_LEVELS].join(", ")} (got "${thinking}")`);
	}
	const rawAgents = data.get("agents");
	// A declared-but-empty `agents:` means "this mode exposes none", which is a
	// real choice and must not be confused with "not declared".
	const agents = Array.isArray(rawAgents)
		? rawAgents.filter((a): a is string => typeof a === "string" && a !== "")
		: undefined;
	const bodyStart = text.indexOf("\n---\n");
	const prompt = bodyStart >= 0 ? text.slice(bodyStart + 5).trim() : "";
	return {
		name,
		description: typeof data.get("description") === "string" ? (data.get("description") as string).trim() : "",
		...(model ? { model } : {}),
		...(thinking ? { thinking } : {}),
		...(agents ? { agents } : {}),
		prompt,
		source,
	};
}

/** Every mode in `dir`, plus the built-in `raw`, by name. A file named `raw.md`
 * replaces the built-in, so even the escape hatch stays the user's to redefine.
 * Invalid files are reported, never silently dropped: a philosophy that fails
 * to load must say so rather than leave the session quietly unguided. */
export function listModes(dir: string): { modes: ModeDefinition[]; errors: ModeError[] } {
	const modes: ModeDefinition[] = [];
	const errors: ModeError[] = [];
	let entries: string[] = [];
	try {
		entries = readdirSync(dir);
	} catch {
		// no modes directory: the built-in is the whole catalogue
	}
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".md")) continue;
		const source = join(dir, entry);
		try {
			modes.push(parseMode(readFileSync(source, "utf8"), source));
		} catch (error) {
			errors.push({ source, message: error instanceof Error ? error.message : String(error) });
		}
	}
	if (!modes.some((mode) => mode.name === RAW_MODE.name)) modes.push(RAW_MODE);
	return { modes, errors };
}

/** Resolve a mode by name, or undefined when it does not exist. */
export function findMode(modes: readonly ModeDefinition[], name: string): ModeDefinition | undefined {
	return modes.find((mode) => mode.name === name);
}

/** Whether `mode` exposes the agent `name`. A mode without an `agents` list
 * exposes everything. */
export function modeExposes(mode: ModeDefinition | undefined, name: string): boolean {
	if (!mode || mode.agents === undefined) return true;
	return mode.agents.includes(name);
}
