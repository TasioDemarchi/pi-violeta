/**
 * violeta-mode — the philosophy switch (`/mode`).
 *
 * violeta's engine is neutral by design; this is the one place a philosophy
 * enters, and it enters as data. A mode is a markdown file in
 * `${PI_CODING_AGENT_DIR}/modes/*.md` whose body is appended to the main
 * session's system prompt, plus the model it wants and the agents it exposes.
 *
 * - `/mode` with no argument reports the active mode and the catalogue.
 * - `/mode <name>` switches, persists the choice in `violeta.json`, switches
 *   the session model when the mode names one, and publishes the mode on the
 *   shared hub so violeta-ui can show it and violeta-agents can filter by it.
 *
 * The prompt is appended through `systemPromptOptions.appendSystemPrompt` on
 * `before_agent_start`, never by replacing `systemPrompt`: replacing it would
 * drop Pi's own tool and environment sections. Appending at the end also keeps
 * the cached prefix stable, so switching modes costs one cache miss, not one
 * per turn.
 *
 * Children (`VIOLETA_AGENTS_CHILD=1`) never load this: a subagent's philosophy
 * is its own definition, and a child inheriting the parent's mode would both
 * double the prompt and let a mode silently rewrite every agent.
 */

import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { findMode, listModes, RAW_MODE, type ModeDefinition } from "../src/modes/definitions.ts";
import { DEFAULT_MODE, readActiveMode, writeActiveMode } from "../src/modes/state.ts";
import { setShared } from "../src/shared-hub.ts";
import { modes as t } from "../src/i18n.ts";

const MODES_DIR = "modes";

export default function (pi: ExtensionAPI) {
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	let active: ModeDefinition = RAW_MODE;

	const agentDir = (): string | undefined => process.env.PI_CODING_AGENT_DIR;
	const configFile = (): string | undefined => {
		const dir = agentDir();
		return dir ? join(dir, "violeta.json") : undefined;
	};
	const catalogue = (): { modes: ModeDefinition[]; errors: ReturnType<typeof listModes>["errors"] } => {
		const dir = agentDir();
		return dir ? listModes(join(dir, MODES_DIR)) : { modes: [RAW_MODE], errors: [] };
	};

	/** Publish the active mode so the other extensions can read it without
	 * importing this one: they load as separate module instances. */
	const publish = (mode: ModeDefinition): void => {
		active = mode;
		setShared({ activeMode: mode.name, modeAgents: mode.agents });
	};

	/** Switch the session model when the mode names one. A missing model is
	 * reported and never fatal: a philosophy must still run when its preferred
	 * model is unavailable, just on whatever is configured. */
	const applyModel = async (mode: ModeDefinition, ctx: ExtensionContext, announce: boolean): Promise<void> => {
		if (!mode.model) return;
		const [provider, ...rest] = mode.model.split("/");
		const id = rest.join("/");
		if (!provider || !id) return;
		if (ctx.model?.provider === provider && ctx.model?.id === id) return;
		const found = ctx.modelRegistry.getAvailable().find((m) => m.provider === provider && m.id === id);
		if (!found) {
			if (announce) ctx.ui.notify(t.modelMissing(mode.model), "warning");
			return;
		}
		const ok = await pi.setModel(found);
		if (announce && ok) ctx.ui.notify(t.modelSwitched(mode.model), "info");
	};

	pi.on("session_start", async (_event, ctx) => {
		const { modes, errors } = catalogue();
		// A mode file that fails to parse is never swallowed: a session that
		// quietly runs unguided is worse than one that says what broke.
		for (const error of errors) ctx.ui.notify(t.loadError(error.source, error.message), "warning");
		const file = configFile();
		const wanted = file ? readActiveMode(file) : DEFAULT_MODE;
		publish(findMode(modes, wanted) ?? findMode(modes, DEFAULT_MODE) ?? RAW_MODE);
		await applyModel(active, ctx, false);
	});

	pi.on("before_agent_start", (event) => {
		if (!active.prompt) return;
		const existing = event.systemPromptOptions.appendSystemPrompt;
		event.systemPromptOptions.appendSystemPrompt = existing ? `${existing}\n\n${active.prompt}` : active.prompt;
	});

	pi.registerCommand("mode", {
		description: t.description,
		handler: async (args: string, ctx: ExtensionContext) => {
			const { modes, errors } = catalogue();
			for (const error of errors) ctx.ui.notify(t.loadError(error.source, error.message), "warning");
			const names = modes.map((mode) => mode.name);
			const wanted = args.trim();
			if (!wanted) {
				ctx.ui.notify(t.current(active.name, active.description), "info");
				ctx.ui.notify(t.available(names), "info");
				return;
			}
			const mode = findMode(modes, wanted);
			if (!mode) {
				ctx.ui.notify(t.unknown(wanted, names), "warning");
				return;
			}
			publish(mode);
			const file = configFile();
			if (file) writeActiveMode(file, mode.name);
			ctx.ui.notify(t.switched(mode.name, mode.description), "info");
			if (mode.agents?.length === 0) ctx.ui.notify(t.agentsHidden(mode.name), "info");
			await applyModel(mode, ctx, true);
		},
	});
}
