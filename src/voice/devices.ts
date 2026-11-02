/** Playback and recording through programs already on the machine, spawned with
 * an argument list (never a shell). Every failure is reported, none thrown. */

import { spawn, type ChildProcess } from "node:child_process";
import { delimiter, join } from "node:path";
import { accessSync, constants } from "node:fs";

export function onPath(command: string, pathVar: string | undefined = process.env.PATH): boolean {
	for (const dir of (pathVar ?? "").split(delimiter)) {
		if (!dir) continue;
		try {
			accessSync(join(dir, command), constants.X_OK);
			return true;
		} catch {
			// next directory
		}
	}
	return false;
}

export type Tool = { command: string; args: string[] };

/** First available player for a WAV file. */
export function pickPlayer(file: string, exists: (c: string) => boolean = onPath): Tool | undefined {
	if (exists("pw-play")) return { command: "pw-play", args: [file] };
	if (exists("aplay")) return { command: "aplay", args: ["-q", file] };
	return undefined;
}

/** First available recorder: 16 kHz mono WAV, which is what Whisper wants. */
export function pickRecorder(file: string, exists: (c: string) => boolean = onPath): Tool | undefined {
	if (exists("pw-record")) return { command: "pw-record", args: ["--rate", "16000", "--channels", "1", file] };
	if (exists("arecord")) return { command: "arecord", args: ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", file] };
	return undefined;
}

export interface Running {
	/** Ends it. A recorder gets SIGINT so the WAV header is finalized. */
	stop(): Promise<void>;
	done: Promise<void>;
}

export function run(tool: Tool, onError: (message: string) => void): Running {
	let child: ChildProcess | undefined;
	let finished = false;
	const done = new Promise<void>((resolve) => {
		try {
			child = spawn(tool.command, tool.args, { stdio: "ignore" });
		} catch (error) {
			onError(String((error as Error).message));
			finished = true;
			resolve();
			return;
		}
		child.once("error", (error) => {
			onError(error.message);
			finished = true;
			resolve();
		});
		child.once("close", () => {
			finished = true;
			resolve();
		});
	});
	return {
		done,
		async stop() {
			if (!finished && child) child.kill("SIGINT");
			await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 2000))]);
			if (!finished && child) child.kill("SIGKILL");
		},
	};
}
