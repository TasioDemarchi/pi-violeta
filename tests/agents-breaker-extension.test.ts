// The breaker's pure rules are tested in breaker.test.ts. This loads the real
// violeta-agents extension against a fake Pi and drives `subagent_run`, to
// guard the wiring: the decision runs BEFORE a child is spawned, a refusal is an
// error the model can read, and a user prompt (not a background result) is what
// restarts the window.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-agents.ts";

const ROOT = join(import.meta.dirname, "..");

type Tool = { name: string; execute: (id: string, params: Record<string, unknown>, signal: undefined, onUpdate: undefined, ctx: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean; details?: Record<string, unknown> }> };

function setup(env: Record<string, string>) {
	const dir = mkdtempSync(join(tmpdir(), "violeta-breaker-ext-"));
	mkdirSync(join(dir, "agents"));
	// A model that does not exist: if a dispatch is allowed and a child does start,
	// it dies on the unknown model before any request, so the suite spends no quota.
	const scout = readFileSync(join(ROOT, "agents", "scout.md"), "utf8").replace(/^model:.*$/m, "model: nope/none");
	writeFileSync(join(dir, "agents", "scout.md"), scout);
	process.env.PI_CODING_AGENT_DIR = dir;
	delete process.env.VIOLETA_AGENTS_CHILD;
	Object.assign(process.env, env);

	const tools = new Map<string, Tool>();
	const handlers = new Map<string, Array<(event: unknown, ctx: unknown) => unknown>>();
	const pi = {
		on: (name: string, fn: (event: unknown, ctx: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		registerTool: (tool: Tool) => tools.set(tool.name, tool),
		registerCommand: () => {},
		registerShortcut: () => {},
		registerMessageRenderer: () => {},
		sendMessage: () => {},
		getThinkingLevel: () => "medium",
	};
	(extension as unknown as (pi: unknown) => void)(pi);
	const asked: Array<{ title: string; question: string }> = [];
	const notices: string[] = [];
	const ctx = (hasUI: boolean, answer: boolean) => ({
		cwd: dir,
		hasUI,
		mode: "tui",
		ui: {
			confirm: async (title: string, question: string) => {
				asked.push({ title, question });
				return answer;
			},
			notify: (text: string) => notices.push(text),
			setWidget: () => {},
		},
	});
	const stop = async () => {
		for (const fn of handlers.get("session_shutdown") ?? []) await fn({}, ctx(false, false));
	};
	return { tool: tools.get("subagent_run")!, handlers, asked, notices, ctx, stop };
}

const params = (label: string) => ({ agent: "scout", task: "look around", label, mode: "background" });

test("a refused confirmation returns an error and never spawns a child", async () => {
	// loopRepeat 1 makes the very first dispatch ask, so no child is ever started.
	const env = setup({ VIOLETA_BREAKER_LOOP_REPEAT: "1" });
	const result = await env.tool.execute("1", params("map the repo"), undefined, undefined, env.ctx(true, false));
	assert.equal(result.isError, true);
	assert.equal(result.details?.error, "breaker");
	assert.equal(result.details?.reason, "loop");
	assert.match(result.content[0]!.text, /did not authorize launching more subagents/);
	assert.equal(env.asked.length, 1);
	assert.equal(env.asked[0]!.title, "Keep launching subagents?");
	assert.match(env.asked[0]!.question, /^"scout" is about to run with "map the repo" for the 1th time/);
	await env.stop();
});

test("with no UI to ask, the answer is no", async () => {
	const env = setup({ VIOLETA_BREAKER_LOOP_REPEAT: "1" });
	const result = await env.tool.execute("1", params("map the repo"), undefined, undefined, env.ctx(false, true));
	assert.equal(result.isError, true);
	assert.equal(result.details?.error, "breaker");
	assert.equal(env.asked.length, 0, "there is nobody to ask");
	await env.stop();
});

test("only a user prompt restarts the window, not a background result", async () => {
	const env = setup({ VIOLETA_BREAKER_HARD_DISPATCHES: "1", VIOLETA_BREAKER_LOOP_REPEAT: "99", VIOLETA_BREAKER_REPORT_EVERY: "99" });
	// Pretend one dispatch already ran in this window by spending the single
	// allowed one on a refused-confirm path: ask once with a "yes", then the
	// next dispatch must ask again until the user speaks.
	const yes = env.ctx(true, true);
	const first = await env.tool.execute("1", params("first piece"), undefined, undefined, yes);
	assert.notEqual(first.isError, true, "the first dispatch is allowed");

	const no = env.ctx(true, false);
	const blocked = await env.tool.execute("2", params("second piece"), undefined, undefined, no);
	assert.equal(blocked.details?.reason, "ceiling");

	const [reset] = env.handlers.get("before_agent_start")!;
	reset!({ messageType: "custom" }, no);
	const stillBlocked = await env.tool.execute("3", params("third piece"), undefined, undefined, no);
	assert.equal(stillBlocked.details?.reason, "ceiling", "a custom message is the system talking, not the user");

	reset!({ messageType: "user", prompt: "sigue" }, no);
	const open = await env.tool.execute("4", params("fourth piece"), undefined, undefined, no);
	assert.notEqual(open.details?.error, "breaker", "the user spoke, so the window restarted");
	await env.stop();
});
