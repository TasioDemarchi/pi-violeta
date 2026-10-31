// The agents and modes this repo ships are data, so nothing type-checks them
// and a typo in a frontmatter key would only surface at runtime, mid-task.
// These tests are that check.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { listAgentDefinitions } from "../src/agents/definitions.ts";
import { listModes, modeExposes } from "../src/modes/definitions.ts";

const ROOT = join(import.meta.dirname, "..");
const agents = () => listAgentDefinitions(join(ROOT, "agents"));
const modes = () => listModes(join(ROOT, "modes"));

/** Every model id this harness can actually reach: the NaN catalogue plus the
 * Claude bridge, whose provider id is `claude-bridge`. */
function knownModels(): Set<string> {
	const catalog = JSON.parse(readFileSync(join(ROOT, "config", "models.json"), "utf8")) as {
		providers: Record<string, { models: Array<{ id: string }> }>;
	};
	const known = new Set<string>();
	for (const [provider, config] of Object.entries(catalog.providers)) {
		for (const model of config.models) known.add(`${provider}/${model.id}`);
	}
	for (const id of ["claude-opus-5", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"]) {
		known.add(`claude-bridge/${id}`);
	}
	return known;
}

test("every shipped agent definition parses", () => {
	const { definitions, errors } = agents();
	assert.deepEqual(errors, [], errors.map((e) => `${e.source}: ${e.message}`).join("\n"));
	assert.ok(definitions.length >= 7, `expected the full roster, got ${definitions.length}`);
});

test("every shipped agent names a model this harness can actually reach", () => {
	// A wrong model id fails at spawn time, inside a child, with the parent
	// already committed to the delegation. Catch it here instead.
	const known = knownModels();
	for (const def of agents().definitions) {
		assert.ok(known.has(def.model), `${def.name}: unknown model "${def.model}"`);
	}
});

test("every shipped agent declares both ceilings and some tools", () => {
	for (const def of agents().definitions) {
		assert.ok(typeof def.maxTurns === "number" && def.maxTurns > 0, `${def.name}: missing maxTurns`);
		assert.ok(typeof def.maxTokens === "number" && def.maxTokens > 0, `${def.name}: missing maxTokens`);
		assert.ok(def.tools.length > 0, `${def.name}: no tools`);
		assert.ok(def.description !== "", `${def.name}: no description`);
	}
});

test("read-only agents carry no writing tools", () => {
	// scout, the judges and the verifier are read-only by contract. A stray
	// `edit` in the frontmatter would quietly grant what the prompt forbids,
	// and the prompt is not what the engine enforces.
	const readOnly = new Set(["scout", "judge-a", "judge-b", "verifier"]);
	for (const def of agents().definitions) {
		if (!readOnly.has(def.name)) continue;
		for (const forbidden of ["edit", "write"]) {
			assert.ok(!def.tools.includes(forbidden), `${def.name} must not have "${forbidden}"`);
		}
	}
});

test("the two judges differ only by model, so their reads stay independent", () => {
	const found = agents().definitions;
	const a = found.find((d) => d.name === "judge-a")!;
	const b = found.find((d) => d.name === "judge-b")!;
	assert.notEqual(a.model, b.model, "blind judges on the same model would agree by construction");
	// Same instructions, different eyes: agreement has to come from the diff.
	assert.equal(a.prompt.replace(/Judge A/g, ""), b.prompt.replace(/Judge B/g, ""));
});

test("every shipped mode parses and exposes only agents that exist", () => {
	const { modes: found, errors } = modes();
	assert.deepEqual(errors, [], errors.map((e) => `${e.source}: ${e.message}`).join("\n"));
	const names = new Set(agents().definitions.map((d) => d.name));
	for (const mode of found) {
		for (const agent of mode.agents ?? []) {
			assert.ok(names.has(agent), `mode ${mode.name} exposes unknown agent "${agent}"`);
		}
		if (mode.model) assert.ok(knownModels().has(mode.model), `mode ${mode.name}: unknown model "${mode.model}"`);
	}
});

test("odd is the default mode and it exposes the whole roster", () => {
	const odd = modes().modes.find((m) => m.name === "odd");
	assert.ok(odd, "odd mode must ship, it is the default in src/modes/state.ts");
	for (const agent of agents().definitions) {
		assert.ok(modeExposes(odd, agent.name), `odd does not expose ${agent.name}`);
	}
});

test("raw and vault expose no agents", () => {
	const found = modes().modes;
	assert.deepEqual(found.find((m) => m.name === "raw")!.agents, []);
	assert.deepEqual(found.find((m) => m.name === "vault")!.agents, []);
});

test("architect is the only agent on the metered plan", () => {
	// The whole cost argument of this harness is that judgment runs on Claude and
	// volume runs on the flat-rate cluster. A second metered agent appearing by
	// accident is exactly the regression worth pinning.
	const metered = agents().definitions.filter((d) => d.model.startsWith("claude-bridge/"));
	assert.deepEqual(metered.map((d) => d.name), ["architect"]);
	assert.ok(metered[0]!.maxTokens! <= 500_000, "the metered agent needs a tight ceiling");
});

test("the orchestrator and the writer never share a quota pool", () => {
	// The two heaviest consumers in the harness are the main session and the
	// implementation writer. Each NaN model has its own monthly allowance, so
	// putting both on one model makes the first of them to run starve the other.
	const odd = modes().modes.find((m) => m.name === "odd")!;
	const builder = agents().definitions.find((d) => d.name === "builder")!;
	assert.ok(odd.model, "the odd mode must pin the orchestrator's model");
	assert.notEqual(odd.model, builder.model);
});

test("no shipped file asks for a model outside this plan's catalogue", () => {
	// config/models.json is the plan's catalogue. A model that is real but sits
	// behind a higher tier (glm5.3 is premium-only) fails at request time, not
	// at startup, so it has to be caught here.
	const catalog = JSON.parse(readFileSync(join(ROOT, "config", "models.json"), "utf8")) as {
		providers: Record<string, { models: Array<{ id: string }> }>;
	};
	const nan = new Set(catalog.providers.nan!.models.map((m) => m.id));
	assert.ok(!nan.has("glm5.3"), "glm5.3 is the 200 EUR premium tier, not nan_member");
	const referenced = [
		...agents().definitions.map((d) => d.model),
		...modes().modes.map((m) => m.model).filter((m): m is string => !!m),
	];
	for (const model of referenced) {
		if (!model.startsWith("nan/")) continue;
		assert.ok(nan.has(model.slice(4)), `${model} is not in this plan's catalogue`);
	}
});
