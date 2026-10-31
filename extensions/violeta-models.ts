/**
 * violeta-models — the quick model selector (T3/S4).
 *
 * `alt+m` and `/models` open a small overlay listing the models whose
 * provider has auth available (ctx.modelRegistry), as `provider/id` with the
 * context window, the current one marked. j/k (and arrows) move, Enter
 * switches the session model with pi.setModel, esc/q close. After a switch
 * the footer/sidebar pick the new model up on their next render (ctx.model
 * is a live getter) and a notification confirms in the active language.
 * Subagent children (VIOLETA_AGENTS_CHILD=1) register nothing.
 */

import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { matchesKey } from "@earendil-works/pi-tui";
import type { Model } from "@earendil-works/pi-ai";
import {
	initialModelsState,
	modelRows,
	reduceModels,
	renderModelsOverlay,
	type ModelCandidate,
	type ModelsAction,
	type ViewFg,
} from "../src/models-view/view.ts";
import { models as t } from "../src/i18n.ts";

export default function (pi: ExtensionAPI) {
	if (process.env.VIOLETA_AGENTS_CHILD === "1") return;

	const openModels = async (ctx: ExtensionContext): Promise<void> => {
		if (ctx.mode !== "tui" || !ctx.hasUI) {
			ctx.ui.notify(t.overlayNeedsTui, "warning");
			return;
		}
		// Only models with auth available (S4): the registry's available
		// snapshot, double-checked against the provider's configured auth.
		const available: Model[] = ctx.modelRegistry.getAvailable();
		const usable = available.filter((model) => {
			try {
				return ctx.modelRegistry.hasConfiguredAuth(model);
			} catch {
				return false;
			}
		});
		const candidates: ModelCandidate[] = usable.map((model) => ({
			provider: model.provider,
			id: model.id,
			contextWindow: model.contextWindow,
			authAvailable: true,
		}));
		const rows = modelRows(candidates, ctx.model?.provider, ctx.model?.id);

		await ctx.ui.custom<void>(
			(tui, theme, _keybindings, done) => {
				let state = initialModelsState(rows.length);
				const fg: ViewFg = (role, text) => theme.fg(role as ThemeColor, text);
				const component: Component = {
					invalidate() {},
					render(width: number): string[] {
						try {
							return renderModelsOverlay(rows, state, width, fg);
						} catch {
							return [];
						}
					},
					handleInput(data: string): void {
						const action: ModelsAction | undefined =
							matchesKey(data, "up") || data === "k" ? "up"
							: matchesKey(data, "down") || data === "j" ? "down"
							: matchesKey(data, "enter") ? "select"
							: matchesKey(data, "escape") || matchesKey(data, "esc") || data === "q" ? "close"
							: undefined;
						if (!action) return;
						const next = reduceModels(state, action, rows.length);
						if (next.closed && action === "select" && next.chosen !== undefined) {
							const row = rows[next.chosen];
							const model = usable[next.chosen];
							done();
							void (async () => {
								try {
									const ok = row && model ? await pi.setModel(model) : false;
									if (ok && row) {
										ctx.ui.notify(t.switched(`${row.provider}/${row.id}`), "info");
									} else if (row) {
										ctx.ui.notify(t.switchFailed(`${row.provider}/${row.id}`), "warning");
									}
								} catch {
									/* the model stays as it was */
								}
								// ctx.model is a live getter: one frame repaints the
								// footer and the sidebar with the new id.
								tui.requestRender();
							})();
							return;
						}
						state = next;
						if (state.closed) {
							done();
							return;
						}
						tui.requestRender();
					},
				};
				return component;
			},
			{ overlay: true, overlayOptions: { anchor: "center" } },
		);
	};

	pi.registerCommand("models", {
		description: t.description,
		handler: async (_args: string, ctx: ExtensionContext) => openModels(ctx),
	});

	pi.registerShortcut("alt+m", {
		description: t.shortcut,
		handler: async (ctx) => openModels(ctx),
	});
}
