// Loads the real violeta-mode extension against a fake Pi. The unit tests cover
// parsing and persistence; this covers the wiring that only exists inside the
// extension: what session_start publishes, what before_agent_start appends, and
// what /mode does when it switches.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-mode.ts";
import { readActiveMode } from "../src/modes/state.ts";
import { getShared, setShared } from "../src/shared-hub.ts";
import { setLanguage } from "../src/i18n.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;

const GLM = { provider: "nan", id: "glm5.3" };

function setup(options: { mode?: string; available?: Array<{ provider: string; id: string }> } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "violeta-mode-"));
	mkdirSync(join(dir, "modes"), { recursive: true });
	writeFileSync(
		join(dir, "modes", "odd.md"),
		"---\nname: odd\ndescription: Organic Driven Development\nmodel: nan/glm5.3\nthinking: medium\nagents: [scout, builder]\n---\n\nWork proportionally.\n",
	);
	if (options.mode) writeFileSync(join(dir, "violeta.json"), JSON.stringify({ mode: options.mode, sidebar: true }));
	process.env.PI_CODING_AGENT_DIR = dir;
	delete process.env.VIOLETA_AGENTS_CHILD;
	setLanguage("es");
	setShared({ activeMode: undefined, modeAgents: undefined });

	const handlers = new Map<string, Handler[]>();
	const commands = new Map<string, (args: string, ctx: unknown) => unknown>();
	const setModels: Array<{ provider: string; id: string }> = [];
	const thinkingLevels: string[] = [];
	const notices: string[] = [];
	const sent: Array<{ content: string; options: unknown }> = [];
	const pi = {
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		registerCommand: (name: string, spec: { handler: (args: string, ctx: unknown) => unknown }) => commands.set(name, spec.handler),
		setModel: async (model: { provider: string; id: string }) => {
			setModels.push(model);
			return true;
		},
		sendMessage: (message: { content: string }, options: unknown) => sent.push({ content: message.content, options }),
		setThinkingLevel: (level: string) => thinkingLevels.push(level),
	};
	const ctx = {
		cwd: process.cwd(),
		mode: "tui",
		model: { provider: "nan", id: "something-else" },
		modelRegistry: { getAvailable: () => options.available ?? [GLM] },
		ui: { notify: (text: string) => notices.push(text) },
	};

	extension(pi as never);
	const fire = async (event: string, payload: unknown = {}) => {
		for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
	};
	return {
		dir,
		fire,
		ctx,
		notices,
		setModels,
		thinkingLevels,
		sent,
		run: (args: string) => commands.get("mode")!(args, ctx),
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

test("session_start publishes the persisted mode and switches the session model", async () => {
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		assert.equal(getShared().activeMode, "odd");
		assert.deepEqual(getShared().modeAgents, ["scout", "builder"]);
		assert.deepEqual(h.setModels, [GLM]);
		// Entering a mode is not a notification-worthy event; only an explicit
		// switch tells the user what changed.
		assert.deepEqual(h.notices, []);
	} finally {
		h.cleanup();
	}
});

test("before_agent_start appends the mode prompt and never replaces the system prompt", async () => {
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		const event = { systemPrompt: "PI BASE PROMPT", systemPromptOptions: { appendSystemPrompt: "" } };
		await h.fire("before_agent_start", event);
		assert.match(event.systemPromptOptions.appendSystemPrompt, /Modo activo: odd/);
		assert.match(event.systemPromptOptions.appendSystemPrompt, /Work proportionally\./);
		// Replacing would drop Pi's own tool and environment sections.
		assert.equal(event.systemPrompt, "PI BASE PROMPT");
	} finally {
		h.cleanup();
	}
});

test("before_agent_start keeps an append already set by someone else", async () => {
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		const event = { systemPrompt: "base", systemPromptOptions: { appendSystemPrompt: "EARLIER" } };
		await h.fire("before_agent_start", event);
		assert.match(event.systemPromptOptions.appendSystemPrompt, /^EARLIER\n\n/);
	} finally {
		h.cleanup();
	}
});

test("raw exposes no agents and still names itself in the prompt", async () => {
	// raw adds no rules, but it must still say which mode is active: a mode that
	// contributes nothing leaves the model's earlier role unchallenged, which is
	// exactly how /mode raw kept answering as scout.
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		await h.run("raw");
		assert.equal(getShared().activeMode, "raw");
		assert.deepEqual(getShared().modeAgents, []);
		const event = { systemPrompt: "base", systemPromptOptions: { appendSystemPrompt: "" } };
		await h.fire("before_agent_start", event);
		assert.match(event.systemPromptOptions.appendSystemPrompt, /Modo activo: raw/);
		assert.doesNotMatch(event.systemPromptOptions.appendSystemPrompt, /Work proportionally/);
		assert.equal(readActiveMode(join(h.dir, "violeta.json")), "raw");
	} finally {
		h.cleanup();
	}
});

test("switching announces the change in the conversation without costing a turn", async () => {
	// The prompt swap alone is not enough: the model reads its own earlier turns
	// and keeps playing the role they established.
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		await h.run("raw");
		assert.equal(h.sent.length, 1);
		assert.match(h.sent[0]!.content, /de "odd" a "raw"/);
		assert.deepEqual(h.sent[0]!.options, { triggerTurn: false });
	} finally {
		h.cleanup();
	}
});

test("switching to the mode already active announces nothing", async () => {
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		await h.run("odd");
		assert.deepEqual(h.sent, []);
	} finally {
		h.cleanup();
	}
});

test("/mode with no argument reports the active mode and the catalogue", async () => {
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		await h.run("");
		assert.match(h.notices.join("\n"), /Modo activo: odd/);
		assert.match(h.notices.join("\n"), /odd, raw/);
		assert.equal(getShared().activeMode, "odd");
	} finally {
		h.cleanup();
	}
});

test("an unknown mode is refused and leaves the active one untouched", async () => {
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		await h.run("vault");
		assert.match(h.notices.join("\n"), /Modo desconocido "vault"/);
		assert.equal(getShared().activeMode, "odd");
		assert.equal(readActiveMode(join(h.dir, "violeta.json")), "odd");
	} finally {
		h.cleanup();
	}
});

test("a mode whose model is unavailable still activates, on the current model", async () => {
	// A philosophy must survive its preferred model being gone; refusing to
	// switch would make a missing model silently disable the workflow.
	const h = setup({ mode: "raw", available: [] });
	try {
		await h.fire("session_start");
		await h.run("odd");
		assert.equal(getShared().activeMode, "odd");
		assert.deepEqual(h.setModels, []);
		assert.match(h.notices.join("\n"), /no está disponible/);
	} finally {
		h.cleanup();
	}
});

test("an unreadable mode file is reported instead of silently leaving the session unguided", async () => {
	const h = setup({ mode: "odd" });
	try {
		writeFileSync(join(h.dir, "modes", "broken.md"), "no frontmatter");
		await h.fire("session_start");
		assert.match(h.notices.join("\n"), /No se pudo leer el modo/);
		assert.equal(getShared().activeMode, "odd");
	} finally {
		h.cleanup();
	}
});

test("a persisted mode that no longer exists falls back without crashing", async () => {
	const h = setup({ mode: "deleted-mode" });
	try {
		await h.fire("session_start");
		// The default is odd and it exists here, so that is what it lands on.
		assert.equal(getShared().activeMode, "odd");
	} finally {
		h.cleanup();
	}
});

test("a mode pins the session's reasoning level on entering", async () => {
	// More reasoning is not uniformly better: some models reach the right
	// approach and reason themselves out of it at maximum effort, so the level
	// is the mode's to own rather than whatever the last session left behind.
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		assert.deepEqual(h.thinkingLevels, ["medium"]);
	} finally {
		h.cleanup();
	}
});

test("a mode with no thinking level leaves the current one alone", async () => {
	const h = setup({ mode: "odd" });
	try {
		await h.fire("session_start");
		h.thinkingLevels.length = 0;
		await h.run("raw");
		assert.deepEqual(h.thinkingLevels, []);
	} finally {
		h.cleanup();
	}
});
