/**
 * violeta-notify — the opt-in finish/dialog notification (T3/S3).
 *
 * `/notify on|off` (no argument toggles) persists the choice in violeta.json
 * under `notify` (default off, invalid values read as off). When on:
 * - when the agent settles after a run longer than 20 s, or
 * - when a confirmation dialog (violeta-guard) is waiting for the user,
 * it rings the terminal bell and, when `notify-send` exists, sends a desktop
 * notification titled `violeta` with a body in the active language. Errors
 * are swallowed; there is never a shell involved.
 *
 * The guard publishes its dialog state on the shared hub (`notifyNeedsAnswer`);
 * this extension subscribes but the guard never depends on it being loaded.
 * Subagent children (VIOLETA_AGENTS_CHILD=1) register nothing.
 */

import { execFile } from "node:child_process";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
	decideNotify,
	emitNotification,
	existsOnPath,
	shortPhrase,
} from "../src/notify/decision.ts";
import { readNotifyEnabled, writeNotifyEnabled } from "../src/notify-state.ts";
import { notify as t } from "../src/i18n.ts";
import { subscribeShared } from "../src/shared-hub.ts";

export default function (pi: ExtensionAPI) {
	// Children have no user waiting on a terminal or desktop.
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	let enabled = false;
	/** When the current agent run started (undefined while idle). */
	let runStartedAt: number | undefined;
	/** Whether the hub currently reports a waiting dialog. */
	let dialogWaiting = false;

	function fire(kind: "finished" | "needsAnswer", body: string): void {
		emitNotification(
			{
				bell: (data) => {
					process.stdout.write(data);
				},
				exists: existsOnPath,
				exec: (file, args) => {
					execFile(file, args, () => {
						/* swallow: the bell already rang */
					});
				},
			},
			body,
		);
		void kind;
	}

	function configFile(): string | undefined {
		const dir = process.env.PI_CODING_AGENT_DIR;
		return dir ? join(dir, "violeta.json") : undefined;
	}

	/** The last assistant text in the branch, for the `Terminó: <frase>` body. */
	function lastAssistantText(ctx: ExtensionContext): string | undefined {
		try {
			const branch = ctx.sessionManager.getBranch();
			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i];
				if (entry.type === "message" && (entry.message as AssistantMessage).role === "assistant") {
					const content = (entry.message as AssistantMessage).content;
					const text = content
						.filter((block): block is { type: "text"; text: string } => block.type === "text")
						.map((block) => block.text)
						.join("\n");
					if (text.trim() !== "") return text;
				}
			}
		} catch {
			/* a notification must never break the session */
		}
		return undefined;
	}

	pi.on("session_start", async (_event, ctx) => {
		const file = configFile();
		enabled = file ? readNotifyEnabled(file) : false;
		if (ctx.mode !== "tui") return;

		pi.registerCommand("notify", {
			description: t.description,
			handler: async (args: string, commandCtx: ExtensionContext) => {
				const arg = args.trim().toLowerCase();
				if (arg && arg !== "on" && arg !== "off") {
					commandCtx.ui.notify(t.usage, "warning");
					return;
				}
				enabled = arg === "on" ? true : arg === "off" ? false : !enabled;
				const path = configFile();
				if (path) writeNotifyEnabled(path, enabled);
				commandCtx.ui.notify(enabled ? t.enabled : t.disabled, "info");
			},
		});
	});

	pi.on("agent_start", async () => {
		runStartedAt = Date.now();
	});

	// agent_settled is the notification-only point after Pi has no automatic
	// continuation left (the documented use, matching S3's "on settle").
	pi.on("agent_settled", async (_event, ctx) => {
		const duration = runStartedAt !== undefined ? Date.now() - runStartedAt : 0;
		runStartedAt = undefined;
		const decision = decideNotify({ enabled, dialogWaiting, runDurationMs: duration });
		if (decision === "finished") {
			fire("finished", t.finished(shortPhrase(lastAssistantText(ctx))));
		}
	});

	// The guard flips notifyNeedsAnswer around its confirmation dialogs.
	subscribeShared((state) => {
		const waiting = state.notifyNeedsAnswer === true;
		if (waiting === dialogWaiting) return;
		dialogWaiting = waiting;
		if (waiting) {
			const decision = decideNotify({ enabled, dialogWaiting: true, runDurationMs: 0 });
			if (decision === "needsAnswer") fire("needsAnswer", t.needsAnswer);
		}
	});
}
