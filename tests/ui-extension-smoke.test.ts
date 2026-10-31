// Loads the real violeta-ui extension against a fake Pi and renders the
// sidebar. Guards against render-time errors (an out-of-scope helper once made
// the sidebar draw empty, swallowed by its try/catch) that unit tests of the
// pure modules cannot see.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-ui.ts";
import { setLanguage } from "../src/i18n.ts";

const NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

type Handler = (event: unknown, ctx: unknown) => unknown;

function setup(sidebar: boolean) {
	const dir = mkdtempSync(join(tmpdir(), "violeta-ui-smoke-"));
	writeFileSync(join(dir, "violeta.json"), JSON.stringify({ sidebar, language: "es" }));
	process.env.PI_CODING_AGENT_DIR = dir;
	delete process.env.VIOLETA_AGENTS_CHILD;

	const handlers = new Map<string, Handler[]>();
	const pi = {
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
		registerCommand: () => {},
		registerShortcut: () => {},
		registerTool: () => {},
		getThinkingLevel: () => "medium",
	};

	let footerFactory: ((tui: unknown, theme: unknown, data: unknown) => { render(w: number): string[] }) | undefined;
	const ctx = {
		cwd: process.cwd(),
		mode: "tui",
		model: { id: "nan/test-model", provider: "nan" },
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({ percent: 42, tokens: 4200, contextWindow: 10000 }),
		ui: {
			setTitle: () => {},
			setHeader: () => {},
			setWidget: () => {},
			setWorkingVisible: () => {},
			notify: () => {},
			setFooter: (factory: typeof footerFactory) => {
				footerFactory = factory;
			},
		},
	};

	const root: Record<symbol, unknown> = { render: () => [], invalidate() {} };
	root[NODE] = () => ({ type: "leaf" });
	const tui = {
		mode: "fullscreen",
		terminal: { columns: 140, rows: 40 },
		layoutRoot: root,
		requestRender: () => {},
	};
	const theme = {
		fg: (_role: string, text: string) => text,
		bold: (text: string) => text,
	};
	const footerData = { onBranchChange: () => () => {}, getGitBranch: () => "main" };

	(extension as unknown as (pi: unknown) => void)(pi);
	return { handlers, ctx, tui, theme, footerData, root, getFooter: () => footerFactory };
}

async function start(env: ReturnType<typeof setup>) {
	for (const fn of env.handlers.get("session_start") ?? []) await fn({}, env.ctx);
	const footer = env.getFooter()?.(env.tui, env.theme, env.footerData);
	assert.ok(footer, "setFooter was called with a factory");
	return footer;
}

test("with the sidebar on, the sidebar column renders real content and the footer is empty", async () => {
	const env = setup(true);
	const footer = await start(env);
	try {
		const node = (env.root[NODE] as () => { entries: Array<{ component: { render(w: number): string[] } }> })();
		assert.equal(node.entries.length, 2, "layout wrapped into [main, sidebar]");
		const lines = node.entries[1]!.component.render(44);
		const text = lines.join("\n");
		assert.ok(lines.length > 3, `sidebar must not be empty, got: ${JSON.stringify(lines)}`);
		assert.ok(!text.includes("sidebar:"), `sidebar render threw: ${text}`);
		assert.match(text, /PROYECTO/);
		assert.match(text, /ctx 42%/);
		assert.deepEqual(footer.render(140), [], "the footer paints nothing while the sidebar is active");
	} finally {
		(footer as unknown as { dispose?(): void }).dispose?.();
		setLanguage("es");
	}
});

test("with the sidebar off, the footer shows project, model and ctx", async () => {
	const env = setup(false);
	const footer = await start(env);
	try {
		const text = footer.render(140).join("\n");
		assert.match(text, /nan\/test-model/);
		assert.match(text, /ctx 42%/);
	} finally {
		(footer as unknown as { dispose?(): void }).dispose?.();
		setLanguage("es");
	}
});
