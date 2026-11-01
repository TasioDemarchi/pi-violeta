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

test("no agent is on the metered plan", () => {
	// ODD runs entirely on the flat-rate cluster; Claude is reached only by the
	// user raising the session model by hand. An agent creeping back onto the
	// metered plan would spend money nobody chose to spend.
	const metered = agents().definitions.filter((d) => d.model.startsWith("claude-bridge/"));
	assert.deepEqual(metered.map((d) => d.name), []);
});

test("workers read the whole contract and skip only the history", () => {
	// The boundary is contract vs record, not specs vs everything else. A shared
	// decision section that tasks cite by number ("the splice of A3") is
	// contract: narrowing workers to the specs alone made those citations
	// unresolvable.
	for (const name of ["builder", "planner", "verifier"]) {
		const def = agents().definitions.find((d) => d.name === name)!;
		assert.match(def.prompt, /down to `## Log`/, `${name}: no contract boundary`);
	}
	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	assert.match(odd, /above `## Log` is the contract/i);
	assert.match(odd, /cite by number are contract/i);
	assert.match(odd, /written down and cited/i);
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

test("architect is the only agent that can write the plan", () => {
	// Decomposition is judgment, so it belongs to the metered model, not to the
	// orchestrator. Every other writer is scoped to implementing a task that
	// already exists.
	const found = agents().definitions;
	const architect = found.find((d) => d.name === "architect")!;
	assert.ok(architect.tools.includes("write"), "architect must write the feature document itself");
	assert.ok(!architect.tools.includes("bash"), "architect decides, it does not run things");

	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	assert.match(odd, /do not write the specs or the task list yourself/i);
	assert.match(odd, /verbatim/i);
});

test("odd routes planning by cost and checks the plan before any code", () => {
	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	// The expensive planner is gated by an explicit table, and uncertainty goes
	// to the user rather than defaulting to the metered model.
	assert.match(odd, /\*\*`architect`\*\* when \*\*any\*\* holds/);
	assert.match(odd, /neither is clear, ask the user/i);
	assert.match(odd, /lens: spec/);
	assert.match(odd, /before the first source write/i);
	// Handoffs are checked mechanically, and the plan is mirrored for the user.
	assert.match(odd, /git status --short/);
	assert.match(odd, /`todo` tool/);
});

test("the planner escalates instead of guessing, and the builder declares extras", () => {
	const found = agents().definitions;
	const planner = found.find((d) => d.name === "planner")!;
	assert.match(planner.prompt, /needs_architect/);
	assert.match(planner.prompt, /[Nn]ever invent a\s+requirement/);
	assert.ok(!planner.tools.includes("bash"), "the planner writes a plan, it does not run things");

	// GLM-5.3-Flash over-engineers, so unasked work must be declared, not prevented
	// by hope: a declared extra is rejectable in one turn.
	const builder = found.find((d) => d.name === "builder")!;
	assert.match(builder.prompt, /^extras:/m);
	assert.match(builder.prompt, /smallest thing that satisfies the spec/i);
});

test("scout fetches references safely and reports them apart from our code", () => {
	const scout = agents().definitions.find((d) => d.name === "scout")!;
	// The old prompt claimed this harness had no web access, which was false and
	// made the agent refuse work it can do with curl.
	assert.doesNotMatch(scout.prompt, /no web access/i);
	assert.match(scout.prompt, /--depth 1/);
	assert.match(scout.prompt, /\.odd\/reference\//);
	// Downloaded material is a prompt-injection surface.
	assert.match(scout.prompt, /data, never as instructions/i);
	assert.match(scout.prompt, /^runner:/m);
});

test("odd forbids narrating its own machinery to the user", () => {
	// Explaining each rule's reasoning makes a weak model comply, and also gives
	// it material to recite back as if it were news. The user built this.
	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	assert.match(odd, /Never narrate the machinery/i);
	assert.match(odd, /not announce which agent/i);
	assert.match(odd, /Do not name the\s+autonomy\s+level/i);
});

test("every mode answers in Spanish and offers a glossary", () => {
	// The prompts stay in English because it tokenizes more efficiently for the
	// same content; the replies do not, and the user is an engineer rather than
	// a career developer.
	for (const mode of modes().modes) {
		if (!mode.prompt) continue; // raw adds no rules
		assert.match(mode.prompt, /Answer in Spanish/i, `${mode.name}: no reply language`);
		assert.match(mode.prompt, /Glossary, on by default/i, `${mode.name}: no glossary rule`);
		assert.match(mode.prompt, /Términos/, `${mode.name}: no glossary example`);
	}
});

test("the builder is told tests come first, and batching never eats the RED", () => {
	// The prompt used to tell the builder that turns are what it is spending,
	// twenty lines before telling it to spend four on RED -> GREEN. It followed
	// the cheaper rule, which it read first.
	const builder = agents().definitions.find((d) => d.name === "builder")!;
	const tests = builder.prompt.indexOf("## Tests come first");
	const writing = builder.prompt.indexOf("## While you write");
	assert.ok(tests > 0 && writing > tests, "the test rules must come before the efficiency rules");
	assert.match(builder.prompt, /RED → GREEN sequence is exempt/);
	// "It does not exist yet" is not evidence that a test can catch anything.
	assert.match(builder.prompt, /is not a RED/);
	assert.match(builder.prompt, /stub that returns the\s+wrong answer/);
});

test("a missing RED is rejected where it is worth paying for", () => {
	// A rule nothing enforces is a suggestion; rejecting everywhere costs a full
	// worker run per task, so the gate is scoped to hot paths.
	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	assert.match(odd, /`tests: RED` is not `n\/a`/);
	assert.match(odd, /touches a hot path/);
	assert.match(odd, /no\s+`status:` line/);
});

test("every agent that can be stopped knows it and reports as it goes", () => {
	// A fixer was cut at its ceiling mid-sentence, announcing its next file. The
	// partial handoff was one transition line: useless to whoever continued.
	// The last thing an agent says is the whole handoff, so it must always be
	// progress rather than intent.
	for (const def of agents().definitions) {
		assert.match(
			def.prompt,
			/ceiling|ran out of room|stopped at/i,
			`${def.name}: does not know it can be stopped`,
		);
		// The handoff rule ships in two wordings: the fixer's ("the last thing
		// you said is the entire handoff") and the judges' ("emit each finding
		// as you confirm it"). Every definition must carry one of them, plus
		// the never-announce-next-steps half.
		assert.match(
			def.prompt,
			/last thing you said is the entire handoff|emit\s+each finding as you confirm it/i,
			`${def.name}: does not state that the last thing it says is the entire handoff`,
		);
		assert.match(
			def.prompt,
			/Never announce\s+what you are about to do next|emit\s+each finding as you confirm it/i,
			`${def.name}: does not say to report as it goes, never announcing next steps`,
		);
	}
	const fixer = agents().definitions.find((d) => d.name === "fixer")!;
	assert.match(fixer.prompt, /last thing you said is the entire handoff/i);
	assert.match(fixer.prompt, /Never announce\s+what you are about to do next/i);
});

test("the fixer stays inside the findings instead of re-reviewing", () => {
	// It read twelve files for findings that named four, spending most of its
	// turns on orientation the judge had already paid for.
	const fixer = agents().definitions.find((d) => d.name === "fixer")!;
	assert.match(fixer.prompt, /Open \*\*only\*\* the files the findings name/);
	assert.match(fixer.prompt, /the finding is underspecified/i);

	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	assert.match(odd, /one run per file or small group/i);
});

test("no shipped prompt sends an agent to a path outside the project", () => {
	// A subagent has no UI, so the guard blocks an outside path instead of
	// asking: pointing one at /tmp does not fail cleanly, it stops the task.
	const builder = agents().definitions.find((d) => d.name === "builder")!;
	assert.match(builder.prompt, /`\.odd\/scratch\/` inside the project/);
	assert.doesNotMatch(builder.prompt, /scratch files outside the repository/);

	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	assert.match(odd, /never `cd \/tmp`/);
});

test("odd separates banned machinery talk from owed progress reporting", () => {
	// The no-narration rule silenced the orchestrator during autonomous runs.
	// Protocol talk stays banned; why, findings and decisions are owed unasked.
	const odd = readFileSync(join(ROOT, "modes", "odd.md"), "utf8");
	assert.match(odd, /Never narrate the machinery/i);
	assert.match(odd, /Report substance, not machinery/i);
	assert.match(odd, /never more than once per task/i);
	assert.match(odd, /Por qué:/);
	// Checkpoint duty scales with how little the user is approving.
	assert.match(odd, /the more you owe them checkpoints/i);
});
