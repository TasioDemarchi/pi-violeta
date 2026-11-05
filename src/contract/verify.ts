/** The `Check` of a contract task, and the running of it (S5, estado-de-tareas).
 *
 * Nothing is accepted on trust (D3): when a worker says it finished, the harness
 * asks this module which command proves it and runs that command. The command
 * lives in the `Check:` line of the SPEC the task row cites (`— specs: S5`), in
 * the `## Specs` section — never on the row, where the model writes prose and a
 * command would be one more thing to keep in sync (D4's argument, applied to the
 * contract itself).
 *
 * Three answers, matching the three ways S5 says a delivery can come out:
 *
 *   a runnable `Check:`            the command to run
 *   `Check: manual: <what to see>` nothing to run; a human decides
 *   no `Check:` at all             nothing to run; a human decides
 *
 * The parsing is `./lint.ts`'s: the same `sections`/`items`/`field` that decide
 * whether a spec HAS a check decide which command it is, so "lint says this spec
 * has no Check" and "the harness found no Check" can never disagree.
 *
 * Running is a separate, injectable value (`CheckExecutor`). The default spawns
 * `bash -c <command>` in the project, because a `Check:` is written as a shell
 * line (`test -x ... && git ... | grep -q ...`). The seam exists for T8 (S6):
 * the guard has to see the command before it runs, and unattended mode has to be
 * able to refuse it, without this module knowing about either. */

import { execFile } from "node:child_process";
import { field, find, inlineField, items, sections } from "./lint.ts";

export interface TaskCheck {
	/** The exact command, when the Check is runnable. */
	command?: string;
	/** What a human has to look at, when the Check is `manual: ...`. */
	manual?: string;
}

/** The spec ids a task row cites, in file order: `— specs: S5` → `["S5"]`. */
function citedSpecs(body: string): string[] {
	return (inlineField(body, "specs") ?? "")
		.split(/[,\s]+/)
		.map((id) => id.toUpperCase())
		.filter((id) => /^S\d+$/.test(id));
}

/** The Check task `taskId` must pass: from the first spec it cites that has one.
 * Undefined when the row is unknown, or no cited spec carries a `Check:`. */
export function checkForTask(md: string, taskId: number): TaskCheck | undefined {
	const all = sections(md);
	const row = items(find(all, "tasks", "tareas"), "T").find((item) => Number(item.id.slice(1)) === taskId);
	if (!row) return undefined;
	const specs = items(find(all, "specs"), "S");
	for (const id of citedSpecs(row.body)) {
		const spec = specs.find((item) => item.id === id);
		const check = spec ? field(spec.body, "Check") : undefined;
		if (check === undefined || check === "") continue;
		const manual = /^manual:\s*(.*)$/i.exec(check);
		if (manual) return { manual: manual[1]!.trim() };
		return { command: check };
	}
	return undefined;
}

export interface CheckResult {
	/** The command exited 0. */
	ok: boolean;
	/** What it printed, stdout then stderr. Only the writer's clipping reads it. */
	output: string;
}

/** Runs one Check in the project it belongs to. */
export type CheckExecutor = (command: string, cwd: string) => Promise<CheckResult>;

/** The default executor: `bash -c <command>` with the project as cwd, so a
 * `Check:` is exactly the line the contract spells. The timeout is the same
 * order as a full test suite, not an interactive command: a Check that hangs
 * forever is a broken Check, and the row must still get its answer. */
export const runCheckCommand: CheckExecutor = (command, cwd) =>
	new Promise((resolve) => {
		execFile("bash", ["-c", command], { cwd, maxBuffer: 8 * 1024 * 1024, timeout: 10 * 60 * 1000 }, (error, stdout, stderr) => {
			resolve({ ok: error === null, output: `${stdout}${stderr}`.trim() });
		});
	});

/** The value the harness writes into `estado:` (D7), plus the output a failed
 * Check leaves for the writer to clip (D8). */
export interface VerifyOutcome {
	status: "verificada" | "fallada" | "por verificar";
	output?: string;
}

/** Run the task's Check and say what it means. `run` is the executor; the
 * default is the shell, and T8 hands over its own. */
export async function verifyTask(
	md: string,
	taskId: number,
	cwd: string,
	run: CheckExecutor = runCheckCommand,
): Promise<VerifyOutcome> {
	const check = checkForTask(md, taskId);
	if (check?.command === undefined) return { status: "por verificar" };
	const result = await run(check.command, cwd);
	return result.ok ? { status: "verificada" } : { status: "fallada", output: result.output };
}
