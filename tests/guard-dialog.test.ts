/**
 * The destructive-command and outside-project dialogs must be asked through
 * `ctx.ui.select` with the English options ["Yes","No"] (S4): only "Yes"
 * approves; "No", cancel and undefined decline. Driven through the extension's
 * public tool_call handler with a mocked ctx.ui — ctx.ui.confirm must never be
 * used.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import guardExtension from "../extensions/violeta-guard.ts";
import { guard } from "../src/i18n.ts";

// The guard reads VIOLETA_AGENTS_CHILD on every call to decide whether it may
// ask. A suite started from inside a subagent inherits that variable, so every
// dialog here would take the no-UI branch and seven tests would fail for a
// reason that has nothing to do with the code. This file asserts the
// interactive behaviour, so it drops the variable explicitly.
delete process.env.VIOLETA_AGENTS_CHILD;

type Handler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>;

function loadGuard(): { toolCall: Handler; grants: { description: string; handler: (args: string, ctx: unknown) => Promise<void> } } {
	let toolCall: Handler | undefined;
	let grants: { description: string; handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
	const fakePi = {
		on: (_name: string, fn: Handler) => {
			if (_name === "tool_call") toolCall = fn;
		},
		registerCommand: (name: string, command: { description: string; handler: (args: string, ctx: unknown) => Promise<void> }) => {
			if (name === "grants") grants = command;
		},
	};
	guardExtension(fakePi as never);
	if (!toolCall || !grants) throw new Error("the guard extension did not register its handler");
	return { toolCall, grants };
}

/** A model registry with one NaN model that answers `reply`. `reply` of
 * undefined means the call never settles, which is what a hung service looks
 * like from here. */
function fakeRegistry(reply: string | undefined, record?: { prompts: string[] }) {
	return {
		getAvailable: () => [{ provider: "nan", id: "mimo-v2.6-flash" }],
		complete: (_model: unknown, context: { messages: { content: string }[] }) => {
			record?.prompts.push(context.messages[0]!.content);
			if (reply === undefined) return new Promise(() => {});
			return Promise.resolve({ content: [{ type: "text", text: reply }] });
		},
	};
}

function makeCtx(selectResult: string | undefined, options: { hasUI?: boolean; registry?: unknown } = {}) {
	const selects: Array<{ prompt: string; options: string[] }> = [];
	const notifications: string[] = [];
	const ctx = {
		cwd: "/repo",
		hasUI: options.hasUI ?? true,
		modelRegistry: options.registry,
		sessionManager: { getSessionId: () => "s1" },
		ui: {
			select: async (prompt: string, options: string[]) => {
				selects.push({ prompt, options });
				return selectResult;
			},
			confirm: async () => {
				throw new Error("ctx.ui.confirm must not be used: the dialog is a select");
			},
			notify: (message: string) => notifications.push(message),
		},
	};
	return { ctx, selects, notifications };
}

const OUTSIDE_DIR = "/opt/violeta-guard-outside/elsewhere";

test("the destructive dialog uses ctx.ui.select with the title, body and options", async () => {
	const { toolCall } = loadGuard();
	const { ctx, selects } = makeCtx(undefined);
	const command = "rm -rf build";
	await toolCall({ toolName: "bash", input: { command } }, ctx);
	assert.equal(selects.length, 1);
	assert.equal(selects[0]!.options.join("|"), "Yes|No");
	assert.ok(selects[0]!.prompt.includes("Destructive command"), selects[0]!.prompt);
	assert.ok(selects[0]!.prompt.includes(command), selects[0]!.prompt);
	assert.ok(selects[0]!.prompt.includes("Why: recursive file removal. Run it anyway?"), selects[0]!.prompt);
});

test("only Yes approves the destructive dialog; No, cancel and undefined decline", async () => {
	const { toolCall } = loadGuard();
	const command = "rm -rf build";
	for (const [answer, approved] of [["Yes", true], ["No", false], [undefined, false]] as const) {
		const { ctx } = makeCtx(answer);
		const result = await toolCall({ toolName: "bash", input: { command } }, ctx);
		if (approved) {
			assert.equal(result, undefined, `answer ${String(answer)} must approve`);
		} else {
			assert.ok(result?.block, `answer ${String(answer)} must decline`);
			assert.equal(result?.reason, guard.declined(command));
		}
	}
});

test("the outside-project dialog is asked once per directory, and approves only with Yes", async () => {
	const { toolCall } = loadGuard();
	const path = `${OUTSIDE_DIR}/x.md`;
	{
		const { ctx, selects } = makeCtx(undefined);
		await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.equal(selects.length, 1);
		assert.equal(selects[0]!.options.join("|"), "Yes|No");
		assert.ok(selects[0]!.prompt.includes("Outside-project access"), selects[0]!.prompt);
		// The grant covers the directory that holds the file, so the dialog
		// names it rather than the file.
		assert.ok(selects[0]!.prompt.includes(OUTSIDE_DIR), selects[0]!.prompt);
		assert.ok(selects[0]!.prompt.includes("The grant lasts only for this session."), selects[0]!.prompt);
		const result = await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.ok(result?.block);
		// The refusal names the scope that was refused.
		assert.equal(result?.reason, guard.outsideDeclined(OUTSIDE_DIR, "/repo"));
	}
	{
		const { ctx, selects } = makeCtx("Yes");
		await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.equal(selects.length, 1);
		// The grant is remembered for the rest of the session: no second dialog.
		const again = await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.equal(again, undefined);
		assert.equal(selects.length, 1);
	}
});

test("catastrophic targets deny without a dialog and without a UI the guard blocks", async () => {
	const { toolCall } = loadGuard();
	{
		const { ctx, selects } = makeCtx("Yes");
		const result = await toolCall({ toolName: "bash", input: { command: "rm -rf /" } }, ctx);
		assert.ok(result?.block);
		assert.equal(result?.reason, guard.catastrophic("recursive file removal"));
		assert.equal(selects.length, 0);
	}
	{
		const { ctx, selects } = makeCtx(undefined, { hasUI: false });
		const result = await toolCall({ toolName: "bash", input: { command: "rm -rf build" } }, ctx);
		assert.ok(result?.block);
		assert.equal(result?.reason, guard.blocked(["recursive file removal"]));
		assert.equal(selects.length, 0);
	}
});

test("/grants revoke notifies without inventing a grant to revoke", async () => {
	const { grants } = loadGuard();
	const { ctx, notifications } = makeCtx("Yes");
	await grants.handler("revoke", ctx);
	assert.deepEqual(notifications, [guard.grantsNothingToRevoke]);
});

test("no Spanish user-facing literal remains in any guard dialog, decline or block text", async () => {
	const { toolCall } = loadGuard();
	const seen: string[] = [];
	const captureCtx = (answer: string | undefined) => {
		const base = makeCtx(answer);
		base.ctx.ui.select = async (prompt: string, options: string[]) => {
			seen.push(prompt, ...options);
			return answer;
		};
		return base;
	};
	// Every dialog and every decline/block path, with the answers recorded.
	for (const [command, answer] of [
		["rm -rf build", "Yes"],
		["rm -rf build", "No"],
		["git push -f origin main", undefined],
		["rm -rf /", "Yes"],
	] as const) {
		const env = captureCtx(answer);
		const result = await toolCall({ toolName: "bash", input: { command } }, env.ctx);
		if (result?.reason) seen.push(result.reason);
	}
	{
		const path = `${OUTSIDE_DIR}/y.md`;
		const env = captureCtx(undefined);
		const result = await toolCall({ toolName: "read", input: { path } }, env.ctx);
		if (result?.reason) seen.push(result.reason);
	}
	const banned = ["Comando destructivo", "Motivo:", "¿Ejecutarlo igual?", "Acceso fuera del proyecto", "Permitir acceso fuera del proyecto"];
	for (const text of seen) {
		for (const phrase of banned) {
			assert.ok(!text.includes(phrase), `Spanish literal leaked: "${phrase}" in "${text}"`);
		}
	}
	// And the English dictionary is actually shown.
	assert.ok(seen.some((text) => text.includes("Destructive command")));
	assert.ok(seen.some((text) => text.includes("Outside-project access")));
	assert.ok(seen.includes("Yes") && seen.includes("No"));
});

// --- Scratch space and the explained dialog (the owner's two asks) ----------

test("anything under the system temp root is used without asking at all", async () => {
	// It is wiped by the system, the harness writes there itself on every voice
	// line, and the dialog it used to raise was the one whose answer is always
	// yes.
	const { toolCall } = loadGuard();
	const { ctx, selects } = makeCtx(undefined);
	for (const path of [`${tmpdir()}/violeta-voice-abc/line.wav`, `${tmpdir()}/x.txt`, tmpdir()]) {
		const result = await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.equal(result, undefined, path);
	}
	assert.equal(selects.length, 0, "not one dialog for scratch space");
	// A directory that merely starts like the temp root is still outside.
	await toolCall({ toolName: "read", input: { path: `${tmpdir()}foo/x.txt` } }, ctx);
	assert.equal(selects.length, 1, "the boundary is the same one the rest of the guard uses");
});

test("the destructive dialog shows what the command does, with the command underneath", async () => {
	const { toolCall } = loadGuard();
	const record = { prompts: [] as string[] };
	const answer = "Action: Borra definitivamente dos carpetas con todo su contenido.\nFiles: ninguno\nFolders: build, node_modules";
	const { ctx, selects, notifications } = makeCtx("Yes", { registry: fakeRegistry(answer, record) });
	const command = "rm -rf build node_modules";
	await toolCall({ toolName: "bash", input: { command } }, ctx);
	assert.equal(selects.length, 1);
	const prompt = selects[0]!.prompt;
	assert.ok(prompt.includes("Borra definitivamente dos carpetas"), prompt);
	assert.ok(prompt.includes("Folders: build, node_modules"), prompt);
	assert.ok(prompt.includes("Why: recursive file removal."), prompt);
	// The summary is a model's reading and can be wrong, so the command itself
	// has to survive to the dialog.
	assert.ok(prompt.includes(`Command: ${command}`), prompt);
	assert.equal(record.prompts.length, 1, "one call, and the command is what it is asked about");
	assert.ok(record.prompts[0]!.includes(command));
	// Nine silent seconds before a dialog look like a hung harness.
	assert.ok(notifications.includes(guard.explainWorking), notifications.join(" | "));
});

test("when no model can read the command, the dialog is exactly what it was before", async () => {
	const { toolCall } = loadGuard();
	const command = "rm -rf build";
	const reasons = ["recursive file removal"];
	// No registry at all, a registry with no NaN model, and an answer that is
	// not in the three-line shape: all three fall back to the command.
	const runs = [
		makeCtx("No"),
		makeCtx("No", { registry: { getAvailable: () => [{ provider: "otro", id: "x" }] } }),
		makeCtx("No", { registry: fakeRegistry("Claro, con gusto te explico ese comando.") }),
	];
	for (const run of runs) await toolCall({ toolName: "bash", input: { command } }, run.ctx);
	for (const run of runs) {
		assert.equal(run.selects.length, 1);
		assert.equal(run.selects[0]!.prompt, `${guard.destructiveTitle}\n${guard.destructiveBody(command, reasons)}`);
	}
});

test("a model that never answers costs the dialog a moment, not the session", async () => {
	process.env.VIOLETA_TEST_EXPLAIN_MS = "50";
	try {
		const { toolCall } = loadGuard();
		const command = "rm -rf build";
		const reasons = ["recursive file removal"];
		// fakeRegistry(undefined) returns a promise that never settles: a hung
		// service, from the guard's side.
		const { ctx, selects } = makeCtx("No", { registry: fakeRegistry(undefined) });
		const started = Date.now();
		const result = await toolCall({ toolName: "bash", input: { command } }, ctx);
		assert.ok(Date.now() - started < 2000, "the ceiling is a ceiling");
		assert.equal(selects.length, 1, "the dialog is still asked");
		assert.equal(selects[0]!.prompt, `${guard.destructiveTitle}\n${guard.destructiveBody(command, reasons)}`);
		assert.ok(result?.block, "and declining still blocks");
	} finally {
		delete process.env.VIOLETA_TEST_EXPLAIN_MS;
	}
});
