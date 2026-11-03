/**
 * Contract lint: the zero-token check that runs before any model reads a
 * contract. It enforces the shape, not the meaning: whether a requirement is
 * ambiguous is the critic's job, but whether it HAS an acceptance criterion and
 * a runnable check is a fact a regex can establish for free.
 *
 * The contract format (one page, `tasks/<name>.md`):
 *
 *   # <name>
 *   <one-line intent>
 *   Runner: <exact test command, or "none">
 *
 *   ## No-objetivos
 *   - <what is explicitly not done>
 *
 *   ## Specs
 *   S1. <requirement, the user's strings verbatim>
 *       Accept: <observable criterion>
 *       Check: <exact command, or "manual: <what to observe>">
 *
 *   ## Tasks
 *   T1. <task> — specs: S1 — test: required|recommended|n/a — riesgo: sí|no — commit: -
 *
 *   ## Decisiones
 *   D1. <answer to a question, citable by number>
 *
 *   ## Log
 *   L1. <the user's original request, verbatim>
 *
 * `S0`/`T0` is the spike: the thinnest end-to-end proof against any external
 * system (a device, an API, a toolchain). It is required whenever the contract
 * names one, unless it says `Externo: no`.
 */

export interface LintIssue {
	rule: string;
	message: string;
	/** 1-based line in the contract, when the issue has one. */
	line?: number;
}

export interface LintResult {
	ok: boolean;
	errors: LintIssue[];
	warnings: LintIssue[];
}

const EXTERNAL = /\b(adb|android|ios|tablet|dispositivo|device|celular|emulador|api externa|webhook|oauth|ssh|docker|kubernetes|bluetooth|usb)\b|https?:\/\//i;
const PLACEHOLDER = /^(?:<[^>]*>|tbd|todo|\?+|-|n\/a)?$/i;
const MAX_LINES = 100;

interface Section {
	title: string;
	start: number;
	lines: Array<{ text: string; line: number }>;
}

function sections(text: string): Section[] {
	const out: Section[] = [];
	let current: Section | undefined;
	text.split("\n").forEach((raw, i) => {
		const heading = raw.match(/^##\s+(.+?)\s*$/);
		if (heading) {
			current = { title: heading[1]!.toLowerCase(), start: i + 1, lines: [] };
			out.push(current);
		} else if (current) {
			current.lines.push({ text: raw, line: i + 1 });
		}
	});
	return out;
}

const find = (all: Section[], ...names: string[]) => all.find((s) => names.includes(s.title));

/** Items like `S1. ...` plus their indented continuation lines, up to the next item. */
function items(section: Section | undefined, letter: string): Array<{ id: string; line: number; body: string }> {
	if (!section) return [];
	const found: Array<{ id: string; line: number; body: string }> = [];
	for (const { text, line } of section.lines) {
		const head = text.match(new RegExp(`^(?:[-*]\\s+)?${letter}(\\d+)\\.\\s*(.*)$`));
		if (head) found.push({ id: `${letter}${head[1]}`, line, body: head[2] ?? "" });
		else if (found.length > 0) found[found.length - 1]!.body += `\n${text}`;
	}
	return found;
}

function field(body: string, name: string): string | undefined {
	const m = body.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*(.*)`, "i"));
	return m ? m[1]!.trim() : undefined;
}

/** Task rows keep their fields inline, separated by an em dash. */
function inlineField(body: string, name: string): string | undefined {
	const m = body.match(new RegExp(`(?:^|[\\s—])${name}:\\s*([^—\\n]*)`, "i"));
	return m ? m[1]!.trim() : undefined;
}

export function lintContract(text: string): LintResult {
	const errors: LintIssue[] = [];
	const warnings: LintIssue[] = [];
	const err = (rule: string, message: string, line?: number) => errors.push({ rule, message, ...(line ? { line } : {}) });
	const all = sections(text);

	const goals = find(all, "no-objetivos", "no objetivos", "non-goals");
	const specsSection = find(all, "specs");
	const tasksSection = find(all, "tasks", "tareas");
	const log = find(all, "log");

	if (!goals) err("no-objetivos", "Missing `## No-objetivos` section: say what is explicitly NOT done.");
	else if (!goals.lines.some((l) => /^\s*[-*]\s+\S/.test(l.text))) {
		err("no-objetivos", "`## No-objetivos` has no bullet. Write at least one thing that is out of scope.", goals.start);
	}
	if (!specsSection) err("specs", "Missing `## Specs` section.");
	if (!tasksSection) err("tasks", "Missing `## Tasks` section.");
	if (!log) err("log", "Missing `## Log` section.");
	else {
		const l1 = items(log, "L").find((l) => l.id === "L1");
		if (!l1 || !l1.body.trim() || PLACEHOLDER.test(l1.body.trim())) {
			err("log-l1", "`## Log` needs `L1.` with the user's original request, verbatim.", log.start);
		}
	}

	const specs = items(specsSection, "S");
	if (specsSection && specs.length === 0) err("specs", "`## Specs` has no `S#.` item.", specsSection.start);
	for (const spec of specs) {
		const accept = field(spec.body, "Accept");
		const check = field(spec.body, "Check");
		if (!accept || PLACEHOLDER.test(accept)) err("accept", `${spec.id} has no observable \`Accept:\` criterion.`, spec.line);
		if (!check || PLACEHOLDER.test(check)) err("check", `${spec.id} has no \`Check:\` (an exact command, or \`manual: <what to observe>\`).`, spec.line);
	}

	const tasks = items(tasksSection, "T");
	if (tasksSection && tasks.length === 0) err("tasks", "`## Tasks` has no `T#.` item.", tasksSection.start);
	const specIds = new Set(specs.map((s) => s.id));
	const covered = new Set<string>();
	for (const task of tasks) {
		const cited = (inlineField(task.body, "specs") ?? "").split(/[,\s]+/).filter((x) => /^S\d+$/i.test(x)).map((x) => x.toUpperCase());
		if (cited.length === 0) err("task-specs", `${task.id} cites no spec (\`specs: S1\`).`, task.line);
		for (const id of cited) {
			if (!specIds.has(id)) err("task-specs", `${task.id} cites ${id}, which does not exist.`, task.line);
			covered.add(id);
		}
		const test = (inlineField(task.body, "test") ?? "").split(/[\s(—-]/)[0]?.toLowerCase();
		if (!test || !["required", "recommended", "n/a"].includes(test)) {
			err("task-test", `${task.id} needs \`test: required|recommended|n/a\`.`, task.line);
		}
		if (!/ri(?:e|é)sgo:\s*(?:s[ií]|no)(?=\s|—|$)/i.test(task.body)) err("task-risk", `${task.id} needs \`riesgo: sí|no\` (hot path: auth, payments, deletes, parsing input, secrets, external calls).`, task.line);
	}
	for (const spec of specs) {
		if (!covered.has(spec.id)) err("uncovered-spec", `${spec.id} is covered by no task.`, spec.line);
	}

	if (EXTERNAL.test(text) && !/^\s*Externo:\s*no\b/im.test(text)) {
		const hasSpike = specs.some((s) => s.id === "S0") && tasks.some((t) => t.id === "T0");
		if (!hasSpike) {
			err("spike", "The contract names an external system but has no `S0`/`T0` spike (the thinnest end-to-end proof). Add one, or write `Externo: no`.");
		}
	}

	const lineCount = text.split("\n").length;
	if (lineCount > MAX_LINES) {
		warnings.push({ rule: "length", message: `The contract is ${lineCount} lines; one page is about ${MAX_LINES}. Split the feature, or move reasoning out of it.` });
	}

	return { ok: errors.length === 0, errors, warnings };
}

export function formatLint(result: LintResult): string {
	if (result.ok && result.warnings.length === 0) return "contract_check: OK";
	const row = (kind: string, i: LintIssue) => `${kind} [${i.rule}]${i.line ? ` line ${i.line}` : ""}: ${i.message}`;
	return [
		result.ok ? "contract_check: OK with warnings" : `contract_check: ${result.errors.length} error(s)`,
		...result.errors.map((i) => row("ERROR", i)),
		...result.warnings.map((i) => row("WARN", i)),
	].join("\n");
}
