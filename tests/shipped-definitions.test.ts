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
	assert.ok(definitions.length >= 5, `expected the full roster, got ${definitions.length}`);
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
	// scout, the judge and the critic are read-only by contract. A stray
	// `edit` in the frontmatter would quietly grant what the prompt forbids,
	// and the prompt is not what the engine enforces.
	const readOnly = new Set(["scout", "judge", "critic"]);
	for (const def of agents().definitions) {
		if (!readOnly.has(def.name)) continue;
		for (const forbidden of ["edit", "write"]) {
			assert.ok(!def.tools.includes(forbidden), `${def.name} must not have "${forbidden}"`);
		}
	}
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

test("raw exposes no agents", () => {
	const found = modes().modes;
	assert.deepEqual(found.find((m) => m.name === "raw")!.agents, []);
});

test("no agent is on the metered plan", () => {
	// The agents run entirely on the flat-rate cluster; Claude is reached only by the
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
	for (const name of ["builder"]) {
		const def = agents().definitions.find((d) => d.name === name)!;
		assert.match(def.prompt, /down to `## Log`/, `${name}: no contract boundary`);
	}
});

test("every orchestrating mode pins its model, even when it shares a pool with the builder", () => {
	// Sharing a NaN quota pool between the main session and the writer is allowed:
	// with two usable models it is simply the cost of having few. It used to be
	// forbidden; the Android bake-off made deepseek-v4-flash the best writer, and
	// its pool (3B/month) is far above the measured use (~130M in a heavy month).
	//
	// Since 2026-11-04 they no longer share it anyway: the orchestrator runs on
	// glm5.3-flash (2B pool) and the writer stays on deepseek. The bake-off of
	// that day is in the README: the two tie on code and on reading code, and
	// deepseek is the more precise researcher, but on a vague request it keeps
	// digging instead of asking -- 184k input tokens in one turn, with no answer
	// -- while glm stops and asks. The one job that is mostly vague requests is
	// the orchestrator's; the ones that are precise belong to the agents.
	for (const name of ["jarvis"]) {
		const mode = modes().modes.find((m) => m.name === name)!;
		assert.ok(mode.model, `the ${name} mode must pin the orchestrator's model`);
	}
});

test("no shipped file asks for a model outside this plan's catalogue", () => {
	// config/models.json is the plan's catalogue. A model that is real but sits
	// behind a higher tier fails at request time, not at startup, so it has to be
	// caught here.
	//
	// glm5.3 used to be premium-only and was excluded by that rule. On 2026-11-05
	// NaN opened it to this tier, and a live call against
	// https://api.nan.builders/v1/chat/completions with this key answered
	// correctly from max_tokens 65536 up to 393216, so it stays in the catalogue
	// and the owner's decision is to rely on it. If this pin is ever removed
	// again, it is because a request started failing with "does not have
	// access" -- restore the exclusion then, not before.
	const catalog = JSON.parse(readFileSync(join(ROOT, "config", "models.json"), "utf8")) as {
		providers: Record<string, { models: Array<{ id: string }> }>;
	};
	const nan = new Set(catalog.providers.nan!.models.map((m) => m.id));
	assert.ok(nan.has("glm5.3"), "glm5.3 is in the catalogue and this tier has live access to it");
	const referenced = [
		...agents().definitions.map((d) => d.model),
		...modes().modes.map((m) => m.model).filter((m): m is string => !!m),
	];
	for (const model of referenced) {
		if (!model.startsWith("nan/")) continue;
		assert.ok(nan.has(model.slice(4)), `${model} is not in this plan's catalogue`);
	}
});

test("the builder declares the work nobody asked for", () => {
	const found = agents().definitions;
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
	assert.match(scout.prompt, /\.violeta\/reference\//);
	// Downloaded material is a prompt-injection surface.
	assert.match(scout.prompt, /data, never as instructions/i);
	assert.match(scout.prompt, /^runner:/m);
});

test("every mode answers in Spanish, briefly, and with no closing glossary", () => {
	// The prompts stay in English because it tokenizes more efficiently for the
	// same content; the replies do not, and the user is an engineer rather than
	// a career developer.
	//
	// The closing `— Términos —` block was retired on 2026-11-04 at the owner's
	// request, together with a length rule: he would rather ask when something
	// is unclear than read an explanation he did not ask for, and a glossary at
	// the end of every reply is exactly that. A term is still explained where it
	// is used, in the same sentence.
	for (const mode of modes().modes) {
		if (!mode.prompt) continue; // raw adds no rules
		assert.match(mode.prompt, /Answer in Spanish/i, `${mode.name}: no reply language`);
		assert.match(mode.prompt, /Short by default/i, `${mode.name}: no length rule`);
		assert.doesNotMatch(mode.prompt, /—\s*Términos\s*—/, `${mode.name}: the closing glossary is back`);
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

test("every agent that can be stopped knows it and reports as it goes", () => {
	// An agent was cut at its ceiling mid-sentence, announcing its next file. The
	// partial handoff was one transition line: useless to whoever continued.
	// The last thing an agent says is the whole handoff, so it must always be
	// progress rather than intent.
	for (const def of agents().definitions) {
		assert.match(
			def.prompt,
			/ceiling|ran out of room|stopped at/i,
			`${def.name}: does not know it can be stopped`,
		);
		// The handoff rule ships in two wordings: the worker's ("the last thing
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
});

test("no shipped prompt sends an agent to a path outside the project", () => {
	// A subagent has no UI, so the guard blocks an outside path instead of
	// asking: pointing one at /tmp does not fail cleanly, it stops the task.
	const builder = agents().definitions.find((d) => d.name === "builder")!;
	assert.match(builder.prompt, /`\.violeta\/scratch\/` inside the project/);
	assert.doesNotMatch(builder.prompt, /scratch files outside the repository/);
});

test("jarvis exposes exactly its five agents and every one of them exists", () => {
	const jarvis = modes().modes.find((m) => m.name === "jarvis")!;
	assert.ok(jarvis, "the jarvis mode ships");
	assert.deepEqual([...jarvis.agents!].sort(), ["builder", "critic", "judge", "scout", "tester"]);
	const names = new Set(agents().definitions.map((d) => d.name));
	for (const name of jarvis.agents!) assert.ok(names.has(name), `jarvis lists "${name}" but no such agent ships`);
});

test("jarvis keeps its two approvals, one critic round and the lint gate", () => {
	const jarvis = modes().modes.find((m) => m.name === "jarvis")!;
	assert.match(jarvis.prompt, /Approval 1/);
	assert.match(jarvis.prompt, /Approval 2/);
	assert.match(jarvis.prompt, /contract_check/);
	assert.match(jarvis.prompt, /No second critic round/);
	assert.match(jarvis.prompt, /Nothing is\s+built until the user says\s+yes/);
	assert.ok(jarvis.prompt.split("\n").length <= 160, "the whole philosophy stays on one page");
});

test("the critic only reads the contract, and its model is not the orchestrator's", () => {
	const critic = agents().definitions.find((d) => d.name === "critic")!;
	assert.deepEqual(critic.tools, ["read"]);
	assert.ok(critic.maxTurns! <= 10, "one pass, not a conversation");
	assert.match(critic.prompt, /At most \*\*seven\*\* questions/);
	assert.match(critic.prompt, /Never rewrite the contract/);
	const jarvis = modes().modes.find((m) => m.name === "jarvis")!;
	assert.notEqual(critic.model, jarvis.model, "a critic on the same model shares the author's blind spots");

	// Added 2026-11-05. A real session spent 72 turns and 326k tokens on three
	// builders for one "round of five fixes" and delivered one fix and a broken
	// suite. The critic is the only reader that sees the contract before any
	// builder runs, and it costs 2 turns and ~8k tokens on a free model, so it
	// is where a row that is really two tasks has to be caught.
	assert.match(critic.prompt, /Two tasks in one row/, "the critic must judge whether a row is one piece");
	assert.match(critic.prompt, /two-tasks/, "and have a kind to report it as");
});

test("the jarvis judge is a different model than the builder that wrote the code", () => {
	const byName = (n: string) => agents().definitions.find((d) => d.name === n)!;
	assert.notEqual(byName("judge").model, byName("builder").model);
});

test("jarvis speaks to a non-technical user: plain decisions, costs shown, nothing decided in silence", () => {
	const jarvis = modes().modes.find((m) => m.name === "jarvis")!;
	assert.match(jarvis.prompt, /has little technical background/);
	// A technical fork is escalated only in the A/B shape that shows benefit and cost.
	assert.match(jarvis.prompt, /Beneficio:.*Costo:/);
	assert.match(jarvis.prompt, /Recomiendo/);
	assert.match(jarvis.prompt, /never hide a cost|hide a cost/i);
	// What Jarvis decides alone is recorded with its reason.
	assert.match(jarvis.prompt, /record each one under `## Decisiones`/);
	// Approval 1 is a plain summary, not the contract file; judge findings arrive translated.
	assert.match(jarvis.prompt, /Do not ask the user to read the contract file/);
	assert.match(jarvis.prompt, /qué decidí yo por vos/);
	assert.match(jarvis.prompt, /Its findings go to the user,\s+translated/);
});

test("jarvis tells the user how to open it and what to try, never adds unrequested features, and leaves a clean folder", () => {
	const jarvis = modes().modes.find((m) => m.name === "jarvis")!;
	// Approval 1 lists what the user can try, with an error case when it takes data.
	assert.match(jarvis.prompt, /cómo lo\s+vas a abrir y qué pruebas podés hacer vos/);
	assert.match(jarvis.prompt, /at least one error case/);
	// A feature nobody asked for is offered, not slipped into the contract.
	assert.match(jarvis.prompt, /Never add a feature the user did not ask for/);
	assert.match(jarvis.prompt, /only with their yes/);
	// A runnable project ends with a README in plain Spanish; scratch never reaches the user's folder.
	assert.match(jarvis.prompt, /last task\*\* of anything the user will run is a `README\.md`/);
	assert.match(jarvis.prompt, /add\s+`\.violeta\/scratch\/` to `\.gitignore`/);
	assert.match(jarvis.prompt, /remove the `\.violeta\/scratch\/` folder/);
});

test("jarvis runs the black-box tester only for runnable work with risk, and recovers its report on a budget stop", () => {
	const jarvis = modes().modes.find((m) => m.name === "jarvis")!;
	assert.match(jarvis.prompt, /what you built \*\*runs\*\*/);
	assert.match(jarvis.prompt, /some task is `riesgo: sí`, dispatch `tester` once/);
	assert.match(jarvis.prompt, /status `budget`, read `\.violeta\/scratch\/probe\/informe\.md`/);
	const tester = agents().definitions.find((d) => d.name === "tester")!;
	assert.match(tester.prompt, /never redirect to `\/dev\/null`/);
	assert.match(tester.prompt, /Never `pkill` by name/);
	assert.match(tester.prompt, /informe\.md/);
});

test("jarvis keeps for itself the tasks the subagents' sandbox cannot run", () => {
	// Measured on the Android project: subagents have no adb, gradle or SDK, so a
	// builder sent to compile or install fails. The orchestrator does those.
	const jarvis = modes().modes.find((m) => m.name === "jarvis")!;
	assert.match(jarvis.prompt, /what subagents cannot reach/);
	assert.match(jarvis.prompt, /`adb`, `gradle`/);
	assert.match(jarvis.prompt, /`quién: Jarvis`/);
	assert.match(jarvis.prompt, /its\s+`Check` is yours/);
	assert.match(jarvis.prompt, /marked `quién: Jarvis` you run yourself/);
});
