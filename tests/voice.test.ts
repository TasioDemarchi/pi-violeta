import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-voice.ts";
import { setLanguage } from "../src/i18n.ts";
import { pickPlayer, pickRecorder } from "../src/voice/devices.ts";
import { PCM_RATE, clampSpeed, joinAsWav, readApiKey, synthesize, transcribe, voiceConfigFromEnv } from "../src/voice/nan.ts";
import { LISTEN_PROMPT, MAX_FULL_CHARS, MAX_SPOKEN_CHARS, VOICE_PROMPT, extractFull, extractSpoken } from "../src/voice/spoken.ts";
import { readVoiceEnabled, readVoiceMode, readVoiceSpeed, writeVoiceEnabled, writeVoiceSpeed } from "../src/voice/state.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "violeta-voice-test-"));

test("only the last Voz line is spoken, cleaned for speech", () => {
	assert.equal(extractSpoken("Largo detalle con `código`.\n\nVoz: Listo, el contrato está armado. ¿Lo aprobás?"), "Listo, el contrato está armado. ¿Lo aprobás?");
	assert.equal(extractSpoken("Voz: primera\nmás texto\n🔊 Voz: **segunda** con `x` y https://a.b/c"), "segunda con x y.");
	assert.equal(extractSpoken("Texto.\n\nVoz: Uno.\n\nDos sin punto\n\n- tres\n- cuatro"), "Uno.\n\nDos sin punto.\n\ntres.\n\ncuatro.", "a multi-paragraph script keeps its pauses and loses list marks");
	assert.equal(extractSpoken("Voz: [mirá esto](http://x.y)"), "mirá esto.");
});

test("the voice prompt asks for the answer itself, not a description of it", () => {
	assert.match(VOICE_PROMPT, /is the answer itself, spoken/);
	assert.match(VOICE_PROMPT, /count, say the numbers/);
	assert.match(VOICE_PROMPT, /self-contained/);
	assert.match(VOICE_PROMPT, /Write for the ear/);
});

test("no Voz line means nothing is spoken, never a fallback to the whole reply", () => {
	assert.equal(extractSpoken("Una respuesta larga sin línea de voz."), undefined);
	assert.equal(extractSpoken("Voz:   "), undefined);
	assert.equal(extractSpoken(undefined), undefined);
	assert.equal(extractSpoken("La Voz: está en medio de una frase normal"), undefined);
});

test("a long spoken line is cut", () => {
	const spoken = extractSpoken(`Voz: ${"palabra ".repeat(800)}`)!;
	assert.ok(spoken.length <= MAX_SPOKEN_CHARS + 1);
	assert.ok(spoken.endsWith("…"));
	const sentences = extractSpoken(`Voz: ${"Una frase corta de prueba. ".repeat(300)}`)!;
	assert.ok(sentences.length <= MAX_SPOKEN_CHARS && sentences.endsWith("."), "it stops at a sentence end");
});

test("voice preference defaults to off and keeps unrelated keys", () => {
	const file = join(tmp(), "violeta.json");
	assert.equal(readVoiceEnabled(file), false);
	writeFileSync(file, "{ not json");
	assert.equal(readVoiceEnabled(file), false);
	writeFileSync(file, JSON.stringify({ sidebar: true, mode: "jarvis" }));
	writeVoiceEnabled(file, true);
	assert.equal(readVoiceEnabled(file), true);
	assert.deepEqual({ ...JSON.parse(readFileSync(file, "utf8")) }, { sidebar: true, mode: "jarvis", voice: true });
	writeFileSync(file, JSON.stringify({ voice: "yes" }));
	assert.equal(readVoiceEnabled(file), false, "only a real true turns it on");
});

test("the key comes from violeta's auth.json, then gentle-shell's, and is absent otherwise", () => {
	const home = tmp();
	const agent = join(tmp(), "agent");
	assert.equal(readApiKey(agent, home), undefined);
	mkdirSync(join(home, ".gentle-shell", "agent"), { recursive: true });
	writeFileSync(join(home, ".gentle-shell", "agent", "auth.json"), JSON.stringify({ nan: { key: "gs-key" } }));
	assert.equal(readApiKey(agent, home), "gs-key");
	mkdirSync(agent, { recursive: true });
	writeFileSync(join(agent, "auth.json"), JSON.stringify({ nan: { key: " own-key " } }));
	assert.equal(readApiKey(agent, home), "own-key");
});

test("synthesize posts the speech request and returns the audio", async () => {
	let seen: { url: string; init: RequestInit } | undefined;
	const fake = (async (url: string, init: RequestInit) => {
		seen = { url, init };
		return new Response(Buffer.alloc(200, 1));
	}) as unknown as typeof fetch;
	const audio = await synthesize("hola", "secret", voiceConfigFromEnv({}), fake);
	assert.equal(audio.length, 200);
	assert.equal(seen!.url, "https://api.nan.builders/v1/audio/speech");
	const body = JSON.parse(String(seen!.init.body));
	assert.deepEqual(
		[body.model, body.input, body.response_format, body.speed, body.voice],
		["kokoro", "hola", "pcm", 1, "ef_dora(2)+em_alex(1)"],
	);
	assert.equal((seen!.init.headers as Record<string, string>).Authorization, "Bearer secret");
});

test("a failing service gives a readable error that never contains the key", async () => {
	const fake = (async () => new Response("quota exceeded", { status: 429 })) as unknown as typeof fetch;
	await assert.rejects(
		() => synthesize("hola", "secret-key-123", voiceConfigFromEnv({}), fake),
		(error: Error) => /429/.test(error.message) && /quota exceeded/.test(error.message) && !error.message.includes("secret-key-123"),
	);
});

test("transcribe sends the audio as a Spanish whisper request and returns the text", async () => {
	const file = join(tmp(), "a.wav");
	writeFileSync(file, Buffer.alloc(100, 2));
	let form: FormData | undefined;
	let url = "";
	const fake = (async (u: string, init: RequestInit) => {
		url = u;
		form = init.body as FormData;
		return new Response(JSON.stringify({ text: " hola mundo " }));
	}) as unknown as typeof fetch;
	assert.equal(await transcribe(file, "k", voiceConfigFromEnv({}), fake), "hola mundo");
	assert.equal(url, "https://api.nan.builders/v1/audio/transcriptions");
	assert.equal(form!.get("model"), "whisper");
	assert.equal(form!.get("language"), "es");
});

test("players and recorders are picked from what exists, or none", () => {
	assert.equal(pickPlayer("f.wav", (c) => c === "pw-play")?.command, "pw-play");
	assert.equal(pickPlayer("f.wav", (c) => c === "aplay")?.command, "aplay");
	assert.equal(pickPlayer("f.wav", () => false), undefined);
	assert.equal(pickRecorder("f.wav", (c) => c === "arecord")?.command, "arecord");
	assert.deepEqual(pickRecorder("f.wav", (c) => c === "pw-record")?.args.slice(0, 4), ["--rate", "16000", "--channels", "1"]);
	assert.equal(pickRecorder("f.wav", () => false), undefined);
});

// --- the extension, against a fake Pi and a fake player ---------------------

function setup(voiceOn: boolean, mode: "completo" | "resumen" = "resumen") {
	setLanguage("es");
	const agentDir = tmp();
	writeFileSync(join(agentDir, "violeta.json"), JSON.stringify(voiceOn ? { voice: true, voiceMode: mode } : {}));
	writeFileSync(join(agentDir, "auth.json"), JSON.stringify({ nan: { key: "test-key" } }));
	process.env.PI_CODING_AGENT_DIR = agentDir;
	delete process.env.VIOLETA_AGENTS_CHILD;
	// A player that only leaves a marker, so the test never makes a sound.
	const bin = tmp();
	const marker = join(bin, "played");
	writeFileSync(join(bin, "pw-play"), `#!/bin/sh\necho "$1" > "${marker}"\n`);
	chmodSync(join(bin, "pw-play"), 0o755);
	process.env.PATH = `${bin}:${process.env.PATH}`;

	const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
	const commands = new Map<string, { handler: (a: string, c: unknown) => Promise<void> }>();
	extension({
		on: (name: string, fn: (e: unknown, c: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		registerCommand: (name: string, c: { handler: (a: string, c: unknown) => Promise<void> }) => commands.set(name, c),
	} as never);
	const notes: string[] = [];
	const branch = [{ id: "m1", type: "message", message: { role: "assistant", content: [{ type: "text", text: "Hecho.\n\nVoz: Terminé, probalo." }] } }];
	// The brief asks the session's model for a joke, but only when the feed has
	// nothing fresh, so the fake records every prompt it is given.
	const completions: string[] = [];
	let answer: unknown = { content: "Hoy es martes, y el martes no se discute" };
	const ctx = {
		mode: "tui",
		ui: { notify: (text: string) => notes.push(text), setEditorText: () => {}, select: async () => "Cancelar" },
		sessionManager: { getBranch: () => branch },
		model: { provider: "nan", id: "test-model" },
		modelRegistry: {
			complete: async (_model: unknown, request: { messages: Array<{ content: string }> }) => {
				completions.push(request.messages[0]!.content);
				return answer;
			},
		},
	};
	const fire = async (name: string, event: unknown = {}) => {
		for (const fn of handlers.get(name) ?? []) await fn(event, ctx);
	};
	const setAnswer = (value: unknown) => {
		answer = value;
	};
	return { fire, commands, notes, ctx, marker, agentDir, completions, setAnswer };
}

test("voice off: the prompt is untouched, nothing is fetched, nothing is played", async () => {
	const env = setup(false);
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("voice off must not touch the network");
	}) as unknown as typeof fetch;
	try {
		await env.fire("session_start");
		const event = { systemPromptOptions: { appendSystemPrompt: "base" } };
		await env.fire("before_agent_start", event);
		assert.equal(event.systemPromptOptions.appendSystemPrompt, "base");
		await env.fire("agent_settled");
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(existsSync(env.marker), false);
		assert.deepEqual(env.notes, []);
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("/voice on persists, adds the voice prompt, and the Voz line is spoken once", async () => {
	const env = setup(false);
	const realFetch = globalThis.fetch;
	const spoken: string[] = [];
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		spoken.push(JSON.parse(String(init.body)).input);
		return new Response(Buffer.alloc(200, 1));
	}) as unknown as typeof fetch;
	try {
		await env.fire("session_start");
		await env.commands.get("voice")!.handler("on", env.ctx);
		assert.equal(readVoiceEnabled(join(env.agentDir, "violeta.json")), true);
		await env.commands.get("voice")!.handler("resumen", env.ctx);
		const event = { systemPromptOptions: { appendSystemPrompt: "base" } };
		await env.fire("before_agent_start", event);
		assert.equal(event.systemPromptOptions.appendSystemPrompt, `base\n\n${VOICE_PROMPT}`);
		await env.fire("agent_settled");
		for (let i = 0; i < 50 && !existsSync(env.marker); i++) await new Promise((resolve) => setTimeout(resolve, 50));
		assert.deepEqual(spoken, ["Terminé, probalo."]);
		assert.ok(existsSync(env.marker), "the player ran");
		await env.fire("agent_settled");
		await new Promise((resolve) => setTimeout(resolve, 100));
		assert.equal(spoken.length, 1, "the same reply is never read twice");
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("a failing voice service warns once and never throws", async () => {
	const env = setup(true);
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
	try {
		await env.fire("session_start");
		await env.fire("agent_settled");
		for (let i = 0; i < 50 && env.notes.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(env.notes.length, 1);
		assert.match(env.notes[0]!, /La voz falló/);
		assert.match(env.notes[0]!, /503/);
		assert.ok(!env.notes[0]!.includes("test-key"));
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("/dictar needs voice on, and a cancelled recording sends nothing to Whisper", async () => {
	const off = setup(false);
	await off.fire("session_start");
	await off.commands.get("dictar")!.handler("", off.ctx);
	assert.match(off.notes[0]!, /\/voice on/);

	const on = setup(true);
	const realFetch = globalThis.fetch;
	globalThis.fetch = (async () => {
		throw new Error("a cancelled dictation must not upload anything");
	}) as unknown as typeof fetch;
	try {
		await on.fire("session_start");
		await on.commands.get("dictar")!.handler("", on.ctx);
		assert.ok(on.notes.length === 1 && /cancelado|No encontré con qué grabar/.test(on.notes[0]!), on.notes.join("|"));
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("subagent children register nothing", () => {
	process.env.VIOLETA_AGENTS_CHILD = "1";
	let registered = 0;
	extension({ on: () => registered++, registerCommand: () => registered++ } as never);
	delete process.env.VIOLETA_AGENTS_CHILD;
	assert.equal(registered, 0);
});

test("speed defaults to the model's own pace and is clamped to what the service accepts", () => {
	assert.equal(voiceConfigFromEnv({}).speed, 1);
	assert.equal(voiceConfigFromEnv({ VIOLETA_VOICE_SPEED: "0.7" }).speed, 0.7);
	assert.equal(voiceConfigFromEnv({ VIOLETA_VOICE_SPEED: "abc" }).speed, 1);
	assert.equal(clampSpeed(9, 0.85), 1.3);
	assert.equal(clampSpeed(0.1, 0.85), 0.5);
});

test("joinAsWav writes an honest header and puts silence only between pieces", () => {
	const a = Buffer.alloc(1000, 1);
	const b = Buffer.alloc(600, 2);
	const wav = joinAsWav([a, b], 500);
	const silence = Math.round(PCM_RATE * 0.5) * 2;
	assert.equal(wav.length, 44 + 1000 + silence + 600);
	assert.equal(wav.toString("ascii", 0, 4), "RIFF");
	assert.equal(wav.readUInt32LE(4), wav.length - 8);
	assert.equal(wav.readUInt32LE(24), 24000);
	assert.equal(wav.readUInt32LE(40), 1000 + silence + 600);
	assert.ok(wav.subarray(44 + 1000, 44 + 1000 + silence).every((byte) => byte === 0), "silence between");
	assert.equal(joinAsWav([a], 500).length, 44 + 1000, "one piece has no silence");
});

test("/voice speed saves a valid pace and rejects the rest", async () => {
	const env = setup(true);
	await env.fire("session_start");
	await env.commands.get("voice")!.handler("speed 0,75", env.ctx);
	assert.equal(readVoiceSpeed(join(env.agentDir, "violeta.json")), 0.75);
	assert.match(env.notes.at(-1)!, /0\.75/);
	await env.commands.get("voice")!.handler("speed 5", env.ctx);
	assert.match(env.notes.at(-1)!, /uso: \/voice speed/);
	assert.equal(readVoiceSpeed(join(env.agentDir, "violeta.json")), 0.75, "an invalid pace changes nothing");
	writeVoiceSpeed(join(env.agentDir, "violeta.json"), 0.9);
	assert.equal(readVoiceSpeed(join(env.agentDir, "violeta.json")), 0.9);
});

test("a multi-paragraph script is synthesized per paragraph at the saved pace and played once", async () => {
	const env = setup(true);
	writeFileSync(join(env.agentDir, "violeta.json"), JSON.stringify({ voice: true, voiceMode: "resumen", voiceSpeed: 0.7 }));
	const realFetch = globalThis.fetch;
	const requests: Array<{ input: string; speed: number }> = [];
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		requests.push({ input: body.input, speed: body.speed });
		return new Response(Buffer.alloc(2000, 1));
	}) as unknown as typeof fetch;
	try {
		await env.fire("session_start");
		const branch = (env.ctx.sessionManager as { getBranch: () => unknown[] }).getBranch();
		(branch[0] as { message: { content: Array<{ text: string }> } }).message.content[0]!.text = "Detalle.\n\nVoz: Primera parte.\n\nSegunda parte.\n\nTercera parte.";
		await env.fire("agent_settled");
		for (let i = 0; i < 60 && !existsSync(env.marker); i++) await new Promise((resolve) => setTimeout(resolve, 50));
		assert.deepEqual(requests.map((r) => r.input).sort(), ["Primera parte.", "Segunda parte.", "Tercera parte."]);
		assert.ok(requests.every((r) => r.speed === 0.7), "the saved pace is used");
		assert.ok(existsSync(env.marker));
	} finally {
		globalThis.fetch = realFetch;
	}
});

const REPLY = [
	"Clean Architecture en una frase: tu negocio va en el centro.",
	"",
	"Los anillos, de adentro hacia afuera:",
	"1. Entidades → las reglas que existirían sin computadoras",
	"2. Casos de uso → acciones concretas",
	"",
	"```ts",
	"const x = 1;",
	"```",
	"",
	"| anillo | ejemplo |",
	"|---|---|",
	"| datos | Postgres |",
	"",
	"— Términos —",
	"Dependencia: cuando un archivo necesita a otro.",
	"",
	"Voz: resumen que no debe leerse en modo completo.",
].join("\n");

test("full mode reads the whole written reply, speakable, and drops what cannot be spoken", () => {
	const spoken = extractFull(REPLY)!;
	assert.match(spoken, /^Clean Architecture en una frase: tu negocio va en el centro\./);
	assert.match(spoken, /Entidades, las reglas que existirían sin computadoras\./, "arrows become a pause and list items sentences");
	assert.match(spoken, /Hay código en pantalla\./);
	assert.match(spoken, /Hay una tabla en pantalla\./);
	assert.match(spoken, /Términos/);
	assert.match(spoken, /Dependencia: cuando un archivo necesita a otro\./, "the glossary is plain Spanish, so it is read");
	assert.ok(!/const x|```|\||→|Postgres/.test(spoken), "no code, table cells or arrows");
	assert.ok(!/resumen que no debe/.test(spoken), "another mode's Voz section is not repeated");
});

test("full mode: an empty reply says nothing, a very long one is cut at a sentence end", () => {
	assert.equal(extractFull(undefined), undefined);
	assert.equal(extractFull("```ts\nx\n```"), "Hay código en pantalla.");
	const long = extractFull("Una frase de prueba bastante normal. ".repeat(1000))!;
	assert.ok(long.length <= MAX_FULL_CHARS && long.endsWith("."));
});

test("the voice mode defaults to full and only a saved resumen changes it", () => {
	const file = join(tmp(), "violeta.json");
	assert.equal(readVoiceMode(file), "completo");
	writeFileSync(file, JSON.stringify({ voiceMode: "resumen" }));
	assert.equal(readVoiceMode(file), "resumen");
	writeFileSync(file, JSON.stringify({ voiceMode: "cualquiera" }));
	assert.equal(readVoiceMode(file), "completo");
});

test("full mode in the extension: the prompt only asks to write for the ear, and the reply is what is spoken", async () => {
	const env = setup(true, "completo");
	const realFetch = globalThis.fetch;
	const spoken: string[] = [];
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		spoken.push(JSON.parse(String(init.body)).input);
		return new Response(Buffer.alloc(2000, 1));
	}) as unknown as typeof fetch;
	try {
		await env.fire("session_start");
		const event = { systemPromptOptions: { appendSystemPrompt: undefined as string | undefined } };
		await env.fire("before_agent_start", event);
		assert.equal(event.systemPromptOptions.appendSystemPrompt, LISTEN_PROMPT);
		const branch = (env.ctx.sessionManager as { getBranch: () => unknown[] }).getBranch();
		(branch[0] as { message: { content: Array<{ text: string }> } }).message.content[0]!.text = "Primera idea.\n\nSegunda idea.\n\n```js\nx\n```";
		await env.fire("agent_settled");
		for (let i = 0; i < 60 && !existsSync(env.marker); i++) await new Promise((resolve) => setTimeout(resolve, 50));
		assert.deepEqual(spoken.sort(), ["Hay código en pantalla.", "Primera idea.", "Segunda idea."]);
		await env.commands.get("voice")!.handler("resumen", env.ctx);
		assert.equal(readVoiceMode(join(env.agentDir, "violeta.json")), "resumen");
		await env.commands.get("voice")!.handler("completo", env.ctx);
		assert.equal(readVoiceMode(join(env.agentDir, "violeta.json")), "completo");
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("a long reply is played in groups: the first one starts before the rest is done", async () => {
	const env = setup(true, "completo");
	const realFetch = globalThis.fetch;
	const started: string[] = [];
	globalThis.fetch = (async (_url: string, init: RequestInit) => {
		const input = JSON.parse(String(init.body)).input as string;
		started.push(input);
		// later paragraphs are slow: playback must not wait for them to start
		await new Promise((resolve) => setTimeout(resolve, input.startsWith("A") ? 0 : 400));
		return new Response(Buffer.alloc(2000, 1));
	}) as unknown as typeof fetch;
	try {
		await env.fire("session_start");
		const branch = (env.ctx.sessionManager as { getBranch: () => unknown[] }).getBranch();
		const big = (letter: string) => `${letter}${"x".repeat(1300)}.`;
		(branch[0] as { message: { content: Array<{ text: string }> } }).message.content[0]!.text = [big("A"), big("B"), big("C")].join("\n\n");
		const t0 = Date.now();
		await env.fire("agent_settled");
		for (let i = 0; i < 100 && !existsSync(env.marker); i++) await new Promise((resolve) => setTimeout(resolve, 20));
		assert.ok(existsSync(env.marker), "the first group played");
		assert.ok(Date.now() - t0 < 380, `it did not wait for the slow groups (${Date.now() - t0} ms)`);
		assert.equal(started.length, 3, "everything was requested");
	} finally {
		globalThis.fetch = realFetch;
	}
});

// --- /goodmorn: the morning brief ------------------------------------------

/** A network where the brief's three data services and the voice itself all
 * answer, routed by url, so one fake covers the whole command. */
function briefNetwork(feed: string, spoken: string[]) {
	return (async (url: string, init: RequestInit) => {
		const target = String(url);
		if (target.includes("/audio/speech")) {
			spoken.push(JSON.parse(String(init.body)).input);
			return new Response(Buffer.alloc(200, 1));
		}
		if (target.includes("ifconfig.co")) return new Response(JSON.stringify({ city: "Del Viso", latitude: -34.45, longitude: -58.79 }));
		if (target.includes("open-meteo")) return new Response(JSON.stringify({ current: { temperature_2m: 18.9, weather_code: 80 } }));
		if (target.includes("news.google.com")) return new Response(feed);
		throw new Error(`unexpected url ${target}`);
	}) as unknown as typeof fetch;
}

const feedWith = (title: string, when: Date) =>
	`<rss><channel><item><title>${title}</title><pubDate>${when.toUTCString()}</pubDate></item></channel></rss>`;

test("/goodmorn turns the voice on by itself, reports the real headline and never pays for a joke", async () => {
	// It is a spoken command: asking the user to turn the voice on first would
	// make it useless as a morning command.
	const env = setup(false);
	const realFetch = globalThis.fetch;
	const spoken: string[] = [];
	globalThis.fetch = briefNetwork(feedWith("El dólar cerró estable - Clarín", new Date()), spoken);
	try {
		await env.fire("session_start");
		await env.commands.get("goodmorn")!.handler("", env.ctx);
		assert.equal(readVoiceEnabled(join(env.agentDir, "violeta.json")), true, "and it remembers it");
		for (let i = 0; i < 60 && !existsSync(env.marker); i++) await new Promise((resolve) => setTimeout(resolve, 50));
		assert.ok(existsSync(env.marker), "the player ran");
		const line = spoken.join(" ");
		assert.match(line, /señor Tasio/);
		assert.match(line, /El clima en Del Viso es de diecinueve grados centígrados con chaparrones\./);
		assert.match(line, /Según Clarín, El dólar cerró estable\./);
		assert.match(line, /¿En qué trabajaremos hoy\?$/);
		assert.deepEqual(env.completions, [], "there was news, so the model was never asked");
		// Spoken and written: the audio goes by once.
		assert.ok(env.notes.some((note) => note.includes("Según Clarín")), "the brief is shown as well as said");
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("with nothing fresh in the feed the model is asked for one line, and it is the one spoken", async () => {
	const env = setup(false);
	const realFetch = globalThis.fetch;
	const spoken: string[] = [];
	// Three days old: in the feed, but not news.
	const old = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
	globalThis.fetch = briefNetwork(feedWith("Algo viejo - Infobae", old), spoken);
	try {
		await env.fire("session_start");
		await env.commands.get("goodmorn")!.handler("", env.ctx);
		for (let i = 0; i < 60 && !existsSync(env.marker); i++) await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(env.completions.length, 1, "exactly one call, and only because there was no news");
		assert.match(env.completions[0]!, /una sola línea graciosa/i);
		assert.match(env.completions[0]!, /Nunca inventes una noticia/i);
		const line = spoken.join(" ");
		assert.match(line, /Hoy es martes, y el martes no se discute\./);
		assert.ok(!line.includes("Algo viejo"), "a stale headline is not reported as news");
	} finally {
		globalThis.fetch = realFetch;
	}
});

test("a model that fails costs the joke, and the brief is still said", async () => {
	const env = setup(false);
	env.setAnswer({ errorMessage: "el proveedor dijo no" });
	const realFetch = globalThis.fetch;
	const spoken: string[] = [];
	globalThis.fetch = briefNetwork("<rss></rss>", spoken);
	try {
		await env.fire("session_start");
		await env.commands.get("goodmorn")!.handler("", env.ctx);
		for (let i = 0; i < 60 && !existsSync(env.marker); i++) await new Promise((resolve) => setTimeout(resolve, 50));
		const line = spoken.join(" ");
		assert.match(line, /señor Tasio/);
		assert.match(line, /¿En qué trabajaremos hoy\?$/);
		assert.ok(!line.includes("dijo no"), "an error is never read out loud");
	} finally {
		globalThis.fetch = realFetch;
	}
});
