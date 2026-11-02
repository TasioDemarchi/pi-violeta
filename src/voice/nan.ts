/** NaN's OpenAI-compatible audio endpoints: `kokoro` speaks, `whisper` listens.
 * The key is read the way models.json reads it and is never put in an error. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface VoiceConfig {
	baseUrl: string;
	ttsModel: string;
	sttModel: string;
	voice: string;
	/** Speaking rate: 1 is the model's pace, lower is slower. */
	speed: number;
	timeoutMs: number;
}

export const DEFAULT_SPEED = 0.85;
export const MIN_SPEED = 0.5;
export const MAX_SPEED = 1.3;

/** A usable rate, or the fallback for anything that is not a number in range. */
export function clampSpeed(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, value)) : fallback;
}

export function voiceConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
	return {
		baseUrl: (env.VIOLETA_VOICE_BASE_URL || "https://api.nan.builders/v1").replace(/\/+$/, ""),
		ttsModel: env.VIOLETA_VOICE_TTS_MODEL || "kokoro",
		sttModel: env.VIOLETA_VOICE_STT_MODEL || "whisper",
		voice: env.VIOLETA_VOICE_NAME || "ef_dora",
		speed: clampSpeed(Number(env.VIOLETA_VOICE_SPEED), DEFAULT_SPEED),
		timeoutMs: 60_000,
	};
}

/** violeta's own auth.json first, then gentle-shell's. */
export function readApiKey(agentDir: string | undefined, home: string): string | undefined {
	const files = [agentDir ? join(agentDir, "auth.json") : undefined, join(home, ".gentle-shell", "agent", "auth.json")];
	for (const file of files) {
		if (!file) continue;
		try {
			const key = (JSON.parse(readFileSync(file, "utf8")) as { nan?: { key?: unknown } })?.nan?.key;
			if (typeof key === "string" && key.trim() !== "") return key.trim();
		} catch {
			// try the next one
		}
	}
	return undefined;
}

type Fetch = typeof fetch;

async function failure(what: string, response: Response): Promise<Error> {
	const body = (await response.text().catch(() => "")).slice(0, 160).replace(/\s+/g, " ");
	return new Error(`${what}: HTTP ${response.status}${body ? ` ${body}` : ""}`);
}

/** Sample rate and sample size of the raw audio kokoro returns. */
export const PCM_RATE = 24000;

/** Text to raw 16-bit mono PCM. Raw, because the service's WAV declares an unknown
 * length, and because pieces can then be joined with silence between them. */
export async function synthesize(text: string, key: string, config: VoiceConfig, doFetch: Fetch = fetch): Promise<Buffer> {
	const response = await doFetch(`${config.baseUrl}/audio/speech`, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model: config.ttsModel, input: text, voice: config.voice, speed: config.speed, response_format: "pcm" }),
		signal: AbortSignal.timeout(config.timeoutMs),
	});
	if (!response.ok) throw await failure("voice synthesis", response);
	const audio = Buffer.from(await response.arrayBuffer());
	if (audio.length < 64) throw new Error("voice synthesis: empty audio");
	return audio;
}

/** Pieces of speech joined by a pause, as one WAV file with an honest header. */
export function joinAsWav(pieces: Buffer[], pauseMs: number): Buffer {
	const silence = Buffer.alloc(Math.round((PCM_RATE * pauseMs) / 1000) * 2);
	const parts: Buffer[] = [];
	pieces.forEach((piece, index) => {
		if (index > 0) parts.push(silence);
		parts.push(piece);
	});
	const pcm = Buffer.concat(parts);
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20); // PCM
	header.writeUInt16LE(1, 22); // mono
	header.writeUInt32LE(PCM_RATE, 24);
	header.writeUInt32LE(PCM_RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

/** A recorded WAV file to text, in Spanish. */
export async function transcribe(audioFile: string, key: string, config: VoiceConfig, doFetch: Fetch = fetch): Promise<string> {
	const form = new FormData();
	form.append("model", config.sttModel);
	form.append("language", "es");
	form.append("file", new Blob([readFileSync(audioFile)], { type: "audio/wav" }), "dictado.wav");
	const response = await doFetch(`${config.baseUrl}/audio/transcriptions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}` },
		body: form,
		signal: AbortSignal.timeout(config.timeoutMs),
	});
	if (!response.ok) throw await failure("transcription", response);
	const text = ((await response.json()) as { text?: unknown })?.text;
	return typeof text === "string" ? text.trim() : "";
}
