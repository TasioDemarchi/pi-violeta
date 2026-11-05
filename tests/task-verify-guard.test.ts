// S6 (estado-de-tareas): the verification goes through the guard, and in
// unattended mode no Check runs at all.
//
// The `Check` is run by the harness when a worker reports it finished (S5). S6
// says that run is not exempt from the guard: a `Check` the guard calls
// destructive asks the owner first, with the same dialog the guard shows for
// `bash`; a declined Check leaves the row `por verificar` and writes the motive
// on the D8 continuation line instead of running; unattended mode runs nothing
// — destructive or not — and writes the motive there too.
//
// The destructive Checks here are real shell commands with an `rm -rf` in a
// segment, run in a temp project: "did the harness run it?" is a file on disk
// (check.log) and "did it ask?" is the mocked `ctx.ui.select`. Every assertion
// reads the contract file (D2).
//
// The guard answers "no UI" when VIOLETA_AGENTS_CHILD=1 and then blocks instead
// of asking; that is the repo's known trap, and the Check runs in the parent's
// process, not a child's. The test drops the variable.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import extension from "../extensions/violeta-task-state.ts";
import { guard } from "../src/i18n.ts";
import { setShared } from "../src/shared-hub.ts";

delete process.env.VIOLETA_AGENTS_CHILD;

const CONTRACT_PATH = "tasks/estado-de-tareas.md";

// A `Check:` is a shell line, and the guard looks at shell segments: the
// destructive segment has to be there for `rm -rf` to be recognised, and the
// log write is what proves whether it ran.
const CONTRACT = `# estado-de-tareas
Runner: node --test tests/task-verify-guard.test.ts

## No-objetivos
- no tocar el campo commit

## Specs
S1. Un Check destructivo que pasa.
    Accept: la fila queda verificada.
    Check: rm -rf .cache && printf 'ran\\n' >> check.log; exit 0
S2. Un Check destructivo que falla.
    Accept: la fila queda fallada con la salida real.
    Check: rm -rf .cache && printf 'boom\\n'; exit 1
S3. Un Check inocuo.
    Accept: la fila queda verificada sin diálogo.
    Check: printf 'safe\\n' >> check.log; exit 0

## Tasks
T1. Destructivo verde — specs: S1 — test: required — riesgo: sí — commit: -
T2. Destructivo rojo — specs: S2 — test: required — riesgo: no — commit: -
T3. Inocuo — specs: S3 — test: required — riesgo: no — commit: -
T4. Otro destructivo verde — specs: S1 — test: required — riesgo: no — commit: -
T5. Otro inocuo — specs: S3 — test: required — riesgo: no — commit: -
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

/** A temp project whose only content is the contract file at the active path,
 * plus the mocked owner: `answer` is what `ctx.ui.select` returns. */
function project(answer: string | undefined = "Sí", options: { hasUI?: boolean } = {}): Harness {
	setShared({ unattended: false });
	const dir = mkdtempSync(join(tmpdir(), "violeta-task-verify-guard-"));
	mkdirSync(join(dir, "tasks"), { recursive: true });
	const file = join(dir, CONTRACT_PATH);
	writeFileSync(file, CONTRACT);
	const handlers = new Map<string, Handler[]>();
	(extension as unknown as (pi: unknown) => void)({
		on: (name: string, fn: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), fn]),
	});
	return { handlers, dir, file, answer, selects: [], hasUI: options.hasUI ?? true };
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

async function fire(h: Harness, name: string, event: unknown): Promise<void> {
	for (const fn of h.handlers.get(name) ?? []) await fn(event, ctxOf(h));
}

const dispatch = (contractTask: number) => ({ agent: "coder", task: "do the thing", label: "do the thing", contractTask });

async function call(h: Harness, input: Record<string, unknown>): Promise<void> {
	await fire(h, "tool_call", { type: "tool_call", toolName: "subagent_run", toolCallId: "c1", input });
}

async function result(h: Harness, input: Record<string, unknown>): Promise<void> {
	await fire(h, "tool_result", {
		type: "tool_result",
		toolName: "subagent_run",
		toolCallId: "c1",
		input,
		isError: false,
		content: [{ type: "text", text: "done" }],
	});
}

/** A whole dispatch: the call that marks the row, then the result that runs
 * the Check through the guard. */
async function dispatchAndFinish(h: Harness, taskId: number): Promise<void> {
	const input = dispatch(taskId);
	await call(h, input);
	assert.match(read(h), new RegExp(`^T${taskId}\\..*— estado: en curso$`, "m"));
	await result(h, input);
}

const read = (h: Harness) => readFileSync(h.file, "utf8");
const ranCheck = (h: Harness) => existsSync(join(h.dir, "check.log"));
const linesOf = (md: string) => md.split("\n");
const rowAt = (md: string, id: string) => linesOf(md).findIndex((line) => line.startsWith(`T${id}. `));
const noteAt = (md: string, id: string) => linesOf(md)[rowAt(md, id) + 1]!;
const writeContract = (h: Harness, md: string) => writeFileSync(h.file, md);

test("a destructive Check asks the guard's dialog first, and Sí runs it", async () => {
	const h = project("Sí");
	await dispatchAndFinish(h, 1);

	// the dialog is the guard's, with the guard's title, command and options
	assert.equal(h.selects.length, 1);
	assert.equal(h.selects[0]!.options.join("|"), `${guard.yes}|${guard.no}`);
	assert.ok(h.selects[0]!.prompt.includes(guard.destructiveTitle), h.selects[0]!.prompt);
	assert.ok(h.selects[0]!.prompt.includes("rm -rf .cache"), h.selects[0]!.prompt);
	assert.ok(h.selects[0]!.prompt.includes("Motivo: borrado recursivo de archivos"), h.selects[0]!.prompt);

	// and only then did it run, in the contract's project
	assert.equal(readFileSync(join(h.dir, "check.log"), "utf8"), "ran\n");
	// the real result rules the row, and no motive line is left behind
	const md = read(h);
	assert.match(md, /^T1\..*— commit: - — estado: verificada$/m);
	assert.doesNotMatch(md, /Check no ejecutado/);
	assert.match(md, /^T3\..*— commit: -$/m);
});

test("an approved destructive Check that fails is fallada, ruled by the real result", async () => {
	const h = project("Sí");
	await dispatchAndFinish(h, 2);

	assert.equal(h.selects.length, 1);
	assert.equal(ranCheck(h), false);
	const md = read(h);
	assert.match(linesOf(md)[rowAt(md, "2")]!, /— estado: fallada$/);
	assert.match(noteAt(md, "2"), /^ {4}Check falló: .*boom/);
	assert.doesNotMatch(md, /Check no ejecutado/);
});

test("a destructive Check the owner declines never runs and leaves the row por verificar with the motive", async () => {
	const h = project("No");
	await dispatchAndFinish(h, 1);

	assert.equal(h.selects.length, 1);
	assert.equal(ranCheck(h), false, "a declined Check must not run");
	const md = read(h);
	assert.match(linesOf(md)[rowAt(md, "1")]!, /— estado: por verificar$/);
	// D8's continuation line carries the motive, not the output of a Check
	assert.match(noteAt(md, "1"), /^ {4}Check no ejecutado: .*rechazó/);
	assert.ok(noteAt(md, "1").includes("rm -rf .cache"), noteAt(md, "1"));
	assert.doesNotMatch(md, /Check falló/);
	// exactly one line added, and no other row moved
	assert.equal(linesOf(md).length, linesOf(CONTRACT).length + 1);
	assert.match(md, /^T2\..*— commit: -$/m);
});

test("a destructive Check with no UI is blocked, never run, and the motive says why", async () => {
	const h = project("Sí", { hasUI: false });
	await dispatchAndFinish(h, 4);

	assert.equal(h.selects.length, 0, "there is no one to ask");
	assert.equal(ranCheck(h), false);
	const md = read(h);
	assert.match(linesOf(md)[rowAt(md, "4")]!, /— estado: por verificar$/);
	assert.match(noteAt(md, "4"), /^ {4}Check no ejecutado: .*interactivo/);
});

test("an innocuous Check runs with no dialog at all", async () => {
	const h = project("No");
	await dispatchAndFinish(h, 3);

	assert.equal(h.selects.length, 0, "nothing destructive, nothing to ask");
	assert.equal(readFileSync(join(h.dir, "check.log"), "utf8"), "safe\n");
	const md = read(h);
	assert.match(md, /^T3\..*— commit: - — estado: verificada$/m);
	assert.doesNotMatch(md, /Check no ejecutado/);
});

test("unattended mode runs no Check at all — destructive or not — and writes the motive", async () => {
	setShared({ unattended: true });
	try {
		// destructive: no dialog (nobody is there), nothing executed
		const destructive = project("Sí");
		setShared({ unattended: true });
		await dispatchAndFinish(destructive, 1);
		assert.equal(destructive.selects.length, 0, "unattended never asks");
		assert.equal(ranCheck(destructive), false, "unattended runs nothing");
		const md = read(destructive);
		assert.match(linesOf(md)[rowAt(md, "1")]!, /— estado: por verificar$/);
		assert.match(noteAt(md, "1"), /^ {4}Check no ejecutado: /);
		assert.ok(noteAt(md, "1").includes(guard.checkUnattended), noteAt(md, "1"));

		// S6 is about the verification, not about destructiveness: the innocuous
		// Check does not run either.
		const innocuous = project("Sí");
		setShared({ unattended: true });
		await dispatchAndFinish(innocuous, 5);
		assert.equal(ranCheck(innocuous), false, "unattended runs no Check at all");
		assert.equal(innocuous.selects.length, 0);
		const md2 = read(innocuous);
		assert.match(linesOf(md2)[rowAt(md2, "5")]!, /— estado: por verificar$/);
		assert.ok(noteAt(md2, "5").includes(guard.checkUnattended), noteAt(md2, "5"));
	} finally {
		setShared({ unattended: false });
	}
});

test("a row refused while unattended is verified once unattended is off and the Check passes", async () => {
	// The refusal is a state of the row, not a dead end: the same dispatch in an
	// interactive session runs the Check and the real result takes the row.
	setShared({ unattended: true });
	let h: Harness;
	try {
		h = project("No");
		setShared({ unattended: true });
		await dispatchAndFinish(h, 1);
		assert.match(read(h), /Check no ejecutado/);
	} finally {
		setShared({ unattended: false });
	}
	try {
		h!.answer = "Sí";
		await dispatchAndFinish(h!, 1);
	} finally {
		setShared({ unattended: false });
	}
	const md = read(h!);
	assert.match(linesOf(md)[rowAt(md, "1")]!, /— estado: verificada$/);
	assert.doesNotMatch(md, /Check no ejecutado/);
	assert.equal(linesOf(md).length, linesOf(CONTRACT).length);
});
