/**
 * The side chat driven through the real extension with a fake Pi: the command
 * forms, the one model call each makes (and what it carries), the reader that
 * opens on every ask, and the failures that must stay visible instead of
 * vanishing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../extensions/violeta-btw.ts";
import { getShared, setShared } from "../src/shared-hub.ts";

delete process.env.VIOLETA_AGENTS_CHILD;

type Command = { description?: string; handler: (args: string, ctx: unknown) => Promise<void> };
type Handler = (event: unknown, ctx: unknown) => Promise<void>;
type Complete = (model: unknown, context: Record<string, unknown>) => Promise<unknown>;
type Shortcut = { description?: string; handler: (ctx: unknown) => Promise<void> };
/** What `ctx.ui.custom` hands the extension, and what it gives back. */
type Reader = { render(width: number): string[]; handleInput?(data: string): void; dispose?(): void };

const answer = (text: string) => ({ role: "assistant", content: [{ type: "text", text }], stopReason: "stop" });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const message = (role: string, text: string) => ({ type: "message", message: { role, content: [{ type: "text", text }] } });

function load(opts: { model?: unknown; branch?: unknown[]; complete?: Complete } = {}) {
	// The hub is global: start every test from a clean side chat.
	setShared({ btw: undefined, sidebarActive: undefined });

	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	const shortcuts = new Map<string, Shortcut>();
	extension({
		on: (name: string, fn: Handler) => handlers.set(name, fn),
		registerCommand: (name: string, command: Command) => commands.set(name, command),
		registerShortcut: (key: string, shortcut: Shortcut) => shortcuts.set(key, shortcut),
	} as never);

	const calls: Array<{ model: unknown; context: { systemPrompt?: string; messages: Array<{ content: string }> } }> = [];
	const notes: string[] = [];
	let reader: Reader | undefined;
	let readerOpen: () => boolean = () => false;
	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: "/repo",
		model: "model" in opts ? opts.model : { id: "nan/qwen3.8-flash" },
		sessionManager: { getBranch: () => opts.branch ?? [] },
		modelRegistry: {
			complete: async (model: unknown, context: never) => {
				calls.push({ model, context });
				return opts.complete ? await opts.complete(model, context) : answer("una respuesta corta");
			},
		},
		ui: {
			notify: (text: string) => notes.push(text),
			// Pi builds the overlay component and keeps it until `done()`; the
			// fake builds it, hands it over and closes when the extension says so.
			custom: async (factory: (tui: unknown, theme: unknown, keys: unknown, done: () => void) => Reader) => {
				let open = true;
				reader = factory(tui, theme, {}, () => {
					open = false;
				});
				readerOpen = () => open;
			},
		},
	};

	const theme = { fg: (_role: string, text: string) => text };
	const tui = { requestRender: () => {}, terminal: { columns: 140, rows: 40 } };

	return {
		ctx,
		calls,
		notes,
		state: () => getShared().btw,
		run: (name: string, args = "") => commands.get(name)!.handler(args, ctx),
		command: (name: string) => commands.get(name),
		commandNames: () => [...commands.keys()],
		start: () => handlers.get("session_start")!({}, ctx),
		shutdown: () => handlers.get("session_shutdown")!({}, ctx),
		shortcut: (key: string) => shortcuts.get(key),
		/** Open the reader the way the shortcut does. */
		openShortcut: () => shortcuts.get("alt+b")!.handler(ctx),
		readerLines: (width = 60) => (reader ? reader.render(width) : []),
		isReaderOpen: () => readerOpen(),
		press: (data: string) => reader!.handleInput?.(data),
	};
}

test("btw: /btw with no argument opens the reader", async () => {
	const env = load();
	await env.start();
	assert.equal(env.state()?.open, false, "a session starts with the side chat closed");
	assert.equal(env.isReaderOpen(), false, "and no reader");

	await env.run("btw");
	assert.equal(env.state()?.open, true);
	assert.match(env.notes.at(-1)!, /Side chat open\./);
	assert.equal(env.isReaderOpen(), true, "the reader is what shows the chat");
	assert.equal(env.calls.length, 0, "opening the reader asks nothing of the model");
});

test("btw: asking with /btw opens the fullscreen reader", async () => {
	const env = load();
	await env.start();
	assert.equal(env.isReaderOpen(), false, "no reader before asking");

	await env.run("btw", "¿qué es el hub?");
	assert.equal(env.isReaderOpen(), true, "asking opens the reader");

	await flush();
	assert.match(env.readerLines().join("\n"), /una respuesta corta/, "and the answer lands in it");
});

test("btw: /btw <message> asks once, with the session conversation as context", async () => {
	const env = load({
		branch: [message("user", "arreglá el guard"), message("assistant", "listo, quedó verde"), { type: "toolResult", message: { role: "toolResult", content: "npm test" } }],
	});
	await env.start();
	await env.run("btw", "¿qué es un hub?");
	await flush();

	assert.equal(env.calls.length, 1, "one question, one call");
	const call = env.calls[0]!;
	assert.deepEqual(call.model, { id: "nan/qwen3.8-flash" }, "the session's own model answers");
	assert.match(call.context.systemPrompt!, /answer in spanish/i, "the prompt asks for a Spanish answer");
	const prompt = call.context.messages[0]!.content;
	assert.match(prompt, /arreglá el guard/, "the session conversation travels as context");
	assert.match(prompt, /listo, quedó verde/);
	assert.ok(!prompt.includes("npm test"), "tool output is not conversation and is not paid for");
	assert.ok(prompt.trimEnd().endsWith("¿qué es un hub?"), "the question is last");

	assert.equal(env.state()?.open, true, "asking opens the reader");
	assert.deepEqual(env.state()?.turns, [
		{ role: "user", text: "¿qué es un hub?" },
		{ role: "assistant", text: "una respuesta corta" },
	]);
});

test("btw: the English dictionary also asks the model to answer in Spanish", async () => {
	// The UI is English but the answer is Spanish: the surviving dictionary is
	// the one that has to say so, or `/btw` answers in the screen's language.
	const env = load({ branch: [message("user", "hola")] });
	await env.start();
	await env.run("btw", "¿qué es un hub?");
	await flush();
	const systemPrompt = env.calls[0]!.context.systemPrompt!;
	assert.match(systemPrompt, /answer in spanish/i, "the prompt must ask for a Spanish answer");
	assert.doesNotMatch(systemPrompt, /answer in english/i, "and must not ask for an English one");
});

test("btw: the question returns at once and the reader says it is thinking", async () => {
	let release: (value: unknown) => void = () => {};
	const env = load({ complete: () => new Promise((resolve) => { release = resolve; }) as Promise<unknown> });
	await env.start();

	await env.run("btw", "¿cuánto cuesta?");
	// The handler is back while the model is still working: the editor is yours.
	assert.equal(env.state()?.asking, true);
	assert.match(env.readerLines().join("\n"), /thinking…/);

	release(answer("poco"));
	await flush();
	assert.equal(env.state()?.asking, false);
	assert.match(env.readerLines().join("\n"), /poco/);
});

test("btw: a second question while one is in flight is refused, not queued", async () => {
	const env = load({ complete: () => new Promise(() => {}) as Promise<unknown> });
	await env.start();
	await env.run("btw", "primera");
	await env.run("btw", "segunda");
	await flush();

	assert.equal(env.calls.length, 1);
	assert.match(env.notes.at(-1)!, /already waiting/);
	assert.equal(env.state()?.turns.length, 1);
});

test("btw: a follow-up /btw carries the aside so far, so it is a conversation", async () => {
	const env = load();
	await env.start();
	await env.run("btw", "¿qué es un modo?");
	await flush();
	await env.run("btw", "¿y para qué sirve?");
	await flush();

	const prompt = env.calls[1]!.context.messages[0]!.content;
	assert.match(prompt, /¿qué es un modo\?/);
	assert.match(prompt, /una respuesta corta/, "its own previous answer is context");
	assert.equal(env.state()?.turns.length, 4);
});

test("btw: a failed question stays in the reader instead of scrolling away", async () => {
	const env = load({ complete: async () => { throw new Error("la red se cayó"); } });
	await env.start();
	await env.run("btw", "¿anda?");
	await flush();

	const turns = env.state()!.turns;
	assert.equal(turns.at(-1)!.role, "error");
	assert.match(turns.at(-1)!.text, /la red se cayó/);
	assert.equal(env.state()?.asking, false, "a failure releases the reader");
	assert.match(env.readerLines().join("\n"), /la red se cayó/);
});

test("btw: an answer with no text is a failure, not an empty answer", async () => {
	const env = load({ complete: async () => ({ role: "assistant", content: [], stopReason: "length" }) });
	await env.start();
	await env.run("btw", "¿?");
	await flush();
	assert.equal(env.state()!.turns.at(-1)!.role, "error");
});

test("btw: with no model the question is kept and the reason is shown", async () => {
	const env = load({ model: undefined });
	await env.start();
	await env.run("btw", "¿hola?");
	await flush();

	assert.equal(env.calls.length, 0);
	assert.deepEqual(env.state()!.turns[0], { role: "user", text: "¿hola?" });
	assert.match(env.state()!.turns.at(-1)!.text, /No active model/);
});

test("btw: /btw is the only side-chat command, so /palette lists it once", () => {
	const env = load();
	assert.deepEqual(env.commandNames(), ["btw"], "no other side-chat command is registered (S7)");
	assert.match(env.command("btw")!.description!, /\S/);
	assert.match(env.command("btw")!.description!, /\/btw/);
});

// --- The reader -------------------------------------------------------------
// A long answer does not fit, so the reader scrolls. These tests drive it by key.

/** An answer taller than any overlay, so there is always something off screen. */
const longAnswer = (rows: number) =>
	answer(Array.from({ length: rows }, (_unused, index) => `renglon ${index + 1}`).join("\n"));

test("btw: alt+b opens the reader, and it starts at the newest line", async () => {
	const env = load({ complete: async () => longAnswer(80) });
	await env.start();
	await env.run("btw", "contame algo largo");
	await flush();

	assert.match(env.shortcut("alt+b")!.description!, /\S/, "the shortcut is described for /hotkeys");

	await env.openShortcut();
	const lines = env.readerLines();
	assert.ok(lines.some((line) => line.includes("renglon 80")), "the end is on screen");
	assert.ok(!lines.some((line) => line.includes("renglon 1 ")), "the start is not");
});

test("btw: the reader scrolls — g reaches the question the answer buried", async () => {
	const env = load({ complete: async () => longAnswer(80) });
	await env.start();
	await env.run("btw", "¿por qué no puedo hacer scroll?");
	await flush();

	// The reader opens at the newest line: the answer buried the question.
	assert.ok(
		!env.readerLines().some((line) => line.includes("¿por qué no puedo hacer scroll?")),
		"the question is off screen",
	);

	env.press("g");
	assert.ok(
		env.readerLines().some((line) => line.includes("¿por qué no puedo hacer scroll?")),
		"the reader reaches it",
	);

	env.press("G");
	assert.ok(env.readerLines().some((line) => line.includes("renglon 80")), "and comes back to the end");
});

test("btw: esc and q close the reader; it never touches the conversation", async () => {
	for (const key of ["\u001b", "q"]) {
		const env = load({ complete: async () => longAnswer(40) });
		await env.start();
		await env.run("btw", "algo");
		await flush();
		const before = env.state();

		await env.openShortcut();
		assert.equal(env.isReaderOpen(), true, `${key}: open before the key`);
		env.press(key);
		assert.equal(env.isReaderOpen(), false, `${key}: closed after it`);
		assert.deepEqual(env.state(), before, `${key}: the aside is unchanged`);
		assert.equal(env.calls.length, 1, `${key}: reading asks the model nothing`);
	}
});

test("btw: without a TUI the reader says so instead of failing", async () => {
	const env = load();
	await env.start();
	env.ctx.hasUI = false;
	await env.openShortcut();
	assert.match(env.notes.at(-1)!, /interactive/i);
});

test("btw: the side chat goes with the session — a new one starts empty, shutdown drops it", async () => {
	const env = load();
	await env.start();
	await env.run("btw", "algo");
	await flush();
	assert.equal(env.state()?.turns.length, 2);

	await env.start();
	assert.deepEqual(env.state(), { open: false, turns: [], asking: false });

	await env.shutdown();
	assert.deepEqual(env.state(), { open: false, turns: [], asking: false });
});

test("btw: a child spawned by the agent runner registers nothing", () => {
	process.env.VIOLETA_AGENTS_CHILD = "1";
	try {
		const commands: string[] = [];
		extension({ on: () => {}, registerCommand: (name: string) => commands.push(name) } as never);
		assert.deepEqual(commands, [], "an aside is for the person at the keyboard");
	} finally {
		delete process.env.VIOLETA_AGENTS_CHILD;
	}
});
