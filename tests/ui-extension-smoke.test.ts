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

	let headerFactory: ((tui: unknown, theme: unknown) => { render(w: number): string[] }) | undefined;
	let footerFactory: ((tui: unknown, theme: unknown, data: unknown) => { render(w: number): string[] }) | undefined;
	const ctx = {
		cwd: process.cwd(),
		mode: "tui",
		model: { id: "nan/test-model", provider: "nan" },
		sessionManager: { getBranch: () => [] },
		getContextUsage: () => ({ percent: 42, tokens: 4200, contextWindow: 10000 }),
		ui: {
			setTitle: () => {},
			setHeader: (factory: typeof headerFactory) => {
				headerFactory = factory;
			},
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
	return { handlers, ctx, tui, theme, footerData, root, getFooter: () => footerFactory, getHeader: () => headerFactory };
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
		assert.match(text, /nan\/test-model · medium/);
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
		assert.match(text, /nan\/test-model · medium/);
		assert.match(text, /ctx 42%/);
	} finally {
		(footer as unknown as { dispose?(): void }).dispose?.();
		setLanguage("es");
	}
});

type Node = { type: string; entries: Array<{ component: { render(w: number): string[]; [k: symbol]: unknown } }> };

test("in fullscreen the header is pinned above the transcript and not drawn twice", async () => {
	const env = setup(false);
	const footer = await start(env);
	try {
		const header = env.getHeader()!(env.tui, env.theme);
		const node = (env.root[NODE] as () => Node)();
		assert.equal(node.type, "vstack", "header over the original layout");
		assert.match(node.entries[0]!.component.render(80).join("\n"), /violeta/);
		assert.deepEqual(header.render(80), [], "Pi's scrolling header container stays empty");
		const body = node.entries[1]!.component[NODE] as () => { type: string };
		assert.equal(body().type, "leaf", "the original layout is untouched underneath");
	} finally {
		(footer as unknown as { dispose?(): void }).dispose?.();
	}
});

test("with the sidebar on, the header sits above the main column and the sidebar keeps full height", async () => {
	const env = setup(true);
	const footer = await start(env);
	try {
		env.getHeader()!(env.tui, env.theme);
		const node = (env.root[NODE] as () => Node)();
		assert.equal(node.type, "hstack");
		const column = node.entries[0]!.component[NODE] as () => Node;
		assert.match(column().entries[0]!.component.render(80).join("\n"), /violeta/);
	} finally {
		(footer as unknown as { dispose?(): void }).dispose?.();
	}
});

test("outside fullscreen the header stays where Pi draws it", async () => {
	const env = setup(false);
	(env.tui as { mode: string }).mode = "regular";
	const footer = await start(env);
	try {
		const header = env.getHeader()!(env.tui, env.theme);
		assert.match(header.render(80).join("\n"), /violeta/);
		assert.equal((env.root[NODE] as () => { type: string })().type, "leaf");
	} finally {
		(footer as unknown as { dispose?(): void }).dispose?.();
	}
});

// The fake root above cannot catch layout arithmetic mistakes (a missing `gap`
// once collapsed the whole transcript and editor). This lays the wrapped root out
// with Pi's real layout engine and real stacks.
for (const sidebar of [false, true]) {
	test(`real layout engine: header on top, transcript and editor still get their rows (sidebar ${sidebar ? "on" : "off"})`, async () => {
		const tuiDir = join(import.meta.dirname, "..", "node_modules", "@earendil-works", "pi-tui", "dist");
		const { renderLayoutFrame } = await import(join(tuiDir, "layout.js"));
		const { VStack } = await import(join(tuiDir, "components", "v-stack.js"));
		const { ScrollView } = await import(join(tuiDir, "components", "scroll-view.js"));
		const text = (lines: string[]) => ({ render: () => lines, invalidate() {} });
		const transcript = new ScrollView(text(Array.from({ length: 50 }, (_, i) => `chat ${i}`)), { follow: "end", primary: true });
		const dock = new VStack([{ component: text(["EDITOR"]), shrink: 1, minSize: 1 }]);
		const real = new VStack([
			{ component: transcript, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			{ component: dock, basis: "auto", grow: 0, shrink: 1, minSize: 1 },
		]);
		const env = setup(sidebar);
		(env.tui as { layoutRoot: unknown }).layoutRoot = real;
		const footer = await start(env);
		try {
			env.getHeader()!(env.tui, env.theme);
			const frame = renderLayoutFrame(real, 140, 20, () => {});
			const screen = (frame.lines as string[]).map((line) => line.replace(/\x1b\[[0-9;]*m|\x1b\][^\x07]*\x07/g, ""));
			assert.match(screen[0]!, /violeta/, "header on the first row");
			assert.match(screen.slice(1, 19).join("\n"), /chat 49/, "the transcript shows its latest line");
			assert.match(screen.join("\n"), /EDITOR/, "the editor is on screen");
		} finally {
			(footer as unknown as { dispose?(): void }).dispose?.();
		}
	});
}
