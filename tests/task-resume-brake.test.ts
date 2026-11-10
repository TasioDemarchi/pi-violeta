// S9 (estado-de-tareas): the resume brake, from the outside.
//
// A resumed session once redid a spike that was already committed, because it
// believed the panel instead of the repository, and overwrote working code. The
// rule now lives in the harness: before `subagent_run` marks a task `en curso`,
// the tool_call hook asks git and the contract whether that task already exists.
// If it does, the dispatch is refused (or the owner is asked first) and nothing
// is written — a blocked call never reaches `execute`, and the agent loop skips
// `afterToolCall` for it, so the row keeps exactly the bytes it had.
//
// Real git in a temp project: "was it built?" is a commit, and "did it ask?" is
// the mocked `ctx.ui.select`. Every assertion reads the contract file (D2).
//
// The guard answers "no UI" when VIOLETA_AGENTS_CHILD=1; the repo's known trap.
delete process.env.VIOLETA_AGENTS_CHILD;

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-task-state.ts";
import { contract, guard } from "../src/i18n.ts";
import { setShared } from "../src/shared-hub.ts";

const CONTRACT_PATH = "tasks/estado-de-tareas.md";

const CONTRACT = `# estado-de-tareas
Runner: node --test tests/task-resume-brake.test.ts

## Specs
S1. Algo.

## Tasks
T1. El spike que ya está hecho — specs: S1 — test: required — riesgo: no — commit: -
T2. Una tarea que falta — specs: S1 — test: required — riesgo: no — commit: -
`;

type Handler = (event: unknown, ctx: unknown) => unknown;

interface Harness {
	handlers: Map<string, Handler[]>;
	dir: string;
	file: string;
	/** What the owner answers in every dialog this run raises. */
	answer: string | undefined;
	selects: Array<{ prompt: string; options: string[] }>;
	hasUI: boolean;
}

/** `git` in the temp project, with an identity so no test depends on the
 * machine's config. */
function git(dir: string, ...args: string[]): string {
	return execFileSync("git", ["-c", "user.email=test@example.com", "-c", "user.name=test", ...args], { cwd: dir, encoding: "utf8" });
}

interface ProjectOptions {
	/** Commit subjects to add AFTER the contract exists (the work). */
	commits?: string[];
	/** Commit the contract file at all (default true): without a birth commit
	 * nothing in the history can be dated against it. */
	trackContract?: boolean;
	/** Extra history written BEFORE the contract exists (an older contract). */
	before?: Array<{ commit: string; file?: string }>;
	hasUI?: boolean;
	answer?: string | undefined;
	/** Leave the directory outside any repository, so git answers nothing. */
	noGit?: boolean;
}

/** A temp project with real history, plus the mocked owner. */
function project(options: ProjectOptions = {}): Harness {
	setShared({ unattended: false });
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-resume-"));
	mkdirSync(join(dir, "tasks"), { recursive: true });
	const file = join(dir, CONTRACT_PATH);

	if (!options.noGit) {
		git(dir, "init", "-q", "-b", "main");
		// History from an older contract: it names T1, but it predates this one.
		for (const { commit, file: older } of options.before ?? []) {
			if (older !== undefined) {
				writeFileSync(join(dir, older), "# viejo\n");
				git(dir, "add", older);
				git(dir, "commit", "-qm", `contrato(viejo): nace ${older}`);
			}
			git(dir, "commit", "-q", "--allow-empty", "-m", commit);
		}
	}

	writeFileSync(file, CONTRACT);
	if (!options.noGit && options.trackContract !== false) {
		git(dir, "add", CONTRACT_PATH);
		git(dir, "commit", "-qm", "contrato(estado-de-tareas): nace");
	}
	if (!options.noGit) {
		for (const commit of options.commits ?? []) git(dir, "commit", "-q", "--allow-empty", "-m", commit);
	}

	const handlers = new Map<string, Handler[]>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
	});
	return { handlers, dir, file, answer: options.answer ?? guard.yes, selects: [], hasUI: options.hasUI ?? true };
}

function ctxOf(h: Harness) {
	return {
		cwd: h.dir,
		hasUI: h.hasUI,
		ui: {
			select: async (prompt: string, options: string[]) => {
				h.selects.push({ prompt, options });
				return h.answer;
			},
			confirm: async () => {
				throw new Error("ctx.ui.confirm must not be used: the options must be Spanish");
			},
			notify: () => {},
		},
	};
}

/** Fire the tool_call handlers and return the last verdict the harness gave
 * (a blocked call answers `{ block: true, reason }`; an allowed one answers
 * nothing). */
async function call(h: Harness, input: Record<string, unknown>): Promise<{ block?: boolean; reason?: string } | undefined> {
	let verdict: { block?: boolean; reason?: string } | undefined;
	for (const fn of h.handlers.get("tool_call") ?? []) {
		const out = (await fn({ type: "tool_call", toolName: "subagent_run", toolCallId: "c1", input }, ctxOf(h))) as
			| { block?: boolean; reason?: string }
			| undefined;
		if (out !== undefined) verdict = out;
	}
	return verdict;
}

const dispatch = (contractTask: number) => ({ agent: "builder", task: "do the thing", label: "build the thing", contractTask });

const read = (h: Harness) => readFileSync(h.file, "utf8");

test("a task the branch already committed is not dispatched again", async () => {
	const h = project({ commits: ["T1(spike): el cache"], hasUI: false });
	const verdict = await call(h, dispatch(1));
	assert.equal(verdict?.block, true);
	// the refusal names the task and the commit, so the model can check it
	assert.match(verdict?.reason ?? "", /T1/);
	assert.match(verdict?.reason ?? "", /T1\(spike\)/);
	// nothing was written: the row is byte for byte what it was
	assert.equal(read(h), CONTRACT);
});

test("a task nobody built is dispatched as before", async () => {
	const h = project({ commits: ["T1(spike): el cache"] });
	assert.equal(await call(h, dispatch(2)), undefined);
	assert.match(read(h), /^T2\..*— estado: en curso$/m);
	assert.match(read(h), /^T1\..*— commit: -$/m);
});

test("with an owner to ask, a yes redoes the task", async () => {
	const h = project({ commits: ["T1(spike): el cache"], answer: guard.yes });
	assert.equal(await call(h, dispatch(1)), undefined);
	assert.equal(h.selects.length, 1);
	assert.deepEqual(h.selects[0]?.options, [guard.yes, guard.no]);
	assert.match(h.selects[0]?.prompt ?? "", /T1/);
	assert.match(read(h), /^T1\..*— estado: en curso$/m);
});

test("a no leaves the row exactly as it was", async () => {
	const h = project({ commits: ["T1(spike): el cache"], answer: guard.no });
	const verdict = await call(h, dispatch(1));
	assert.equal(verdict?.block, true);
	assert.match(verdict?.reason ?? "", new RegExp(contract.resumeDeclinedByOwner(1).slice(0, 30)));
	assert.equal(read(h), CONTRACT);
});

test("unattended mode asks nobody and refuses", async () => {
	const h = project({ commits: ["T1(spike): el cache"], answer: guard.yes });
	setShared({ unattended: true });
	const verdict = await call(h, dispatch(1));
	assert.equal(verdict?.block, true);
	assert.equal(h.selects.length, 0);
	assert.equal(read(h), CONTRACT);
});

test("a row the harness verified blocks too, with no commit at all", async () => {
	const h = project({ hasUI: false });
	writeFileSync(h.file, CONTRACT.replace("— commit: -\nT2.", "— commit: - — estado: verificada\nT2."));
	const before = read(h);
	const verdict = await call(h, dispatch(1));
	assert.equal(verdict?.block, true);
	assert.match(verdict?.reason ?? "", /T1/);
	assert.equal(read(h), before);
});

test("an older contract's T1 is not proof about this one", async () => {
	// The old contract lived and its T1 landed; this contract was born after.
	// A long history full of T1 commits must not freeze every new T1.
	const h = project({ before: [{ commit: "T1(viejo): el spike de ayer", file: "tasks/viejo.md" }], hasUI: false });
	assert.equal(await call(h, dispatch(1)), undefined);
	assert.match(read(h), /^T1\..*— estado: en curso$/m);
});

test("a contract git never saw has no birth, so no commit is dated against it", async () => {
	const h = project({ commits: ["T1(spike): el cache"], trackContract: false, hasUI: false });
	assert.equal(await call(h, dispatch(1)), undefined);
	assert.match(read(h), /^T1\..*— estado: en curso$/m);
});

test("a project outside any repository keeps working", async () => {
	const h = project({ noGit: true, hasUI: false });
	assert.equal(await call(h, dispatch(1)), undefined);
	assert.match(read(h), /^T1\..*— estado: en curso$/m);
});

test("a dispatch with no contractTask is never blocked, and asks nothing", async () => {
	const h = project({ commits: ["T1(spike): el cache"] });
	const verdict = await call(h, { agent: "builder", task: "labels say T1", label: "T1 build the thing" });
	assert.equal(verdict, undefined);
	assert.equal(h.selects.length, 0);
	assert.equal(read(h), CONTRACT);
});
