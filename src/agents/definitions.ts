import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "../frontmatter.ts";

/** Agent definitions: markdown files with YAML frontmatter in
 * `${PI_CODING_AGENT_DIR}/agents/*.md`. Frontmatter keys: name, description,
 * model, thinking, tools, maxTurns, maxTokens; the body is the system prompt.
 * The engine is neutral: it ships no agents and attaches no meaning to any
 * definition. `maxTurns`/`maxTokens` are plain ceilings the runner enforces;
 * they carry no workflow, and a definition that omits them has none. */

export interface AgentDefinition {
	name: string;
	description: string;
	model: string;
	thinking?: string;
	tools: string[];
	/** Stop the run after this many assistant turns. Absent means no ceiling. */
	maxTurns?: number;
	/** Stop the run after this many input+output tokens. Absent means no ceiling. */
	maxTokens?: number;
	prompt: string;
	source: string;
}

export interface DefinitionError {
	source: string;
	message: string;
}

const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** A ceiling must be a positive whole number; anything else is a typo worth
 * reporting rather than a silently ignored budget. */
function positiveInteger(data: Map<string, string | string[]>, key: string, source: string): number | undefined {
	const raw = data.get(key);
	if (raw === undefined) return undefined;
	if (typeof raw !== "string" || raw.trim() === "") {
		throw new Error(`${source}: "${key}" must be a positive whole number`);
	}
	const value = Number(raw.trim());
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`${source}: "${key}" must be a positive whole number (got "${raw.trim()}")`);
	}
	return value;
}

export function parseDefinition(text: string, source: string): AgentDefinition {
	const data = parseFrontmatter(text, source);
	const name = typeof data.get("name") === "string" ? (data.get("name") as string).trim() : "";
	if (!name) throw new Error(`${source}: frontmatter must define a non-empty "name"`);
	const model = typeof data.get("model") === "string" ? (data.get("model") as string).trim() : "";
	if (!model) throw new Error(`${source}: frontmatter must define a non-empty "model"`);
	const thinking = typeof data.get("thinking") === "string" ? (data.get("thinking") as string).trim() : undefined;
	if (thinking && !THINKING_LEVELS.has(thinking)) {
		throw new Error(`${source}: "thinking" must be one of ${[...THINKING_LEVELS].join(", ")} (got "${thinking}")`);
	}
	const maxTurns = positiveInteger(data, "maxTurns", source);
	const maxTokens = positiveInteger(data, "maxTokens", source);
	const rawTools = data.get("tools");
	const tools = Array.isArray(rawTools) ? rawTools.filter((t): t is string => typeof t === "string" && t !== "") : [];
	const bodyStart = text.indexOf("\n---\n");
	const body = bodyStart >= 0 ? text.slice(bodyStart + 5).trim() : "";
	if (!body) throw new Error(`${source}: definition body (system prompt) must not be empty`);
	return {
		name,
		description: typeof data.get("description") === "string" ? (data.get("description") as string).trim() : "",
		model,
		thinking,
		tools,
		...(maxTurns === undefined ? {} : { maxTurns }),
		...(maxTokens === undefined ? {} : { maxTokens }),
		prompt: body,
		source,
	};
}

/** Load every definition in `dir`. Invalid files are returned as errors with
 * clear messages; a missing directory is simply no definitions. */
export function listAgentDefinitions(dir: string): { definitions: AgentDefinition[]; errors: DefinitionError[] } {
	const definitions: AgentDefinition[] = [];
	const errors: DefinitionError[] = [];
	let entries: string[];
	try {
		entries = readdirSync(dir);
	} catch {
		return { definitions, errors };
	}
	for (const entry of entries.sort()) {
		if (!entry.endsWith(".md")) continue;
		const source = join(dir, entry);
		try {
			definitions.push(parseDefinition(readFileSync(source, "utf8"), source));
		} catch (error) {
			errors.push({ source, message: error instanceof Error ? error.message : String(error) });
		}
	}
	return { definitions, errors };
}
