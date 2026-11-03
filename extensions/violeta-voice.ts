/**
 * violeta-voice — opt-in voice: Jarvis speaks a short line, and you can dictate.
 *
 * `/voice on|off` (no argument toggles) persists the choice in violeta.json
 * under `voice`; the default is OFF. Everything here is inert while it is off:
 * no prompt change, no network call, no process. When on:
 * - `/voice completo` (default): the WHOLE written reply is read aloud, cleaned by
 *   code (code blocks and tables become a short notice, markup and arrows go, list
 *   items become sentences). It does not depend on the model obeying a format.
 *   `/voice resumen`: the model writes a separate `Voz:` script and only that is read;
 * - `/dictar` records from the microphone until you choose "Terminar", sends
 *   the audio to NaN's `whisper`, and puts the text in the editor for you to
 *   read and send. Nothing is ever sent to the agent by itself.
 *
 * Speech and transcription use NaN's `kokoro` and `whisper`. Players and
 * recorders are programs already on the machine (pw-play/aplay, pw-record/
 * arecord). Every failure is a notification, never an exception, and a failing
 * voice never touches the conversation. Subagent children register nothing.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { blocksText } from "../src/btw/request.ts";
import { goodmorning as gm, voice as t } from "../src/i18n.ts";
import { morningBrief } from "../src/goodmorning/brief.ts";
import { pickPlayer, pickRecorder, run, type Running } from "../src/voice/devices.ts";
import { MAX_SPEED, MIN_SPEED, clampSpeed, joinAsWav, readApiKey, synthesize, transcribe, voiceConfigFromEnv, type VoiceConfig } from "../src/voice/nan.ts";
import { LISTEN_PROMPT, VOICE_PROMPT, extractFull, extractSpoken } from "../src/voice/spoken.ts";
import { readVoiceEnabled, readVoiceMode, readVoiceSpeed, writeVoiceEnabled, writeVoiceMode, writeVoiceSpeed, type VoiceMode } from "../src/voice/state.ts";

export default function (pi: ExtensionAPI) {
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	let enabled = false;
	/** The saved pace; VIOLETA_VOICE_SPEED, when set, wins over it. */
	let savedSpeed: number | undefined;
	let mode: VoiceMode = "completo";
	let playing: Running | undefined;
	let lastSpokenKey: string | undefined;
	let warned = new Set<string>();

	const configFile = (): string | undefined => {
		const dir = process.env.PI_CODING_AGENT_DIR;
		return dir ? join(dir, "violeta.json") : undefined;
	};
	/** Pause between paragraphs, so each step of an explanation lands before the next. */
	const PARAGRAPH_PAUSE_MS = 700;
	/** The brief's own pause, between its sentences. Shorter than a paragraph's:
	 * these are five short sentences, not the steps of an explanation. Chosen by
	 * ear against 400, 500 and 650. */
	const BRIEF_PAUSE_MS = 450;
	/** Paragraphs synthesized at once: enough to start fast, few enough not to hit NaN's limits. */
	const PARALLEL = 3;
	const voiceConfig = (): VoiceConfig => {
		const config = voiceConfigFromEnv();
		return process.env.VIOLETA_VOICE_SPEED || savedSpeed === undefined ? config : { ...config, speed: clampSpeed(savedSpeed, config.speed) };
	};
	const key = (): string | undefined => readApiKey(process.env.PI_CODING_AGENT_DIR, process.env.HOME || homedir());
	/** One notice per kind per session: a broken voice must not nag on every reply. */
	const warnOnce = (ctx: ExtensionContext, kind: string, message: string): void => {
		if (warned.has(kind)) return;
		warned.add(kind);
		try {
			ctx.ui.notify(message, "warning");
		} catch {
			/* nothing to tell it to */
		}
	};

	async function stopPlayback(): Promise<void> {
		generation++;
		const current = playing;
		playing = undefined;
		if (current) await current.stop().catch(() => {});
	}

	/** The last assistant message of the branch: its entry id and its text. */
	function lastAssistant(ctx: ExtensionContext): { id: string; text: string } | undefined {
		try {
			const branch = ctx.sessionManager.getBranch();
			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i] as { id?: string; type: string; message?: AssistantMessage };
				if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
				const text = entry.message.content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join("\n");
				if (text.trim() !== "") return { id: entry.id ?? String(i), text };
			}
		} catch {
			/* reading the branch must never break the session */
		}
		return undefined;
	}

	/** Bumped by every stop, so a script that was cut off stops asking for more audio. */
	let generation = 0;
	/** Paragraphs are played in groups of about this many characters: the first group
	 * starts as soon as it is ready while the next ones are still being made. */
	const GROUP_CHARS = 1200;

	function groupParagraphs(paragraphs: string[]): string[][] {
		const groups: string[][] = [];
		let size = 0;
		for (const paragraph of paragraphs) {
			if (groups.length === 0 || size >= GROUP_CHARS) {
				groups.push([]);
				size = 0;
			}
			groups[groups.length - 1]!.push(paragraph);
			size += paragraph.length;
		}
		return groups;
	}

	/** The brief: gathered, written to the screen, and spoken when asked for.
	 * Written either way, because the audio goes by once and a headline is
	 * worth being able to re-read. */
	async function runBrief(ctx: ExtensionContext, aloud: boolean): Promise<void> {
		if (aloud && !enabled) {
			enabled = true;
			const path = configFile();
			if (path) writeVoiceEnabled(path, enabled);
		}
		ctx.ui.notify(gm.working, "info");
		const now = new Date();
		try {
			const brief = await morningBrief({
				name: process.env.VIOLETA_OWNER_NAME || "Tachi",
				now,
				// Every fresh story goes in and the model picks: the feeds narrow the
				// subject, they do not tell a development from a local course.
				summarize: (stories) => oneLineFromModel(ctx, gm.newsPrompt(stories)),
				joke: () =>
					oneLineFromModel(ctx, gm.jokePrompt(now.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }))),
			});
			ctx.ui.notify(brief.text, "info");
			// One paragraph per sentence, so speak() synthesizes each on its own and
			// the silence between them is measured. Not awaited, like every other
			// spoken line: the editor stays free while it plays, and speak() reports
			// its own failures.
			if (aloud) void speak(ctx, brief.sentences.join("\n\n"), BRIEF_PAUSE_MS);
		} catch (error) {
			ctx.ui.notify(gm.failed(error instanceof Error ? error.message : String(error)), "warning");
		}
	}

	/** The question every session opens with. The answer is the voice setting,
	 * so this is also how the voice gets turned on and off day to day; the brief
	 * follows either way, written when the answer is off.
	 *
	 * Escape answers nothing, and nothing is what happens: no feed is read, no
	 * model is called. Someone who dismissed the question did not ask for a
	 * brief, and `/goodmorn` is still there. */
	async function askAndBrief(ctx: ExtensionContext): Promise<void> {
		let choice: string | undefined;
		try {
			choice = await ctx.ui.select(gm.startupTitle, [gm.startupAloud, gm.startupSilent]);
		} catch {
			return;
		}
		if (choice !== gm.startupAloud && choice !== gm.startupSilent) return;
		const aloud = choice === gm.startupAloud;
		// The answer is remembered, so /voice reflects what was chosen here.
		if (enabled !== aloud) {
			enabled = aloud;
			const path = configFile();
			if (path) writeVoiceEnabled(path, enabled);
			if (!enabled) await stopPlayback();
		}
		await runBrief(ctx, aloud);
	}

	/** One line from the session's own model, for the brief. Answers nothing on
	 * any failure, including a reply that is all reasoning and no text: the
	 * brief has a fallback for every line, and is better short than broken. */
	async function oneLineFromModel(ctx: ExtensionContext, prompt: string): Promise<string | undefined> {
		const model = ctx.model;
		if (!model) return undefined;
		try {
			const answer = await ctx.modelRegistry.complete(model, {
				messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
			});
			if (answer?.errorMessage) return undefined;
			// blocksText is the same reader /btw uses for a reply's text; it is
			// generic and tested, so it is imported rather than copied.
			const text = blocksText(answer?.content).trim();
			return text === "" ? undefined : text;
		} catch {
			return undefined;
		}
	}

	async function speak(ctx: ExtensionContext, text: string, pauseMs: number = PARAGRAPH_PAUSE_MS): Promise<void> {
		const apiKey = key();
		if (!apiKey) return warnOnce(ctx, "key", t.noKey);
		await stopPlayback();
		const mine = ++generation;
		const dir = mkdtempSync(join(tmpdir(), "violeta-voice-"));
		try {
			const config = voiceConfig();
			const paragraphs = text.split(/\n\s*\n/).filter((paragraph) => paragraph.trim() !== "");
			// Every paragraph is requested (three at a time, in order); playback waits only for the group it is on.
			const audio: Array<Promise<Buffer | undefined>> = [];
			const settle: Array<{ ok: (b: Buffer | undefined) => void; fail: (e: unknown) => void }> = [];
			paragraphs.forEach((_, i) => {
				audio[i] = new Promise((ok, fail) => (settle[i] = { ok, fail }));
				audio[i]!.catch(() => {});
			});
			let next = 0;
			for (let w = 0; w < Math.min(PARALLEL, paragraphs.length); w++) {
				void (async () => {
					while (next < paragraphs.length) {
						const index = next++;
						if (mine !== generation) return settle[index]!.ok(undefined);
						try {
							settle[index]!.ok(await synthesize(paragraphs[index]!, apiKey, config));
						} catch (error) {
							settle[index]!.fail(error);
						}
					}
				})();
			}
			let cursor = 0;
			let first = true;
			for (const group of groupParagraphs(paragraphs)) {
				const pieces = await Promise.all(group.map((_, offset) => audio[cursor + offset]!));
				cursor += group.length;
				if (mine !== generation) return;
				const file = join(dir, `voz-${cursor}.wav`);
				writeFileSync(file, joinAsWav(pieces as Buffer[], pauseMs));
				const player = pickPlayer(file);
				if (!player) return warnOnce(ctx, "player", t.noPlayer);
				if (!first) await new Promise((resolve) => setTimeout(resolve, pauseMs));
				first = false;
				if (mine !== generation) return;
				const running = run(player, (message) => warnOnce(ctx, "player", t.playerFailed(message)));
				playing = running;
				await running.done;
			}
		} catch (error) {
			warnOnce(ctx, "speak", t.speakFailed((error as Error).message));
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		const file = configFile();
		enabled = file ? readVoiceEnabled(file) : false;
		savedSpeed = file ? readVoiceSpeed(file) : undefined;
		mode = file ? readVoiceMode(file) : "completo";
		warned = new Set();
		lastSpokenKey = undefined;
		if (ctx.mode !== "tui") return;

		// The session opens with the question and then the brief. Not awaited: a
		// dialog here would hold up every session_start handler behind it.
		void askAndBrief(ctx);

		pi.registerCommand("voice", {
			description: t.description,
			handler: async (args: string, commandCtx: ExtensionContext) => {
				const arg = args.trim().toLowerCase();
				const speedArg = /^(?:speed|velocidad)\s+(\S+)$/.exec(arg);
				if (speedArg) {
					const wanted = Number(speedArg[1]!.replace(",", "."));
					if (!Number.isFinite(wanted) || wanted < MIN_SPEED || wanted > MAX_SPEED) {
						commandCtx.ui.notify(t.speedUsage(MIN_SPEED, MAX_SPEED), "warning");
						return;
					}
					savedSpeed = wanted;
					const path = configFile();
					if (path) writeVoiceSpeed(path, wanted);
					commandCtx.ui.notify(t.speedSet(wanted), "info");
					return;
				}
				if (arg === "completo" || arg === "resumen") {
					mode = arg;
					const path = configFile();
					if (path) writeVoiceMode(path, mode);
					commandCtx.ui.notify(mode === "completo" ? t.modeFull : t.modeSummary, "info");
					return;
				}
				if (arg && arg !== "on" && arg !== "off") {
					commandCtx.ui.notify(t.usage, "warning");
					return;
				}
				enabled = arg === "on" ? true : arg === "off" ? false : !enabled;
				const path = configFile();
				if (path) writeVoiceEnabled(path, enabled);
				if (!enabled) await stopPlayback();
				commandCtx.ui.notify(enabled ? t.enabled : t.disabled, "info");
			},
		});

		// `/goodmorn` — the morning brief, spoken. The facts and the decision of
		// what the day's line is live in src/goodmorning/; this only supplies the
		// joke (the one piece that needs a model) and reads the result aloud.
		pi.registerCommand("goodmorn", {
			description: gm.description,
			// Asked for by hand, the brief is meant to be heard: the command turns
			// the voice on and remembers it, exactly as `/voice on` would.
			handler: (_args: string, commandCtx: ExtensionContext) => runBrief(commandCtx, true),
		});

		pi.registerCommand("dictar", {
			description: t.dictateDescription,
			handler: async (_args: string, commandCtx: ExtensionContext) => {
				if (!enabled) {
					commandCtx.ui.notify(t.dictateNeedsVoice, "warning");
					return;
				}
				const apiKey = key();
				if (!apiKey) {
					commandCtx.ui.notify(t.noKey, "warning");
					return;
				}
				const dir = mkdtempSync(join(tmpdir(), "violeta-dictar-"));
				try {
					const file = join(dir, "dictado.wav");
					const tool = pickRecorder(file);
					if (!tool) {
						commandCtx.ui.notify(t.noRecorder, "warning");
						return;
					}
					await stopPlayback();
					let recorderError: string | undefined;
					const recording = run(tool, (message) => (recorderError = message));
					// The dialog IS the recording indicator: it stays open while the
					// microphone is on, and closing it either way stops the recorder.
					const choice = await commandCtx.ui.select(t.recordingTitle, [t.finish, t.cancel]);
					await recording.stop();
					if (recorderError) {
						commandCtx.ui.notify(t.recorderFailed(recorderError), "warning");
						return;
					}
					if (choice !== t.finish) {
						commandCtx.ui.notify(t.dictateCancelled, "info");
						return;
					}
					const text = await transcribe(file, apiKey, voiceConfig());
					if (text === "") {
						commandCtx.ui.notify(t.nothingHeard, "warning");
						return;
					}
					commandCtx.ui.setEditorText(text);
					commandCtx.ui.notify(t.dictated, "info");
				} catch (error) {
					commandCtx.ui.notify(t.dictateFailed((error as Error).message), "warning");
				} finally {
					rmSync(dir, { recursive: true, force: true });
				}
			},
		});
	});

	// Only while on: ask for the spoken line. A new prompt also silences whatever is playing.
	pi.on("before_agent_start", async (event) => {
		if (!enabled) return;
		void stopPlayback();
		const existing = event.systemPromptOptions.appendSystemPrompt;
		const addition = mode === "completo" ? LISTEN_PROMPT : VOICE_PROMPT;
		event.systemPromptOptions.appendSystemPrompt = existing ? `${existing}\n\n${addition}` : addition;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!enabled || ctx.mode !== "tui") return;
		const last = lastAssistant(ctx);
		if (!last || last.id === lastSpokenKey) return;
		lastSpokenKey = last.id;
		const spoken = mode === "completo" ? extractFull(last.text) : extractSpoken(last.text);
		if (spoken) void speak(ctx, spoken);
	});

	pi.on("session_shutdown", async () => {
		await stopPlayback();
	});
}
