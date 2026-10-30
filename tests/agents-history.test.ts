import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { capTaskHistory, loadTaskHistory, saveTaskToHistory } from "../src/agents/history.ts";
import type { AgentTask } from "../src/agents/store.ts";

function task(id: string, status: AgentTask["status"] = "completed"): AgentTask {
	return {
		id,
		name: "probe",
		label: `label ${id}`,
		title: `title ${id}`,
		summary: `summary ${id}`,
		status,
		model: "nan/deepseek-v4-flash",
		effort: "low",
		tokens: 10,
		cost: 0.01,
		startedAt: 1000,
		endedAt: 2000,
		result: `result ${id}`,
		thread: [{ kind: "text", text: "hi" }],
	};
}

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "violeta-hist-"));
}

test("saveTaskToHistory writes one JSON file per task and loadTaskHistory reads it back", () => {
	const dir = scratch();
	try {
		saveTaskToHistory(dir, task("a"));
		saveTaskToHistory(dir, task("b"));
		const loaded = loadTaskHistory(dir);
		assert.deepEqual(loaded.map((t) => t.id).sort(), ["a", "b"]);
		const a = loaded.find((t) => t.id === "a")!;
		assert.equal(a.result, "result a");
		assert.deepEqual(a.thread, [{ kind: "text", text: "hi" }]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("history round-trips the title and summary fields", () => {
	const dir = scratch();
	try {
		saveTaskToHistory(dir, task("a"));
		const loaded = loadTaskHistory(dir);
		assert.equal(loaded.length, 1);
		assert.equal(loaded[0]!.title, "title a");
		assert.equal(loaded[0]!.summary, "summary a");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("old history files without title/summary fall back to the label and never crash", () => {
	const dir = scratch();
	try {
		const legacy = task("old") as unknown as Record<string, unknown>;
		delete legacy.title;
		delete legacy.summary;
		writeFileSync(join(dir, "old.json"), JSON.stringify(legacy));
		writeFileSync(join(dir, "corrupt.json"), "{oops");
		const loaded = loadTaskHistory(dir);
		assert.deepEqual(loaded.map((t) => t.id), ["old"]);
		assert.equal(loaded[0]!.title, "label old");
		assert.equal(loaded[0]!.summary, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadTaskHistory skips corrupt files and invalid shapes", () => {
	const dir = scratch();
	try {
		saveTaskToHistory(dir, task("good"));
		writeFileSync(join(dir, "corrupt.json"), "{not json");
		writeFileSync(join(dir, "wrong.json"), JSON.stringify({ nope: 1 }));
		writeFileSync(join(dir, "unterminated.json"), JSON.stringify(task("x")).slice(0, 20));
		const loaded = loadTaskHistory(dir);
		assert.deepEqual(loaded.map((t) => t.id), ["good"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadTaskHistory tolerates a missing directory", () => {
	assert.deepEqual(loadTaskHistory(join(tmpdir(), "violeta-hist-nope-x")), []);
});

test("capTaskHistory keeps the newest HISTORY_CAP files and drops the oldest", () => {
	const dir = scratch();
	try {
		for (let i = 0; i < 205; i++) {
			const file = join(dir, `t${String(i).padStart(3, "0")}.json`);
			writeFileSync(file, JSON.stringify(task(`t${i}`)));
		}
		capTaskHistory(dir, 200);
		const files = readdirSync(dir).sort();
		assert.equal(files.length, 200);
		assert.equal(existsSync(join(dir, "t000.json")), false);
		assert.equal(existsSync(join(dir, "t004.json")), false);
		assert.equal(existsSync(join(dir, "t005.json")), true);
		assert.equal(existsSync(join(dir, "t204.json")), true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("saveTaskToHistory applies the cap after writing", () => {
	const dir = scratch();
	try {
		for (let i = 0; i < 202; i++) saveTaskToHistory(dir, task(`t${String(i).padStart(3, "0")}`));
		assert.equal(readdirSync(dir).length, 200);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
