// contrato-aprobado, pieza 2: the close is refused while a risky contract has
// no tester report. jarvis.md §5 already says to dispatch `tester` once when
// every task passed and some task is `riesgo: sí`; on 2026-11-15 a Jarvis
// (GLM) closed a contract with two risky tasks without it, while the Jarvis
// that did dispatch it (DeepSeek) got the only finding that could delete the
// owner's data. What must always hold is enforced by the harness.
//
// The moment of closing is `agent_before_settle` with every task finished
// (committed, verified, or waiting on a manual Check). The harness then asks
// for ONE more model request with the reason; if the model still ends without
// a tester, the owner is warned instead of looping.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLOSE_GATE_ENTRY_TYPE, closeGate } from "../src/contract/close-gate.ts";
import { ACTIVE_CONTRACT_ENTRY_TYPE } from "../src/contract/active.ts";
import contractExtension from "../extensions/violeta-contract.ts";

delete process.env.VIOLETA_AGENTS_CHILD;

const CONTRACT = (tasks: string) => `# demo
Runner: npm test

## No-objetivos
- nada

## Specs
S1. Algo.
    Accept: se ve
    Check: npm test

## Tasks
${tasks}

## Log
L1. "lo pedí yo"
`;

const RISKY_DONE = CONTRACT(
	[
		"T1. Validar. — specs: S1 — test: required — riesgo: sí — commit: - — estado: verificada",
		"T2. README. — specs: S1 — test: n/a — riesgo: no — commit: - — estado: por verificar",
	].join("\n"),
);

let seq = 0;
const call = (agent: string, isError = false) => {
	const id = `c${++seq}`;
	return [
		{ type: "message", message: { role: "assistant", content: [{ type: "toolCall", id, name: "subagent_run", arguments: { agent, task: "x" } }] } },
		{ type: "message", message: { role: "toolResult", toolCallId: id, isError, content: [{ type: "text", text: "ok" }] } },
	];
};

// ---------------------------------------------------------------- pure gate

test("a finished contract with a risky task and no tester is refused, naming the risky tasks", () => {
	const verdict = closeGate(RISKY_DONE, [...call("builder"), ...call("judge")]);
	assert.deepEqual(verdict?.risky, [1]);
});

test("a tester after the last builder opens the gate", () => {
	assert.equal(closeGate(RISKY_DONE, [...call("builder"), ...call("tester")]), undefined);
});

test("a tester before the last builder does not count: the code changed after it", () => {
	assert.ok(closeGate(RISKY_DONE, [...call("tester"), ...call("builder")]));
});

test("a tester dispatch that was refused does not count", () => {
	assert.ok(closeGate(RISKY_DONE, [...call("builder"), ...call("tester", true)]));
});

test("no gate while work is pending, without risky tasks, or without a contract", () => {
	const pending = CONTRACT("T1. Validar. — specs: S1 — test: required — riesgo: sí — commit: - — estado: en curso");
	assert.equal(closeGate(pending, call("builder")), undefined);
	const safe = CONTRACT("T1. README. — specs: S1 — test: n/a — riesgo: no — commit: abc1234");
	assert.equal(closeGate(safe, call("builder")), undefined);
	assert.equal(closeGate("", call("builder")), undefined);
	const failed = CONTRACT("T1. Validar. — specs: S1 — test: required — riesgo: sí — commit: - — estado: fallada");
	assert.equal(closeGate(failed, call("builder")), undefined, "a failed task is not a close");
});

test("the verdict carries a key that changes when a new builder runs", () => {
	const first = closeGate(RISKY_DONE, call("builder"))!;
	const second = closeGate(RISKY_DONE, [...call("builder"), ...call("builder")])!;
	assert.notEqual(first.key, second.key);
});

// ---------------------------------------------------------------- wiring

type Settle = (event: unknown, ctx: unknown) => Promise<{ continue?: boolean; entries?: Array<{ type: string; customType?: string; content?: unknown }> } | undefined>;

function loadSettle(): Settle {
	let handler: Settle | undefined;
	contractExtension({
		registerTool: () => {},
		appendEntry: () => {},
		on: (name: string, fn: Settle) => {
			if (name === "agent_before_settle") handler = fn;
		},
	} as never);
	if (!handler) throw new Error("violeta-contract registers no agent_before_settle handler");
	return handler;
}

function project(contract: string): string {
	const root = mkdtempSync(join(tmpdir(), "violeta-close-"));
	mkdirSync(join(root, "tasks"), { recursive: true });
	writeFileSync(join(root, "tasks", "demo.md"), contract);
	return root;
}

// canContinue is false on a real close (the transcript ends with the model's
// answer); the gate's own message is what makes the next request possible.
const event = { type: "agent_before_settle", entries: [], continue: false, outcome: "completed", context: { canContinue: false } };

const settleCtx = (root: string, branch: unknown[], notes: string[] = []) => ({
	cwd: root,
	hasUI: true,
	sessionManager: { getBranch: () => branch },
	ui: { notify: (text: string) => notes.push(text) },
});

test("at the close the harness asks for one more request with the reason, and the owner sees it", async () => {
	const root = project(RISKY_DONE);
	const branch = [{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: "tasks/demo.md" } }, ...call("builder")];
	const result = await loadSettle()(event, settleCtx(root, branch));
	assert.equal(result?.continue, true);
	const message = result!.entries!.find((e) => e.type === "custom_message");
	assert.match(String(message?.content), /jarvis\.close-needs-tester/);
	assert.match(String(message?.content), /T1/);
	assert.ok(result!.entries!.some((e) => e.type === "custom" && e.customType === CLOSE_GATE_ENTRY_TYPE), "the nudge is recorded");
});

test("entries other handlers proposed before this one are kept", async () => {
	const root = project(RISKY_DONE);
	const branch = [{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: "tasks/demo.md" } }, ...call("builder")];
	const earlier = { type: "custom", customType: "someone-else", data: 1 };
	const result = await loadSettle()({ ...event, entries: [earlier] }, settleCtx(root, branch));
	assert.equal(result!.entries![0], earlier);
});

test("a second close without tester warns the owner instead of looping", async () => {
	const root = project(RISKY_DONE);
	const base = [{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: "tasks/demo.md" } }, ...call("builder")];
	const first = await loadSettle()(event, settleCtx(root, base));
	const marker = first!.entries!.find((e) => e.type === "custom")!;
	const notes: string[] = [];
	const second = await loadSettle()(event, settleCtx(root, [...base, marker], notes));
	assert.notEqual(second?.continue, true);
	assert.equal(notes.length, 1);
	assert.match(notes[0]!, /tester/i);
});

test("an aborted run or a subagent never triggers the gate", async () => {
	const root = project(RISKY_DONE);
	const branch = [{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: "tasks/demo.md" } }, ...call("builder")];
	assert.equal(await loadSettle()({ ...event, outcome: "aborted" }, settleCtx(root, branch)), undefined);
	process.env.VIOLETA_AGENTS_CHILD = "1";
	try {
		assert.equal(await loadSettle()(event, settleCtx(root, branch)), undefined);
	} finally {
		delete process.env.VIOLETA_AGENTS_CHILD;
	}
});
