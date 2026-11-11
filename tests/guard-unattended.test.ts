/**
 * Unattended mode: nothing is ever asked. Destructive commands are refused with
 * a message that tells the model to carry on; outside the project the read tools
 * always pass and everything else is refused; catastrophic targets stay denied.
 * Driven through the real extension's handlers with a ctx that fails if asked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import guardExtension from "../extensions/violeta-guard.ts";
import { getShared, setShared } from "../src/shared-hub.ts";

delete process.env.VIOLETA_AGENTS_CHILD;
delete process.env.VIOLETA_UNATTENDED;

type Result = { block?: boolean; reason?: string } | undefined;
type Handler = (event: unknown, ctx: unknown) => Promise<Result>;
type Command = { handler: (args: string, ctx: unknown) => Promise<void> };

function load() {
	const handlers = new Map<string, Handler>();
	const commands = new Map<string, Command>();
	guardExtension({
		on: (name: string, fn: Handler) => handlers.set(name, fn),
		registerCommand: (name: string, command: Command) => commands.set(name, command),
	} as never);
	const notes: Array<{ text: string; level: string }> = [];
	const ctx = {
		cwd: "/repo",
		hasUI: true,
		sessionManager: { getSessionId: () => "unattended" },
		ui: {
			select: async () => {
				throw new Error("unattended mode must never ask");
			},
			confirm: async () => {
				throw new Error("unattended mode must never ask");
			},
			notify: (text: string, level: string) => notes.push({ text, level }),
		},
	};
	const call = (toolName: string, input: Record<string, unknown>) => handlers.get("tool_call")!({ toolName, input }, ctx);
	return { handlers, commands, ctx, call, notes };
}

test("/unattended switches the mode on and off and says so", async () => {
	const env = load();
	await env.commands.get("unattended")!.handler("on", env.ctx);
	assert.equal(getShared().unattended, true);
	assert.match(env.notes.at(-1)!.text, /ON/);
	await env.commands.get("unattended")!.handler("off", env.ctx);
	assert.equal(getShared().unattended, false);
	await env.commands.get("unattended")!.handler("quizás", env.ctx);
	assert.match(env.notes.at(-1)!.text, /usage: \/unattended/);
	assert.equal(getShared().unattended, false, "a bad argument changes nothing");
});

test("a session starts attended unless VIOLETA_UNATTENDED=1", async () => {
	const env = load();
	setShared({ unattended: true });
	await env.handlers.get("session_start")!({}, env.ctx);
	assert.equal(getShared().unattended, false, "a leftover flag does not survive a new session");
	process.env.VIOLETA_UNATTENDED = "1";
	try {
		await env.handlers.get("session_start")!({}, env.ctx);
		assert.equal(getShared().unattended, true);
	} finally {
		delete process.env.VIOLETA_UNATTENDED;
		setShared({ unattended: false });
	}
});

test("unattended: a destructive command is refused without asking and the model is told to carry on", async () => {
	const env = load();
	setShared({ unattended: true });
	try {
		const result = await env.call("bash", { command: "rm -rf build" });
		assert.equal(result?.block, true);
		assert.match(result!.reason!, /unattended mode/);
		assert.match(result!.reason!, /carry on with the rest of the work/);
		const safe = await env.call("bash", { command: "ls build" });
		assert.equal(safe, undefined, "harmless commands are not slowed down");
	} finally {
		setShared({ unattended: false });
	}
});

test("unattended: a catastrophic target is still denied", async () => {
	const env = load();
	setShared({ unattended: true });
	try {
		const result = await env.call("bash", { command: "rm -rf /" });
		assert.equal(result?.block, true);
	} finally {
		setShared({ unattended: false });
	}
});

test("unattended: reading outside the project is always approved, for every read tool", async () => {
	const env = load();
	setShared({ unattended: true });
	try {
		for (const [tool, input] of [
			["read", { path: "/etc/hostname" }],
			["grep", { pattern: "x", path: "/opt/other" }],
			["find", { path: "/opt/other" }],
			["ls", { path: "/opt/other" }],
		] as const) {
			assert.equal(await env.call(tool, { ...input }), undefined, `${tool} outside the project passes`);
		}
	} finally {
		setShared({ unattended: false });
	}
});

test("unattended: writing, editing or running shell commands on outside paths is refused", async () => {
	const env = load();
	setShared({ unattended: true });
	try {
		for (const [tool, input] of [
			["write", { path: "/opt/other/x.txt", content: "x" }],
			["edit", { path: "/opt/other/x.txt", oldText: "a", newText: "b" }],
			["bash", { command: "cat /opt/other/x.txt" }],
		] as const) {
			const result = await env.call(tool, { ...input });
			assert.equal(result?.block, true, `${tool} outside the project is refused`);
			assert.match(result!.reason!, /you can only read/);
		}
		assert.equal(await env.call("write", { path: "/repo/ok.txt", content: "x" }), undefined, "inside the project stays free");
	} finally {
		setShared({ unattended: false });
	}
});
