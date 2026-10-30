import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { AgentStore, type AgentTask } from "../src/agents/store.ts";
import type { AgentDefinition } from "../src/agents/definitions.ts";
import { SubagentRunner, promptText } from "../src/agents/runner.ts";

const DEF: AgentDefinition = {
	name: "probe",
	description: "probe",
	model: "nan/deepseek-v4-flash",
	thinking: "low",
	tools: ["read", "grep"],
	prompt: "You are a probe.",
	source: "probe.md",
};

interface FakeChild extends EventEmitter {
	stdin: PassThrough;
	stdout: PassThrough;
	stderr: PassThrough;
	pid: number;
	signals: string[];
	kill(signal: string): boolean;
}

function fakeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	child.pid = 4242;
	child.signals = [];
	child.kill = (signal: string) => {
		child.signals.push(signal);
		return true;
	};
	return child;
}

function fakeScheduler() {
	const timers: Array<{ fn(): void; ms: number; cancelled: boolean }> = [];
	const schedule = (fn: () => void, ms: number) => {
		const timer = { fn, ms, cancelled: false };
		timers.push(timer);
		return () => {
			timer.cancelled = true;
		};
	};
	const fire = (predicate?: (t: { ms: number }) => boolean) => {
		for (const timer of [...timers]) {
			if (timer.cancelled) continue;
			if (predicate && !predicate(timer)) continue;
			timer.cancelled = true;
			timer.fn();
		}
	};
	return { timers, schedule, fire };
}

interface Harness {
	store: AgentStore;
	runner: SubagentRunner;
	children: FakeChild[];
	spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }>;
	scheduler: ReturnType<typeof fakeScheduler>;
	dir: string;
	cleanup(): void;
	write(child: FakeChild, record: unknown): void;
	lines(child: FakeChild): string[];
	start(overrides?: { maxConcurrency?: number; task?: string; label?: string; mode?: "task" | "background" }): AgentTask;
}

function harness(overrides: { maxConcurrency?: number; task?: string; mode?: "task" | "background"; stallTimeoutMs?: number } = {}): Harness {
	const dir = mkdtempSync(join(tmpdir(), "violeta-runner-"));
	const store = new AgentStore();
	const children: FakeChild[] = [];
	const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
	const scheduler = fakeScheduler();
	let clock = 1000;
	const spawn = (command: string, args: string[], options: Record<string, unknown>) => {
		spawned.push({ command, args, options });
		const child = fakeChild();
		children.push(child);
		return child;
	};
	const runner = new SubagentRunner(store, {
		agentDir: dir,
		cwd: dir,
		maxConcurrency: overrides.maxConcurrency ?? 3,
		stallTimeoutMs: overrides.stallTimeoutMs ?? 240_000,
		spawn,
		now: () => clock,
		schedule: scheduler.schedule,
		onSettled: () => {},
	});
	const write = (child: FakeChild, record: unknown) => {
		child.stdout.write(`${JSON.stringify(record)}\n`);
	};
	const lines = (child: FakeChild) => {
		const data = child.stdin.read();
		return data ? data.toString().split("\n").filter(Boolean) : [];
	};
	return {
		store,
		runner,
		children,
		spawned,
		scheduler,
		dir,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
		write,
		lines,
		start: (over = {}) =>
			runner.start(DEF, {
				task: over.task ?? overrides.task ?? "list files",
				label: over.label ?? overrides.label,
				mode: over.mode ?? overrides.mode ?? "task",
			}),
	};
}

function definition(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
	return { ...DEF, ...overrides };
}

test("start sets the title from the label and falls back to the task's first sentence", () => {
	const h = harness();
	try {
		const withLabel = h.start({ label: "Read note.txt" });
		assert.equal(withLabel.title, "Read note.txt");
		const withoutLabel = h.runner.start(DEF, { task: "Corregir parser de git status. Luego seguir.", mode: "task" });
		assert.equal(withoutLabel.title, "Corregir parser de git status.");
		const blankLabel = h.runner.start(DEF, { task: "short task", label: "   ", mode: "task" });
		assert.equal(blankLabel.title, "short task");
	} finally {
		h.cleanup();
	}
});

test("a completed task gets a summary from the result handoff", async () => {
	const h = harness();
	try {
		const fromSummaryLine = h.start({ task: "summarize things" });
		h.write(h.children[0]!, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "step one\nsummary: mapped the footer sources\nmore" }] },
		});
		h.write(h.children[0]!, { type: "agent_settled", aborted: false });
		await h.runner.waitFor(fromSummaryLine.id);
		assert.equal(h.store.get(fromSummaryLine.id)!.summary, "mapped the footer sources");

		const fromFirstLine = h.start({ task: "other things" });
		h.write(h.children[1]!, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "The first line stands alone." }] },
		});
		h.write(h.children[1]!, { type: "agent_settled", aborted: false });
		await h.runner.waitFor(fromFirstLine.id);
		assert.equal(h.store.get(fromFirstLine.id)!.summary, "The first line stands alone.");
	} finally {
		h.cleanup();
	}
});

test("a failed task summarizes the first line of the error", async () => {
	const h = harness();
	try {
		const task = h.start();
		h.children[0]!.emit("exit", 1, null);
		await h.runner.waitFor(task.id);
		assert.equal(h.store.get(task.id)!.summary, "pi exited with code 1 before settling");
	} finally {
		h.cleanup();
	}
});

test("promptText appends the context block", () => {
	assert.equal(promptText({ task: "do it" }), "do it");
	assert.equal(promptText({ task: "do it", context: "extra facts" }), "do it\n\n## Context\nextra facts");
});

test("start launches a child pi in rpc mode with definition flags and the prompt", async () => {
	const h = harness();
	try {
		const task = h.start();
		assert.equal(task.status, "running");
		assert.equal(h.spawned.length, 1);
		const { command, args, options } = h.spawned[0]!;
		assert.equal(command, process.execPath);
		assert.match(args[0]!, /cli\.js$/);
		assert.equal(options.cwd, h.dir);
		const flag = (name: string) => args[args.indexOf(name) + 1];
		assert.equal(flag("--mode"), "rpc");
		assert.ok(args.includes("--no-session"));
		assert.equal(flag("--model"), "nan/deepseek-v4-flash");
		assert.equal(flag("--thinking"), "low");
		assert.equal(flag("--tools"), "read,grep");
		const systemPromptPath = flag("--append-system-prompt");
		assert.ok(systemPromptPath);
		assert.ok(existsSync(systemPromptPath!));
		const lines = h.lines(h.children[0]!);
		const prompt = JSON.parse(lines[0]!);
		assert.equal(prompt.type, "prompt");
		assert.equal(prompt.message, "list files");
	} finally {
		h.cleanup();
	}
});

test("children get VIOLETA_AGENTS_CHILD=1 so the package never recurses", () => {
	const h = harness();
	try {
		h.start();
		const env = h.spawned[0]!.options.env as NodeJS.ProcessEnv;
		assert.equal(env.VIOLETA_AGENTS_CHILD, "1");
	} finally {
		h.cleanup();
	}
});

test("prompt includes the context block", () => {
	const h = harness();
	try {
		h.runner.start(DEF, { task: "do it", context: "extra", mode: "task" });
		const prompt = JSON.parse(h.lines(h.children[0]!)[0]!);
		assert.equal(prompt.message, "do it\n\n## Context\nextra");
	} finally {
		h.cleanup();
	}
});

test("a definition without thinking or tools omits those flags", () => {
	const h = harness();
	try {
		h.runner.start(definition({ thinking: undefined, tools: [] }), { task: "x", mode: "task" });
		const args = h.spawned[0]!.args;
		assert.ok(!args.includes("--thinking"));
		assert.ok(!args.includes("--tools"));
	} finally {
		h.cleanup();
	}
});

test("rpc events reduce into the task and agent_settled completes it, persists history and closes the child", async () => {
	const h = harness();
	try {
		const settled: AgentTask[] = [];
		h.runner.options.onSettled = (t) => settled.push(t);
		const task = h.start();
		h.write(h.children[0]!, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello " } });
		h.write(h.children[0]!, { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "world" } });
		h.write(h.children[0]!, {
			type: "message_end",
			message: { role: "assistant", content: [{ type: "text", text: "Hello world" }], usage: { input: 50, output: 10, cost: { total: 0.2 } } },
		});
		h.write(h.children[0]!, { type: "agent_settled", aborted: false });
		await h.runner.waitFor(task.id);
		const finished = h.store.get(task.id)!;
		assert.equal(finished.status, "completed");
		assert.equal(finished.result, "Hello world");
		assert.equal(finished.tokens, 60);
		assert.equal(finished.cost, 0.2);
		assert.equal(finished.endedAt, 1000);
		assert.ok(settled.some((t) => t.id === task.id));
		const historyFiles = readdirSync(join(h.dir, "agents-history"));
		assert.equal(historyFiles.length, 1);
	} finally {
		h.cleanup();
	}
});

test("an aborted agent_settled marks the task aborted", async () => {
	const h = harness();
	try {
		const task = h.start();
		h.write(h.children[0]!, { type: "agent_settled", aborted: true });
		await h.runner.waitFor(task.id);
		assert.equal(h.store.get(task.id)?.status, "aborted");
	} finally {
		h.cleanup();
	}
});

test("a silent child fails on the stall watchdog", async () => {
	const h = harness({ stallTimeoutMs: 240_000 });
	try {
		const task = h.start();
		h.scheduler.fire();
		await h.runner.waitFor(task.id);
		const finished = h.store.get(task.id)!;
		assert.equal(finished.status, "failed");
		assert.match(finished.error ?? "", /stalled/);
	} finally {
		h.cleanup();
	}
});

test("a tool call in flight is exempt from the idle budget but bounded by the tool budget", async () => {
	const h = harness({ stallTimeoutMs: 240_000 });
	try {
		const task = h.start();
		h.write(h.children[0]!, { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "sleep 100" } });
		h.scheduler.fire((t) => t.ms <= 240_000);
		assert.equal(h.store.get(task.id)?.status, "running");
		h.scheduler.fire((t) => t.ms >= 240_000);
		await h.runner.waitFor(task.id);
		const finished = h.store.get(task.id)!;
		assert.equal(finished.status, "failed");
		assert.match(finished.error ?? "", /stalled/);
	} finally {
		h.cleanup();
	}
});

test("a child dialog request is answered with a cancellation so it never hangs", () => {
	const h = harness();
	try {
		h.start();
		h.write(h.children[0]!, { type: "extension_ui_request", id: "ui-1", method: "confirm", title: "Allow?" });
		const lines = h.lines(h.children[0]!);
		const response = lines.map((l) => JSON.parse(l)).find((r) => r.type === "extension_ui_response");
		assert.deepEqual(response, { type: "extension_ui_response", id: "ui-1", cancelled: true });
	} finally {
		h.cleanup();
	}
});

test("cancel SIGTERMs a running child and escalates to SIGKILL, marking the task aborted", async () => {
	const h = harness();
	try {
		const task = h.start();
		assert.equal(h.runner.cancel(task.id), true);
		assert.equal(h.store.get(task.id)?.status, "aborted");
		assert.deepEqual(h.children[0]!.signals, ["SIGTERM"]);
		h.scheduler.fire();
		assert.deepEqual(h.children[0]!.signals, ["SIGTERM", "SIGKILL"]);
		await h.runner.waitFor(task.id);
		assert.equal(h.store.get(task.id)?.status, "aborted");
	} finally {
		h.cleanup();
	}
});

test("cancel aborts a queued task without spawning a child", async () => {
	const h = harness({ maxConcurrency: 1 });
	try {
		const first = h.start();
		const second = h.start();
		assert.equal(h.spawned.length, 1);
		assert.equal(h.runner.cancel(second.id), true);
		assert.equal(h.store.get(second.id)?.status, "aborted");
		assert.equal(h.children[0]!.signals.length, 0);
		h.write(h.children[0]!, { type: "agent_settled", aborted: false });
		await h.runner.waitFor(first.id);
		assert.equal(h.store.get(second.id)?.status, "aborted");
	} finally {
		h.cleanup();
	}
});

test("tasks beyond max concurrency stay queued and launch when a slot frees", async () => {
	const h = harness({ maxConcurrency: 1 });
	try {
		const first = h.start();
		const second = h.start();
		assert.equal(first.status, "running");
		assert.equal(second.status, "queued");
		assert.equal(h.spawned.length, 1);
		h.write(h.children[0]!, { type: "agent_settled", aborted: false });
		await h.runner.waitFor(first.id);
		assert.equal(h.spawned.length, 2);
		h.write(h.children[1]!, { type: "agent_settled", aborted: false });
		await h.runner.waitFor(second.id);
		assert.equal(h.store.get(second.id)?.status, "completed");
	} finally {
		h.cleanup();
	}
});

test("a child that exits before settling fails the task", async () => {
	const h = harness();
	try {
		const task = h.start();
		h.children[0]!.emit("exit", 1, null);
		await h.runner.waitFor(task.id);
		const finished = h.store.get(task.id)!;
		assert.equal(finished.status, "failed");
		assert.match(finished.error ?? "", /exited/);
	} finally {
		h.cleanup();
	}
});

test("waitFor resolves undefined for an unknown id", async () => {
	const h = harness();
	try {
		assert.equal(await h.runner.waitFor("nope"), undefined);
	} finally {
		h.cleanup();
	}
});

test("killAll force-kills every live child and aborts queued tasks", () => {
	const h = harness({ maxConcurrency: 1 });
	try {
		const first = h.start();
		const second = h.start();
		h.runner.killAll();
		assert.deepEqual(h.children[0]!.signals, ["SIGKILL"]);
		assert.equal(h.store.get(first.id)?.status, "aborted");
		assert.equal(h.store.get(second.id)?.status, "aborted");
		assert.equal(h.runner.activeCount(), 0);
	} finally {
		h.cleanup();
	}
});
