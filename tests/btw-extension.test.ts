/**
 * The side chat driven through the real extension with a fake Pi: the four
 * command forms, the one model call each makes (and what it carries), the two
 * placements, and the failures that must stay visible instead of vanishing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../extensions/violeta-btw.ts";
import { setLanguage } from "../src/i18n.ts";
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
	setLanguage("es");
	// The hub is global: start every test from a clean side chat and no sidebar.
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
	const widgets = new Map<string, unknown>();
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
			setWidget: (key: string, content: unknown) => widgets.set(key, content),
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
	let reader: Reader | undefined;
	let readerOpen: () => boolean = () => false;

	return {
		ctx,
		calls,
		notes,
		state: () => getShared().btw,
		run: (name: string, args = "") => commands.get(name)!.handler(args, ctx),
		command: (name: string) => commands.get(name),
		start: () => handlers.get("session_start")!({}, ctx),
		shutdown: () => handlers.get("session_shutdown")!({}, ctx),
		/** The widget above the editor, rendered the way Pi renders it. */
		panel: (width = 60) => {
			const factory = widgets.get("btw-panel") as (t: unknown, th: unknown) => { render(w: number): string[] };
			return factory(tui, theme).render(width);
		},
		hasWidget: () => widgets.get("btw-panel") !== undefined,
		shortcut: (key: string) => shortcuts.get(key),
		/** Open the reader the way the shortcut does, then drive it by key. */
		openReader: async () => {
			await shortcuts.get("alt+b")!.handler(ctx);
			return {
				lines: (width = 60) => reader!.render(width),
				press: (data: string) => reader!.handleInput?.(data),
				isOpen: () => readerOpen(),
			};
		},
	};
}

test("btw: /btw with no argument opens and closes the window", async () => {
	const env = load();
	await env.start();
	assert.equal(env.state()?.open, false, "a session starts with the side chat closed");

	await env.run("btw");
	assert.equal(env.state()?.open, true);
	assert.match(env.notes.at(-1)!, /abierto/);

	await env.run("btw");
	assert.equal(env.state()?.open, false);
	assert.match(env.notes.at(-1)!, /cerrado/);
	assert.equal(env.calls.length, 0, "opening a window asks nothing of the model");
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
	assert.match(call.context.systemPrompt!, /español/i, "the prompt asks for a Spanish answer");
	const prompt = call.context.messages[0]!.content;
	assert.match(prompt, /arreglá el guard/, "the session conversation travels as context");
	assert.match(prompt, /listo, quedó verde/);
	assert.ok(!prompt.includes("npm test"), "tool output is not conversation and is not paid for");
	assert.ok(prompt.trimEnd().endsWith("¿qué es un hub?"), "the question is last");

	assert.equal(env.state()?.open, true, "asking opens the window");
	assert.deepEqual(env.state()?.turns, [
		{ role: "user", text: "¿qué es un hub?" },
		{ role: "assistant", text: "una respuesta corta" },
	]);
});

test("btw: the English dictionary also asks the model to answer in Spanish", async () => {
	// The UI is English but the answer is Spanish: the surviving dictionary is
	// the one that has to say so, or `/btw` answers in the screen's language.
	const env = load({ branch: [message("user", "hola")] });
	setLanguage("en");
	try {
		await env.start();
		await env.run("btw", "¿qué es un hub?");
		await flush();
		const systemPrompt = env.calls[0]!.context.systemPrompt!;
		assert.match(systemPrompt, /answer in spanish/i, "the prompt must ask for a Spanish answer");
		assert.doesNotMatch(systemPrompt, /answer in english/i, "and must not ask for an English one");
	} finally {
		setLanguage("es");
	}
});

test("btw: the question returns at once and the window says it is thinking", async () => {
	let release: (value: unknown) => void = () => {};
	const env = load({ complete: () => new Promise((resolve) => { release = resolve; }) as Promise<unknown> });
	await env.start();

	await env.run("btw", "¿cuánto cuesta?");
	// The handler is back while the model is still working: the editor is yours.
	assert.equal(env.state()?.asking, true);
	assert.match(env.panel().join("\n"), /pensando…/);

	release(answer("poco"));
	await flush();
	assert.equal(env.state()?.asking, false);
	assert.match(env.panel().join("\n"), /poco/);
});

test("btw: a second question while one is in flight is refused, not queued", async () => {
	const env = load({ complete: () => new Promise(() => {}) as Promise<unknown> });
	await env.start();
	await env.run("btw", "primera");
	await env.run("btw", "segunda");
	await flush();

	assert.equal(env.calls.length, 1);
	assert.match(env.notes.at(-1)!, /ya está esperando/);
	assert.equal(env.state()?.turns.length, 1);
});

test("btw: /btwn <message> asks with no context and with no previous conversation", async () => {
	const env = load({ branch: [message("user", "arreglá el guard")] });
	await env.start();
	await env.run("btw", "primera");
	await flush();

	await env.run("btwn", "¿y 2+2?");
	await flush();

	assert.equal(env.calls.length, 2);
	const prompt = env.calls[1]!.context.messages[0]!.content;
	assert.ok(!prompt.includes("arreglá el guard"), "/btwn carries no session context");
	assert.ok(!prompt.includes("primera"), "/btwn carries no previous aside");
	assert.deepEqual(env.state()?.turns, [
		{ role: "user", text: "¿y 2+2?" },
		{ role: "assistant", text: "una respuesta corta" },
	]);
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

test("btw: /btwn with no argument forgets the conversation and keeps the window", async () => {
	const env = load();
	await env.start();
	await env.run("btw", "algo");
	await flush();
	assert.equal(env.state()?.turns.length, 2);

	await env.run("btwn");
	assert.deepEqual(env.state()?.turns, []);
	assert.equal(env.state()?.open, true);
	assert.match(env.notes.at(-1)!, /borrada/);
	assert.equal(env.calls.length, 1, "clearing asks nothing");
});

test("btw: a failed question stays in the window instead of scrolling away", async () => {
	const env = load({ complete: async () => { throw new Error("la red se cayó"); } });
	await env.start();
	await env.run("btw", "¿anda?");
	await flush();

	const turns = env.state()!.turns;
	assert.equal(turns.at(-1)!.role, "error");
	assert.match(turns.at(-1)!.text, /la red se cayó/);
	assert.equal(env.state()?.asking, false, "a failure releases the window");
	assert.match(env.panel().join("\n"), /la red se cayó/);
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
	assert.match(env.state()!.turns.at(-1)!.text, /No hay modelo activo/);
});

test("btw: the window above the editor is framed, and empty while the side chat is closed", async () => {
	const env = load();
	await env.start();
	assert.deepEqual(env.panel(), [], "nothing is drawn while it is closed");

	await env.run("btw", "¿qué es el guard?");
	await flush();
	const lines = env.panel(60);
	assert.match(lines[0]!, /^╭─ Al margen ─+╮$/, "a box, so it is not read as part of the chat");
	assert.match(lines.at(-2)!, /^╰─+╯$/);
	assert.equal(lines.at(-1), "", "one blank row separates it from the editor");
});

test("btw: while the sidebar is active it owns the window and the widget draws nothing", async () => {
	const env = load();
	await env.start();
	await env.run("btw", "¿y esto?");
	await flush();
	assert.notDeepEqual(env.panel(), []);

	setShared({ sidebarActive: true });
	assert.deepEqual(env.panel(), [], "the sidebar becomes the chat; one window, not two");

	setShared({ sidebarActive: false });
	assert.notDeepEqual(env.panel(), [], "and it comes back without a restart");
});

test("btw: both commands are registered with a description, so /palette lists them", async () => {
	const env = load();
	assert.match(env.command("btw")!.description!, /\S/);
	assert.match(env.command("btwn")!.description!, /\S/);
	assert.match(env.command("btw")!.description!, /\/btw/);
	assert.match(env.command("btwn")!.description!, /\/btwn/);
});

// --- The reader -------------------------------------------------------------
// A long answer does not fit the panel, and neither the widget nor the sidebar
// column has the keyboard focus, so neither can scroll. The reader is an
// overlay, which does take focus. These tests drive it by key.

/** An answer taller than any overlay, so there is always something off screen. */
const longAnswer = (rows: number) =>
	answer(Array.from({ length: rows }, (_unused, index) => `renglon ${index + 1}`).join("\n"));

test("btw: alt+b and /btwv both open the reader, and it starts at the newest line", async () => {
	const env = load({ complete: async () => longAnswer(80) });
	await env.start();
	await env.run("btw", "contame algo largo");
	await flush();

	assert.match(env.shortcut("alt+b")!.description!, /\S/, "the shortcut is described for /hotkeys");
	assert.match(env.command("btwv")!.description!, /\S/);

	const reader = await env.openReader();
	const lines = reader.lines();
	assert.ok(lines.some((line) => line.includes("renglon 80")), "the end is on screen");
	assert.ok(!lines.some((line) => line.includes("renglon 1 ")), "the start is not");
});

test("btw: the reader scrolls — g reaches the question the panel had dropped", async () => {
	const env = load({ complete: async () => longAnswer(80) });
	await env.start();
	await env.run("btw", "¿por qué no puedo hacer scroll?");
	await flush();

	// The panel itself cannot show the question any more: the answer buried it.
	assert.ok(
		!env.panel().some((line) => line.includes("¿por qué no puedo hacer scroll?")),
		"the panel dropped the question, which is the bug this view fixes",
	);

	const reader = await env.openReader();
	reader.press("g");
	assert.ok(
		reader.lines().some((line) => line.includes("¿por qué no puedo hacer scroll?")),
		"the reader reaches it",
	);

	reader.press("G");
	assert.ok(reader.lines().some((line) => line.includes("renglon 80")), "and comes back to the end");
});

test("btw: esc and q close the reader; it never touches the conversation", async () => {
	for (const key of ["\u001b", "q"]) {
		const env = load({ complete: async () => longAnswer(40) });
		await env.start();
		await env.run("btw", "algo");
		await flush();
		const before = env.state();

		const reader = await env.openReader();
		assert.equal(reader.isOpen(), true, `${key}: open before the key`);
		reader.press(key);
		assert.equal(reader.isOpen(), false, `${key}: closed after it`);
		assert.deepEqual(env.state(), before, `${key}: the aside is unchanged`);
		assert.equal(env.calls.length, 1, `${key}: reading asks the model nothing`);
	}
});

test("btw: without a TUI the reader says so instead of failing", async () => {
	const env = load();
	await env.start();
	env.ctx.hasUI = false;
	await env.run("btwv");
	assert.match(env.notes.at(-1)!, /interactivo/i);
});

test("btw: the side chat goes with the session — a new one starts empty, shutdown drops the window", async () => {
	const env = load();
	await env.start();
	await env.run("btw", "algo");
	await flush();
	assert.equal(env.state()?.turns.length, 2);

	await env.start();
	assert.deepEqual(env.state(), { open: false, turns: [], asking: false });

	await env.shutdown();
	assert.equal(env.hasWidget(), false, "the widget is removed, not left drawing");
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
