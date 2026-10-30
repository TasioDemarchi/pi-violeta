import { basename, join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { type ChangeFiles, readChangesFiles } from "../src/changes.ts";
import { activityLine, phaseForTool } from "../src/activity.ts";
import { fmtCost, fmtPercent, fmtTokens } from "../src/format.ts";
import { buildSidebarLines, type SidebarData } from "../src/sidebar-content.ts";
import { readSidebarEnabled, writeSidebarEnabled } from "../src/sidebar-state.ts";

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
	let sidebarEnabled = false;
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
						activityLine(activityPhase ?? "thinking", activityTick, (role, text) => theme.fg(role as ThemeColor, text)),
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
		activityPhase = "thinking";
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

	function applySidebar(active: boolean) {
		const tui = tuiRef as SidebarTui | undefined;
		if (!tui) return;
		if (!active) {
			for (const cleanup of sidebarCleanups.splice(0).reverse()) cleanup();
			return;
		}
		if (sidebarCleanups.length || !sidebarComponent) return;
		const wrappedRoots = new WeakSet<object>();
		try {
			const attach = () => {
				try {
					const root = tui.layoutRoot;
					if (!root || typeof root[NODE] !== "function" || wrappedRoots.has(root)) return;
					wrappedRoots.add(root);
					const original = root[NODE]!;
					const descriptor = Object.getOwnPropertyDescriptor(root, NODE);
					const left: Component & { [NODE]: () => LayoutNode } = {
						render: () => [],
						invalidate() {},
						[NODE]: () => original.call(root),
					};
					const replacement = () => ({
						type: "hstack",
						gap: SIDEBAR_GAP,
						align: "stretch" as const,
						entries: [
							{ component: left, basis: 0, grow: 1, shrink: 1, minSize: 1 },
							{ component: sidebarComponent!, basis: SIDEBAR_WIDTH, grow: 0, shrink: 0, minSize: SIDEBAR_WIDTH },
						],
					});
					const wrapped = (): LayoutNode =>
						tui.terminal.columns >= SIDEBAR_MIN_COLS ? replacement() : original.call(root);
					root[NODE] = wrapped;
					tui.requestRender();
					sidebarCleanups.push(() => {
						if (root[NODE] !== wrapped) return;
						if (descriptor) Object.defineProperty(root, NODE, descriptor);
						else Reflect.deleteProperty(root, NODE);
					});
				} catch {
					/* never crash: fall back to the footer */
				}
			};
			attach();
			// Pi can swap the layout root without a session event; rebind only that transition.
			const timer = setInterval(attach, 100);
			timer.unref();
			sidebarCleanups.push(() => clearInterval(timer));
			tui.requestRender();
		} catch {
			/* fall back to the footer */
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

	function collectSidebarData(): SidebarData {
		const ctx = uiCtx!;
		const usage = ctx.getContextUsage();
		const s = sessionUsage();
		return {
			project: { name: basename(ctx.cwd), path: ctx.cwd, branch: branchOf?.() ?? null },
			changes: changes ?? null,
			model: {
				id: ctx.model && ctx.model.id !== "unknown" ? ctx.model.id : undefined,
				thinking: pi.getThinkingLevel(),
				context: usage ? { percent: usage.percent, used: usage.tokens ?? 0, window: usage.contextWindow } : null,
			},
			usage: { tokensIn: s.input, tokensOut: s.output, cost: s.cost },
		};
	}

	pi.on("session_start", async (_event, ctx: ExtensionContext) => {
		if (ctx.mode !== "tui") return;
		uiCtx = ctx;
		ctx.ui.setTitle(`violeta · ${basename(ctx.cwd)}`);

		const cfg = configFile();
		sidebarEnabled = cfg ? readSidebarEnabled(cfg) : false;

		pi.registerCommand("sidebar", {
			description: "Toggle the right sidebar (the footer hides while it is active)",
			handler: async (args: string) => {
				const arg = args.trim().toLowerCase();
				if (arg && arg !== "on" && arg !== "off" && arg !== "toggle") {
					ctx.ui.notify("usage: /sidebar [on|off]", "warning");
					return;
				}
				sidebarEnabled = arg === "on" ? true : arg === "off" ? false : !sidebarEnabled;
				const file = configFile();
				if (file) writeSidebarEnabled(file, sidebarEnabled);
				if (sidebarEnabled && tuiRef && tuiRef.mode !== "fullscreen") {
					ctx.ui.notify("Sidebar needs fullscreen mode; showing the footer instead.", "warning");
				}
				applySidebar(sidebarEnabled);
				tuiRef?.requestRender();
			},
		});

		ctx.ui.setHeader((_tui, theme) => ({
			invalidate() {},
			render: () => [theme.fg("borderAccent", "▍") + " " + theme.bold(theme.fg("accent", "violeta")) + theme.fg("dim", ` · pi ${VERSION}`)],
		}));

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
						return buildSidebarLines(collectSidebarData(), { width, rows: tui.terminal.rows }, (role, text) =>
							theme.fg(role as ThemeColor, text),
						);
					} catch {
						return [];
					}
				},
			};
			if (sidebarEnabled) applySidebar(true);

			return {
				dispose() {
					unsub();
					requestRender = undefined;
					applySidebar(false);
				},
				invalidate() {},
				render(width: number): string[] {
					// The sidebar owns the right edge; the footer paints nothing while it is active.
					if (sidebarActive(tui)) return [];

					const s = sessionUsage();
					const input = s.input;
					const output = s.output;
					const cost = s.cost;

					const branch = footerData.getGitBranch();
					const left: string[] = [theme.fg("accent", basename(ctx.cwd))];
					if (branch) left.push(theme.fg("muted", branch));
					if (changes === null) {
						left.push(theme.fg("dim", "no repo"));
					} else if (changes) {
						const parts: string[] = [];
						if (changes.created.length) parts.push(theme.fg("success", `+${changes.created.length}`));
						if (changes.updated.length) parts.push(theme.fg("warning", `~${changes.updated.length}`));
						if (changes.deleted.length) parts.push(theme.fg("error", `−${changes.deleted.length}`));
						left.push(parts.length ? parts.join(" ") : theme.fg("dim", "clean"));
					}

					const usage = ctx.getContextUsage();
					const modelId = ctx.model && ctx.model.id !== "unknown" ? ctx.model.id : undefined;
					const right: string[] = [modelId ? theme.fg("text", modelId) : theme.fg("dim", "no model")];
					if (usage?.percent != null) right.push(theme.fg("muted", `ctx ${fmtPercent(usage.percent / 100)}`));
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
