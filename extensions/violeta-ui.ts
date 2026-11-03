import { basename, join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { type ChangeFiles, readChangesFiles } from "../src/changes.ts";
import { activityLine, phaseForTool } from "../src/activity.ts";
import { contextRole, createCompactWarner } from "../src/context-warning.ts";
import { modelWithThinking } from "../src/thinking.ts";
import { fmtCost, fmtPercent, fmtTokens } from "../src/format.ts";
import { buildSidebarLines, type SidebarData } from "../src/sidebar-content.ts";
import { readSidebarEnabled, writeSidebarEnabled } from "../src/sidebar-state.ts";
import { readLanguage, writeLanguage } from "../src/language-state.ts";
import { renderBtwPanel } from "../src/btw/panel.ts";
import { getShared, setShared } from "../src/shared-hub.ts";
import { activity as activityT, context as contextT, sidebar as t, ui as uiT } from "../src/i18n.ts";
import { getLanguage, setLanguage, type Language } from "../src/i18n.ts";

const SEP = "  ";
const SIDEBAR_WIDTH = 44;
const SIDEBAR_GAP = 2;
// Below this the sidebar falls back to the footer automatically.
const SIDEBAR_MIN_COLS = 100;
// Pi 1.4.0 fullscreen layout internals (same technique gentle-shell uses).
const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");
type LayoutNode = { type: string; entries?: unknown[]; gap?: number; align?: string };
type LayoutRoot = Component & { [NODE]?: () => LayoutNode };
type SidebarTui = TUI & { layoutRoot?: LayoutRoot };

export default function (pi: ExtensionAPI) {
	// undefined = not read yet, null = not a git repository
	let changes: ChangeFiles | null | undefined;
	let requestRender: (() => void) | undefined;
	let refreshing = false;
	let uiCtx: ExtensionContext | undefined;
	let branchOf: (() => string | undefined) | undefined;
	let tuiRef: TUI | undefined;
	let sidebarComponent: Component | undefined;
	/** Header lines, drawn by the pinned layout in fullscreen and by Pi's own
	 * (scrolling) header container everywhere else. */
	let headerLines: ((width: number) => string[]) | undefined;
	let layoutPinned = false;
	let sidebarEnabled = false;
	/** Last sidebar-active value published to the shared hub. */
	let sharedActive: boolean | undefined;
	const sidebarCleanups: Array<() => void> = [];

	// --- Activity line: `▍ <phase>` with three dots appearing/disappearing above the editor ---
	const ACTIVITY_KEY = "activity";
	const ACTIVITY_INTERVAL_MS = 400;
	let activityPhase: string | null = null;
	let activityTick = 0;
	let activityTimer: ReturnType<typeof setInterval> | undefined;
	let activityWidget: (Component & { dispose?(): void }) | undefined;
	let workingHidden = false;

	function showActivity() {
		if (!uiCtx) return;
		uiCtx.ui.setWidget(
			ACTIVITY_KEY,
			(tui, theme) => {
				tuiRef ??= tui;
				const component: Component & { dispose?(): void } = {
					invalidate() {},
					dispose() {
						if (activityWidget === component) activityWidget = undefined;
					},
					render: () => [
						activityLine(activityPhase ?? activityT.phases.thinking, activityTick, (role, text) => theme.fg(role as ThemeColor, text)),
					],
				};
				activityWidget = component;
				return component;
			},
			{ placement: "aboveEditor" },
		);
	}

	function startActivity() {
		if (!activityTimer) {
			activityTimer = setInterval(() => {
				activityTick++;
				activityWidget?.invalidate();
				tuiRef?.requestRender();
			}, ACTIVITY_INTERVAL_MS);
			activityTimer.unref();
		}
		// Pi's native Working spinner row would duplicate the activity line.
		if (!workingHidden) {
			uiCtx?.ui.setWorkingVisible(false);
			workingHidden = true;
		}
	}

	function hideActivity() {
		if (activityTimer) {
			clearInterval(activityTimer);
			activityTimer = undefined;
		}
		activityTick = 0;
		activityPhase = null;
		activityWidget = undefined;
		uiCtx?.ui.setWidget(ACTIVITY_KEY, undefined);
		if (workingHidden) {
			uiCtx?.ui.setWorkingVisible(true);
			workingHidden = false;
		}
	}

	const inTui = (ctx: ExtensionContext) => ctx.mode === "tui";

	pi.on("agent_start", async (_event, ctx) => {
		if (!inTui(ctx) || !uiCtx) return;
		activityPhase = activityT.phases.thinking;
		startActivity();
		showActivity();
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		if (!inTui(ctx) || !uiCtx) return;
		activityPhase = phaseForTool(event.toolName, event.args);
		startActivity();
		showActivity();
	});

	// agent_end is not a final-idle signal (continuations can restart); settle is.
	pi.on("agent_settled", async (_event, ctx) => {
		if (inTui(ctx)) hideActivity();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (inTui(ctx)) hideActivity();
	});

	function configFile(): string | undefined {
		const dir = process.env.PI_CODING_AGENT_DIR;
		return dir ? join(dir, "violeta.json") : undefined;
	}

	// The sidebar is "active" (footer hidden) only when enabled and there is room for it.
	function sidebarActive(tui?: TUI): boolean {
		return sidebarEnabled && !!tui && tui.mode === "fullscreen" && tui.terminal.columns >= SIDEBAR_MIN_COLS;
	}

	// Fullscreen only: Pi draws the header inside the scrolling transcript, so it
	// leaves the screen with the conversation. We wrap the layout root so the
	// header sits above everything and never scrolls; with the sidebar on, the
	// sidebar still gets the full height beside it. Outside fullscreen the header
	// lives in the terminal's own scrollback and cannot be pinned.
	const pinnedHeader: Component = {
		render: (width: number) => headerLines?.(width) ?? [],
		invalidate() {},
	};

	function removeLayout() {
		for (const cleanup of sidebarCleanups.splice(0).reverse()) cleanup();
		layoutPinned = false;
	}

	function installLayout() {
		const tui = tuiRef as SidebarTui | undefined;
		if (!tui || sidebarCleanups.length) return;
		const wrappedRoots = new WeakSet<object>();
		try {
			const attach = () => {
				try {
					const root = tui.layoutRoot;
					if (!root || typeof root[NODE] !== "function" || wrappedRoots.has(root)) return;
					wrappedRoots.add(root);
					const original = root[NODE]!;
					const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
					const body: Component & { [NODE]: () => LayoutNode } = {
						render: () => [],
						invalidate() {},
						[NODE]: () => original.call(root),
					};
					const column: Component & { [NODE]: () => LayoutNode } = {
						render: () => [],
						invalidate() {},
						[NODE]: () => ({
							type: "vstack",
							// The engine does arithmetic with `gap`: leaving it out turns every
							// size into NaN and the transcript and editor collapse to nothing.
							gap: 0,
							align: "stretch" as const,
							entries: [
								{ component: pinnedHeader, basis: "auto", grow: 0, shrink: 0, minSize: 1 },
								{ component: body, basis: 0, grow: 1, shrink: 1, minSize: 1 },
							],
						}),
					};
					const wrapped = (): LayoutNode => {
						if (tui.mode !== "fullscreen") return original.call(root);
						if (!sidebarActive(tui) || !sidebarComponent) return column[NODE]();
						return {
							type: "hstack",
							gap: SIDEBAR_GAP,
							align: "stretch" as const,
							entries: [
								{ component: column, basis: 0, grow: 1, shrink: 1, minSize: 1 },
								{ component: sidebarComponent, basis: SIDEBAR_WIDTH, grow: 0, shrink: 0, minSize: SIDEBAR_WIDTH },
							],
						};
					};
					root[NODE] = wrapped;
					layoutPinned = true;
					tui.requestRender();
					sidebarCleanups.push(() => {
						if (root[NODE] !== wrapped) return;
						if (descriptor) Object.defineProperty(root, NODE, descriptor);
						else Reflect.deleteProperty(root, NODE);
					});
				} catch {
					/* never crash: the header just scrolls as Pi draws it */
				}
			};
			attach();
			// Pi can swap the layout root without a session event; rebind only that transition.
			const timer = setInterval(attach, 100);
			timer.unref();
			sidebarCleanups.push(() => clearInterval(timer));
			tui.requestRender();
		} catch {
			/* fall back to the scrolling header and the footer */
		}
	}

	async function refresh(cwd: string) {
		if (refreshing) return;
		refreshing = true;
		try {
			changes = await readChangesFiles(cwd);
			requestRender?.();
		} finally {
			refreshing = false;
		}
	}

	function sessionUsage(): { input: number; output: number; cost: number } {
		const ctx = uiCtx;
		if (!ctx) return { input: 0, output: 0, cost: 0 };
		let input = 0;
		let output = 0;
		let cost = 0;
		for (const e of ctx.sessionManager.getBranch()) {
			if (e.type === "message" && e.message.role === "assistant") {
				const u = (e.message as AssistantMessage).usage;
				input += u.input;
				output += u.output;
				cost += u.cost.total;
			}
		}
		return { input, output, cost };
	}

	// Context warning (S5): one hysteresis warner per session, shared by
	// the footer and the sidebar renders (exactly one fires per crossing).
	// VIOLETA_TEST_CTX_PERCENT is a validation-only hook that forces the
	// percent both surfaces see; unset in every real session, so production
	// behavior is unchanged.
	const effectivePercent = (percent: number | null | undefined): number | null | undefined => {
		const raw = process.env.VIOLETA_TEST_CTX_PERCENT;
		if (raw === undefined || percent == null) return percent;
		const forced = Number.parseFloat(raw);
		return Number.isFinite(forced) ? forced : percent;
	};
	const compactWarner = createCompactWarner();
	const warnCompact = (percent: number | null | undefined): void => {
		if (!compactWarner.check(percent)) return;
		const timer = setTimeout(() => {
			uiCtx?.ui.notify(contextT.compactSuggest, "info");
		}, 0);
		timer.unref?.();
	};

	function collectSidebarData(): SidebarData {
		const ctx = uiCtx!;
		const usage = ctx.getContextUsage();
		const s = sessionUsage();
		// The todo list comes from the shared hub (violeta-todo publishes it); the
		// TAREAS section is drawn only when the card would be visible.
		const shared = getShared();
		return {
			project: { name: basename(ctx.cwd), path: ctx.cwd, branch: branchOf?.() ?? null },
			changes: changes ?? null,
			todos: shared.todoVisible !== false && shared.todoState ? shared.todoState : null,
			now: Date.now(),
			model: {
				id: ctx.model && ctx.model.id !== "unknown" ? ctx.model.id : undefined,
				thinking: pi.getThinkingLevel(),
				context: usage ? { percent: effectivePercent(usage.percent), used: usage.tokens ?? 0, window: usage.contextWindow } : null,
			},
			usage: { tokensIn: s.input, tokensOut: s.output, cost: s.cost },
		};
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		uiCtx = ctx;
		ctx.ui.setTitle(`violeta · ${basename(ctx.cwd)}`);

		const cfg = configFile();
		// The persisted language is honored everywhere — including subagent
		// children, which load this extension too — before any text is rendered
		// or registered for the session (S3).
		setLanguage(cfg ? readLanguage(cfg) : "es");
		sidebarEnabled = cfg ? readSidebarEnabled(cfg) : false;

		// /language: switch es|en, no argument toggles. Children
		// have no UI of their own, so they honor the persisted language but do
		// not register the command.
		if (process.env.VIOLETA_AGENTS_CHILD !== "1") {
			const language = async (args: string, commandCtx: ExtensionContext) => {
				const arg = args.trim().toLowerCase();
				let next: Language | undefined;
				if (arg === "") next = getLanguage() === "es" ? "en" : "es";
				else if (arg === "es" || arg === "en") next = arg;
				if (!next) {
					commandCtx.ui.notify(uiT.languageUsage, "warning");
					return;
				}
				setLanguage(next);
				const file = configFile();
				if (file) writeLanguage(file, next);
				// The notification is shown in the NEW language, and a render
				// makes cards, sidebar, footer and overlays repaint at once.
				commandCtx.ui.notify(uiT.languageSet, "info");
				tuiRef?.requestRender();
			};
			pi.registerCommand("language", { description: uiT.languageDescription, handler: language });
		}

		pi.registerCommand("sidebar", {
			description: uiT.sidebarDescription,
			handler: async (args: string) => {
				const arg = args.trim().toLowerCase();
				if (arg && arg !== "on" && arg !== "off" && arg !== "toggle") {
					ctx.ui.notify(uiT.sidebarUsage, "warning");
					return;
				}
				sidebarEnabled = arg === "on" ? true : arg === "off" ? false : !sidebarEnabled;
				const file = configFile();
				if (file) writeSidebarEnabled(file, sidebarEnabled);
				if (sidebarEnabled && tuiRef && tuiRef.mode !== "fullscreen") {
					ctx.ui.notify(uiT.sidebarNeedsFullscreen, "warning");
				}
				tuiRef?.requestRender();
			},
		});

		ctx.ui.setHeader((_tui, theme) => {
			// The active mode is always on screen: a philosophy you cannot see is one
			// you cannot trust, and knowing which one is running is the difference
			// between a surprising answer and an expected one.
			const lines = (width: number): string[] => {
				const mode = getShared().activeMode;
				return [
					theme.fg("borderAccent", "▍") +
						" " +
						theme.bold(theme.fg("accent", "violeta")) +
						theme.fg("dim", ` · pi ${VERSION}`) +
						(mode ? theme.fg("accent", ` · ${mode}`) : "") +
						(getShared().unattended ? theme.fg("warning", ` · ${uiT.unattendedLabel}`) : ""),
					// A rule under the header, in the faintest border color: without it
					// the title line and the first line of the conversation read as one
					// block. Full width so it reads as the edge of a region, not as text.
					theme.fg("borderMuted", "─".repeat(Math.max(1, width))),
				];
			};
			headerLines = lines;
			return {
				invalidate() {},
				// Pinned: the layout draws it above the transcript; drawing it here too
				// would show it twice.
				render: (width: number) => (layoutPinned && tuiRef?.mode === "fullscreen" ? [] : lines(width)),
			};
		});

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsub = footerData.onBranchChange(() => {
				void refresh(ctx.cwd);
				tui.requestRender();
			});
			void refresh(ctx.cwd);
			branchOf = () => footerData.getGitBranch();
			tuiRef = tui;

			sidebarComponent = {
				invalidate() {},
				render(width: number): string[] {
					try {
						const data = collectSidebarData();
						// The sidebar owns the ctx line while the footer hides.
						warnCompact(data.model.context?.percent ?? null);
						const fg = (role: string, text: string) => theme.fg(role as ThemeColor, text);
						// While the side chat is open the sidebar IS the chat: the
						// framed panel takes the whole column, and PROYECTO/CAMBIOS/
						// MODELO come back the moment it closes. violeta-btw owns the
						// state; drawing it here is what "the sidebar becomes a chat"
						// means, and its own widget above the editor stays empty.
						const side = getShared().btw;
						if (side?.open === true) return renderBtwPanel(side, { width, rows: tui.terminal.rows }, fg);
						return buildSidebarLines(data, { width, rows: tui.terminal.rows }, fg);
					} catch (error) {
						// Never draw an empty panel: show the failure so it can be reported.
						const message = error instanceof Error ? error.message : String(error);
						return [truncateToWidth(theme.fg("error", `sidebar: ${message}`), width)];
					}
				},
			};
			installLayout();

			return {
				dispose() {
					unsub();
					requestRender = undefined;
					removeLayout();
					if (sharedActive !== false) {
						sharedActive = false;
						setShared({ sidebarActive: false });
					}
				},
				invalidate() {},
				render(width: number): string[] {
					// Publish the placement flag for violeta-todo (and any other
					// listener) whenever it changes; the footer renders on every
					// frame, so /sidebar toggles, resizes and fullscreen changes
					// all re-evaluate the placement live.
					const active = sidebarActive(tui);
					if (active !== sharedActive) {
						sharedActive = active;
						setShared({ sidebarActive: active });
					}
					// The sidebar owns the right edge; the footer paints nothing while it is active.
					if (active) return [];

					const s = sessionUsage();
					const input = s.input;
					const output = s.output;
					const cost = s.cost;

					const branch = footerData.getGitBranch();
					const left: string[] = [theme.fg("accent", basename(ctx.cwd))];
					if (branch) left.push(theme.fg("muted", branch));
					if (changes === null) {
						left.push(theme.fg("dim", t.noRepo));
					} else if (changes) {
						const parts: string[] = [];
						if (changes.created.length) parts.push(theme.fg("success", `+${changes.created.length}`));
						if (changes.updated.length) parts.push(theme.fg("warning", `~${changes.updated.length}`));
						if (changes.deleted.length) parts.push(theme.fg("error", `−${changes.deleted.length}`));
						left.push(parts.length ? parts.join(" ") : theme.fg("dim", t.clean));
					}

					const usage = ctx.getContextUsage();
					const modelId = ctx.model && ctx.model.id !== "unknown" ? ctx.model.id : undefined;
					const right: string[] = [modelWithThinking(modelId, pi.getThinkingLevel(), (role, text) => theme.fg(role as ThemeColor, text), t.noModel)];
					if (usage?.percent != null) {
						const percent = effectivePercent(usage.percent) ?? usage.percent;
						warnCompact(percent);
						// The color follows the S5 thresholds: muted, warning, error.
						right.push(theme.fg(contextRole(percent), `ctx ${fmtPercent(percent / 100)}`));
					}
					right.push(theme.fg("dim", `↑${fmtTokens(input)} ↓${fmtTokens(output)}`));
					right.push(theme.fg("muted", fmtCost(cost)));

					const l = left.join(SEP);
					const r = right.join(SEP);
					const gap = Math.max(1, width - visibleWidth(l) - visibleWidth(r));
					return [truncateToWidth(l + " ".repeat(gap) + r, width)];
				},
			};
		});
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		void refresh(ctx.cwd);
	});
	pi.on("agent_end", async (_event, ctx) => {
		void refresh(ctx.cwd);
	});
}
