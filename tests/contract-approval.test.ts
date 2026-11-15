// contrato-aprobado, pieza 1: once the owner approves a contract, what they
// approved — No-objetivos, Specs and the Tasks rows — is frozen. The session
// may still keep it current (`commit:`, the harness's `estado:`, Decisiones,
// Log), but any change to the approved parts is blocked until the owner
// approves the new version through `contract_approve`, which asks them in a
// dialog: an approval the model cannot write for itself.
//
// Measured reason (2026-11-15, three Jarvis in a live run): after the guard
// refused a code write, GLM added "— quién: Jarvis" to an approved task row
// and wrote the code itself. The contract file was always writable, so the
// escape hatch was a door.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CONTRACT_APPROVAL_ENTRY_TYPE,
	approvalSnapshot,
	contractAfterWrite,
	frozenChanges,
	frozenView,
	replayApproval,
} from "../src/contract/approval.ts";
import { ACTIVE_CONTRACT_ENTRY_TYPE } from "../src/contract/active.ts";
import { contractFrozen } from "../src/authority/contract-frozen.ts";
import guardExtension from "../extensions/violeta-guard.ts";
import contractExtension from "../extensions/violeta-contract.ts";

delete process.env.VIOLETA_AGENTS_CHILD;

const CONTRACT = (tasks: string, extra = "") => `# demo
Runner: npm test

## No-objetivos
- nada

## Specs
S1. Algo.
    Accept: se ve
    Check: npm test

## Tasks
${tasks}

## Decisiones
D1. una${extra}

## Log
L1. "lo pedí yo"
`;

const ROW = "T1. Hacer algo. — specs: S1 — test: required — riesgo: no — commit: -";
const APPROVED = CONTRACT(ROW);
const PATH = "tasks/demo.md";

// ---------------------------------------------------------------- pure view

test("the frozen view ignores what stays open: commit:, estado:, Decisiones and Log", () => {
	const kept = CONTRACT(`${ROW.replace("commit: -", "commit: 9f8e7d6")} — estado: verificada`, "\nD2. otra").replace(
		'L1. "lo pedí yo"',
		'L1. "lo pedí yo"\nL2. más historia',
	);
	assert.equal(frozenView(kept), frozenView(APPROVED));
});

test("the frozen view sees a changed spec, a new task row and a new quién on a row", () => {
	assert.notEqual(frozenView(APPROVED.replace("Accept: se ve", "Accept: otra cosa")), frozenView(APPROVED));
	assert.notEqual(frozenView(CONTRACT(`${ROW}\nT2. Otra. — specs: S1 — test: n/a — riesgo: no — commit: -`)), frozenView(APPROVED));
	assert.notEqual(frozenView(CONTRACT(`${ROW} — quién: Jarvis`)), frozenView(APPROVED));
	assert.notEqual(frozenView(APPROVED.replace("- nada", "- nada\n- tampoco esto")), frozenView(APPROVED));
});

test("frozenChanges lists the approved lines that would go and the new ones", () => {
	const changes = frozenChanges(frozenView(APPROVED), CONTRACT(`${ROW} — quién: Jarvis`));
	assert.deepEqual(changes.removed, [ROW.replace(" — commit: -", " — commit:")]);
	assert.equal(changes.added.length, 1);
	assert.match(changes.added[0]!, /quién: Jarvis/);
});

test("the approval replays from the branch, last one wins, per path", () => {
	const entry = (path: string, text: string) => ({ type: "custom", customType: CONTRACT_APPROVAL_ENTRY_TYPE, data: approvalSnapshot(path, text) });
	const later = CONTRACT(`${ROW}\nT2. Otra. — specs: S1 — test: n/a — riesgo: no — commit: -`);
	const branch = [entry(PATH, APPROVED), { type: "custom", customType: "junk", data: 1 }, entry("tasks/otro.md", "x"), entry(PATH, later)];
	assert.equal(replayApproval(branch, PATH), frozenView(later));
	assert.equal(replayApproval(branch, "tasks/nada.md"), undefined);
	assert.equal(replayApproval([], PATH), undefined);
});

test("contractAfterWrite: write gives its content, edit applies its edits, a shell cannot be known", () => {
	assert.equal(contractAfterWrite("write", { path: PATH, content: "nuevo" }, APPROVED), "nuevo");
	const edited = contractAfterWrite("edit", { path: PATH, edits: [{ oldText: "commit: -", newText: "commit: abc1234" }] }, APPROVED);
	assert.equal(edited, APPROVED.replace("commit: -", "commit: abc1234"));
	const legacy = contractAfterWrite("edit", { path: PATH, oldText: "Accept: se ve", newText: "Accept: x" }, APPROVED);
	assert.equal(legacy, APPROVED.replace("Accept: se ve", "Accept: x"));
	assert.equal(contractAfterWrite("bash", { command: `sed -i s/a/b/ ${PATH}` }, APPROVED), undefined);
});

// ---------------------------------------------------------------- the rule

const request = (over: Record<string, unknown>) =>
	({
		tool: "edit",
		caller: "session",
		paths: ["/p/tasks/demo.md"],
		root: "/p",
		scratch: "/p/.violeta/scratch",
		contract: { path: "/p/tasks/demo.md", text: APPROVED },
		approved: frozenView(APPROVED),
		...over,
	}) as never;

test("the rule refuses a change to what the owner approved", () => {
	assert.equal(contractFrozen.check(request({ contractAfter: APPROVED.replace("Accept: se ve", "Accept: x") })), "/p/tasks/demo.md");
});

test("the rule lets through keeping the contract current", () => {
	assert.equal(contractFrozen.check(request({ contractAfter: APPROVED.replace("commit: -", "commit: abc1234") })), undefined);
});

test("the rule refuses a shell write to an approved contract: its result cannot be read", () => {
	assert.equal(contractFrozen.check(request({ tool: "bash", contractAfter: undefined })), "/p/tasks/demo.md");
});

test("the rule has no opinion without an approval, or when the contract is not being written", () => {
	assert.equal(contractFrozen.check(request({ approved: undefined, contractAfter: "otra cosa" })), undefined);
	assert.equal(contractFrozen.check(request({ paths: ["/p/src/x.ts"], contractAfter: undefined })), undefined);
});

// ---------------------------------------------------------------- wiring

function project(contract: string): string {
	const root = mkdtempSync(join(tmpdir(), "violeta-approval-"));
	mkdirSync(join(root, "tasks"), { recursive: true });
	writeFileSync(join(root, PATH), contract);
	return root;
}

type Handler = (event: unknown, ctx: unknown) => Promise<{ block?: boolean; reason?: string } | undefined>;

function loadGuard(): Handler {
	let toolCall: Handler | undefined;
	guardExtension({
		on: (name: string, fn: Handler) => {
			if (name === "tool_call") toolCall = fn;
		},
		registerCommand: () => {},
	} as never);
	return toolCall!;
}

const approvedBranch = [
	{ type: "custom", customType: ACTIVE_CONTRACT_ENTRY_TYPE, data: { path: PATH } },
	{ type: "custom", customType: CONTRACT_APPROVAL_ENTRY_TYPE, data: approvalSnapshot(PATH, APPROVED) },
];

const guardCtx = (root: string, branch: unknown[]) => ({
	cwd: root,
	hasUI: true,
	sessionManager: { getSessionId: () => "s-approval", getBranch: () => branch },
	ui: { select: async () => "Yes", confirm: async () => true, notify: () => {} },
});

test("the guard blocks Jarvis adding quién: Jarvis to an approved row, naming the rule and the way out", async () => {
	const root = project(APPROVED);
	const result = await loadGuard()(
		{ toolName: "edit", input: { path: PATH, edits: [{ oldText: "commit: -", newText: "commit: - — quién: Jarvis" }] } },
		guardCtx(root, approvedBranch),
	);
	assert.equal(result?.block, true);
	assert.match(result!.reason!, /jarvis\.contract-frozen/);
	assert.match(result!.reason!, /contract_approve/, "the exit is asking the owner, not a line the model writes");
});

test("the guard lets Jarvis record a commit on an approved contract", async () => {
	const root = project(APPROVED);
	const result = await loadGuard()(
		{ toolName: "edit", input: { path: PATH, edits: [{ oldText: "commit: -", newText: "commit: abc1234" }] } },
		guardCtx(root, approvedBranch),
	);
	assert.equal(result, undefined);
});

test("before any approval the contract stays as writable as always", async () => {
	const root = project(APPROVED);
	const result = await loadGuard()(
		{ toolName: "edit", input: { path: PATH, edits: [{ oldText: "Accept: se ve", newText: "Accept: x" }] } },
		guardCtx(root, approvedBranch.slice(0, 1)),
	);
	assert.equal(result, undefined);
});

// ---------------------------------------------------------------- the tool

type Tool = { execute: (...args: unknown[]) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> };

function loadTools(): { tools: Map<string, Tool>; entries: Array<{ type: string; data: unknown }> } {
	const tools = new Map<string, Tool>();
	const entries: Array<{ type: string; data: unknown }> = [];
	contractExtension({
		registerTool: (def: { name: string } & Tool) => tools.set(def.name, def),
		appendEntry: (type: string, data: unknown) => entries.push({ type, data }),
	} as never);
	return { tools, entries };
}

const toolCtx = (root: string, branch: unknown[], answer: string | undefined, seen: string[] = [], hasUI = true) => ({
	cwd: root,
	hasUI,
	sessionManager: { getBranch: () => branch },
	ui: {
		select: async (title: string) => {
			seen.push(title);
			return answer;
		},
		notify: () => {},
	},
});

test("contract_approve asks the owner and, on yes, records the approval and adopts the contract", async () => {
	const root = project(APPROVED);
	const { tools, entries } = loadTools();
	const seen: string[] = [];
	const result = await tools.get("contract_approve")!.execute("id", { path: PATH }, undefined, undefined, toolCtx(root, [], "Yes", seen));
	assert.notEqual(result.isError, true);
	assert.equal(seen.length, 1, "exactly one question to the owner");
	assert.match(seen[0]!, /tasks\/demo\.md/);
	const approval = entries.find((e) => e.type === CONTRACT_APPROVAL_ENTRY_TYPE);
	assert.deepEqual(approval?.data, approvalSnapshot(PATH, APPROVED));
	assert.ok(entries.some((e) => e.type === ACTIVE_CONTRACT_ENTRY_TYPE), "an approved contract is the active one");
});

test("contract_approve on no records nothing and tells the model nothing is built", async () => {
	const root = project(APPROVED);
	const { tools, entries } = loadTools();
	const result = await tools.get("contract_approve")!.execute("id", { path: PATH }, undefined, undefined, toolCtx(root, [], "No"));
	assert.equal(entries.length, 0);
	assert.match(result.content[0]!.text, /did not approve/i);
});

test("contract_approve with nobody to ask refuses instead of approving", async () => {
	const root = project(APPROVED);
	const { tools, entries } = loadTools();
	const result = await tools.get("contract_approve")!.execute("id", { path: PATH }, undefined, undefined, toolCtx(root, [], "Yes", [], false));
	assert.equal(result.isError, true);
	assert.equal(entries.length, 0);
});

test("contract_approve refuses a contract that does not pass the lint", async () => {
	const root = project("# roto\n");
	const { tools, entries } = loadTools();
	const result = await tools.get("contract_approve")!.execute("id", { path: PATH }, undefined, undefined, toolCtx(root, [], "Yes"));
	assert.equal(result.isError, true);
	assert.equal(entries.length, 0);
});

test("re-approving shows the owner what changes, and an unchanged contract is not asked again", async () => {
	const changed = CONTRACT(`${ROW}\nT2. Otra. — specs: S1 — test: n/a — riesgo: no — commit: -`);
	const root = project(changed);
	const { tools } = loadTools();
	const seen: string[] = [];
	await tools.get("contract_approve")!.execute("id", { path: PATH }, undefined, undefined, toolCtx(root, approvedBranch, "Yes", seen));
	assert.match(seen[0]!, /T2\. Otra/, "the dialog shows the new row");

	const same = project(APPROVED);
	const again: string[] = [];
	const result = await tools.get("contract_approve")!.execute("id", { path: PATH }, undefined, undefined, toolCtx(same, approvedBranch, "Yes", again));
	assert.equal(again.length, 0, "nothing approved changed, so nothing is asked");
	assert.match(result.content[0]!.text, /already approved/i);
});
