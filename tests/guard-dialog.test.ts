/**
 * The destructive-command and outside-project dialogs must be asked through
 * `ctx.ui.select` with Spanish options ["Sí","No"] (S10): only "Sí" approves;
 * "No", cancel and undefined decline. Driven through the extension's public
 * tool_call handler with a mocked ctx.ui — ctx.ui.confirm must never be used.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import guardExtension from "../extensions/violeta-guard.ts";
import { guard, setLanguage } from "../src/i18n.ts";

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

function makeCtx(selectResult: string | undefined, options: { hasUI?: boolean } = {}) {
	const selects: Array<{ prompt: string; options: string[] }> = [];
	const notifications: string[] = [];
	const ctx = {
		cwd: "/repo",
		hasUI: options.hasUI ?? true,
		sessionManager: { getSessionId: () => "s1" },
		ui: {
			select: async (prompt: string, options: string[]) => {
				selects.push({ prompt, options });
				return selectResult;
			},
			confirm: async () => {
				throw new Error("ctx.ui.confirm must not be used: the options must be Spanish");
			},
			notify: (message: string) => notifications.push(message),
		},
	};
	return { ctx, selects, notifications };
}

const OUTSIDE_DIR = "/tmp/violeta-guard-es/fuera";
// A different directory from the Spanish tests: grants are remembered per
// session and every mocked context here shares session id "s1".
const OUTSIDE_DIR_EN = "/tmp/violeta-guard-en/fuera";

test("the destructive dialog uses ctx.ui.select with the Spanish title, body and options", async () => {
	const { toolCall } = loadGuard();
	const { ctx, selects } = makeCtx(undefined);
	const command = "rm -rf build";
	await toolCall({ toolName: "bash", input: { command } }, ctx);
	assert.equal(selects.length, 1);
	assert.equal(selects[0]!.options.join("|"), "Sí|No");
	assert.ok(selects[0]!.prompt.includes("Comando destructivo"), selects[0]!.prompt);
	assert.ok(selects[0]!.prompt.includes(command), selects[0]!.prompt);
	assert.ok(selects[0]!.prompt.includes("Motivo: borrado recursivo de archivos. ¿Ejecutarlo igual?"), selects[0]!.prompt);
});

test("only Sí approves the destructive dialog; No, cancel and undefined decline", async () => {
	const { toolCall } = loadGuard();
	const command = "rm -rf build";
	for (const [answer, approved] of [["Sí", true], ["No", false], [undefined, false]] as const) {
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

test("the outside-project dialog is Spanish, asked once per directory, and approves only with Sí", async () => {
	const { toolCall } = loadGuard();
	const path = `${OUTSIDE_DIR}/x.md`;
	{
		const { ctx, selects } = makeCtx(undefined);
		await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.equal(selects.length, 1);
		assert.equal(selects[0]!.options.join("|"), "Sí|No");
		assert.ok(selects[0]!.prompt.includes("Acceso fuera del proyecto"), selects[0]!.prompt);
		// Temp paths collapse to the temp root so `mktemp -d` stops asking again
		// every run, so the dialog names the root rather than the leaf.
		assert.ok(selects[0]!.prompt.includes("/tmp"), selects[0]!.prompt);
		assert.ok(selects[0]!.prompt.includes("El permiso dura solo esta sesión."), selects[0]!.prompt);
		const result = await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.ok(result?.block);
		// The refusal names the scope that was refused: the collapsed temp root.
		assert.equal(result?.reason, guard.outsideDeclined("/tmp", "/repo"));
	}
	{
		const { ctx, selects } = makeCtx("Sí");
		await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.equal(selects.length, 1);
		// The grant is remembered for the rest of the session: no second dialog.
		const again = await toolCall({ toolName: "read", input: { path } }, ctx);
		assert.equal(again, undefined);
		assert.equal(selects.length, 1);
	}
});

test("catastrophic targets deny without a dialog and without a UI the guard blocks in Spanish", async () => {
	const { toolCall } = loadGuard();
	{
		const { ctx, selects } = makeCtx("Sí");
		const result = await toolCall({ toolName: "bash", input: { command: "rm -rf /" } }, ctx);
		assert.ok(result?.block);
		assert.equal(result?.reason, guard.catastrophic("borrado recursivo de archivos"));
		assert.equal(selects.length, 0);
	}
	{
		const { ctx, selects } = makeCtx(undefined, { hasUI: false });
		const result = await toolCall({ toolName: "bash", input: { command: "rm -rf build" } }, ctx);
		assert.ok(result?.block);
		assert.equal(result?.reason, guard.blocked(["borrado recursivo de archivos"]));
		assert.equal(selects.length, 0);
	}
});

test("/grants revoke notifies in Spanish", async () => {
	const { grants } = loadGuard();
	const { ctx, notifications } = makeCtx("Sí");
	await grants.handler("revoke", ctx);
	assert.deepEqual(notifications, [guard.grantsNothingToRevoke]);
});

test("no English user-facing literal remains in any guard dialog, decline or block text", async () => {
	const { toolCall } = loadGuard();
	const seen: string[] = [];
	const captureCtx = (answer: string | undefined) => {
		const base = makeCtx(answer);
		return {
			ctx: base.ctx,
			collect: (prompt: string) => seen.push(prompt),
			notifications: base.notifications,
		};
	};
	// Every dialog and every decline/block path, with the answers recorded.
	for (const [command, answer] of [
		["rm -rf build", "Sí"],
		["rm -rf build", "No"],
		["git push -f origin main", undefined],
		["rm -rf /", "Sí"],
	] as const) {
		const env = captureCtx(answer);
		const originalSelect = env.ctx.ui.select;
		env.ctx.ui.select = async (prompt: string, options: string[]) => {
			seen.push(prompt, ...options);
			return originalSelect(prompt, options);
		};
		const result = await toolCall({ toolName: "bash", input: { command } }, env.ctx);
		if (result?.reason) seen.push(result.reason);
	}
	{
		const path = `${OUTSIDE_DIR}/y.md`;
		const env = captureCtx(undefined);
		const originalSelect = env.ctx.ui.select;
		env.ctx.ui.select = async (prompt: string, options: string[]) => {
			seen.push(prompt, ...options);
			return originalSelect(prompt, options);
		};
		const result = await toolCall({ toolName: "read", input: { path } }, env.ctx);
		if (result?.reason) seen.push(result.reason);
	}
	const banned = [
		"Destructive command",
		"Run it anyway",
		"Why: ",
		"Yes",
		"Outside-project access",
		"Allow access outside the project",
		"The grant lasts only",
		"declined this destructive command",
		"Find a safer way",
		"Blocked without a prompt",
		"Catastrophic target denied",
		"denied without a prompt",
	];
	for (const text of seen) {
		for (const phrase of banned) {
			assert.ok(!text.includes(phrase), `English literal leaked: "${phrase}" in "${text}"`);
		}
	}
	// And the Spanish dictionary is actually shown.
	assert.ok(seen.some((text) => text.includes("Comando destructivo")));
	assert.ok(seen.includes("Sí") && seen.includes("No"));
});

// --- English mode (S3): the same dialogs with the original English strings ----

test("in English mode the destructive dialog shows Destructive command / Why / Run it anyway? with Yes|No", async () => {
	try {
		setLanguage("en");
		const { toolCall } = loadGuard();
		const { ctx, selects } = makeCtx(undefined);
		const command = "rm -rf build";
		await toolCall({ toolName: "bash", input: { command } }, ctx);
		assert.equal(selects.length, 1);
		assert.equal(selects[0]!.options.join("|"), "Yes|No");
		assert.ok(selects[0]!.prompt.includes("Destructive command"), selects[0]!.prompt);
		assert.ok(selects[0]!.prompt.includes(command), selects[0]!.prompt);
		assert.ok(selects[0]!.prompt.includes("Why: recursive file removal. Run it anyway?"), selects[0]!.prompt);
	} finally {
		setLanguage("es");
	}
});

test("in English mode only Yes approves the destructive dialog; No, cancel and undefined decline", async () => {
	try {
		setLanguage("en");
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
	} finally {
		setLanguage("es");
	}
});

test("in English mode the outside-project dialog is English and approves only with Yes", async () => {
	try {
		setLanguage("en");
		const { toolCall } = loadGuard();
		const path = `${OUTSIDE_DIR_EN}/x.md`;
		{
			const { ctx, selects } = makeCtx(undefined);
			await toolCall({ toolName: "read", input: { path } }, ctx);
			assert.equal(selects.length, 1);
			assert.equal(selects[0]!.options.join("|"), "Yes|No");
			assert.ok(selects[0]!.prompt.includes("Outside-project access"), selects[0]!.prompt);
			assert.ok(selects[0]!.prompt.includes("Allow access outside the project"), selects[0]!.prompt);
			assert.ok(selects[0]!.prompt.includes("/tmp"), selects[0]!.prompt);
			assert.ok(selects[0]!.prompt.includes("The grant lasts only for this session."), selects[0]!.prompt);
			const declined = await toolCall({ toolName: "read", input: { path } }, ctx);
			assert.ok(declined?.block);
			assert.equal(declined?.reason, guard.outsideDeclined("/tmp", "/repo"));
		}
		{
			const { ctx, selects } = makeCtx("Yes");
			await toolCall({ toolName: "read", input: { path } }, ctx);
			assert.equal(selects.length, 1);
			const again = await toolCall({ toolName: "read", input: { path } }, ctx);
			assert.equal(again, undefined);
			assert.equal(selects.length, 1);
		}
	} finally {
		setLanguage("es");
	}
});

test("in English mode the no-UI block and catastrophic deny texts are the original English", async () => {
	try {
		setLanguage("en");
		const { toolCall } = loadGuard();
		{
			const { ctx, selects } = makeCtx("Yes");
			const result = await toolCall({ toolName: "bash", input: { command: "rm -rf /" } }, ctx);
			assert.ok(result?.block);
			assert.equal(result?.reason, "Catastrophic target denied without a prompt: recursive file removal.");
			assert.equal(selects.length, 0);
		}
		{
			const { ctx, selects } = makeCtx(undefined, { hasUI: false });
			const result = await toolCall({ toolName: "bash", input: { command: "rm -rf build" } }, ctx);
			assert.ok(result?.block);
			assert.equal(result?.reason, "Blocked: recursive file removal. No interactive user is available to approve it.");
			assert.equal(selects.length, 0);
		}
	} finally {
		setLanguage("es");
	}
});
