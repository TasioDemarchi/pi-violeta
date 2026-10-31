import { test } from "node:test";
import assert from "node:assert/strict";
import { agents, guard, guardReasons, jobs, sidebar, todo, ui, activity, getLanguage, setLanguage } from "../src/i18n.ts";

test("agents card title pluralizes activos/terminados and adds fallidos only when present", () => {
	setLanguage("es");
	assert.equal(agents.cardTitle(1, 0, 0), "Agentes · 1 activo · 0 terminados");
	assert.equal(agents.cardTitle(2, 1, 0), "Agentes · 2 activos · 1 terminado");
	assert.equal(agents.cardTitle(0, 1, 1), "Agentes · 0 activos · 1 terminado · 1 fallido");
	assert.equal(agents.cardTitle(3, 2, 4), "Agentes · 3 activos · 2 terminados · 4 fallidos");
});

test("agents fold line and list header use the Spanish dictionary", () => {
	setLanguage("es");
	assert.equal(agents.fold(4, "alt+a"), "… 4 más · alt+a para ver");
	assert.equal(agents.listHeader(1, 2), "1 activo · 2 terminados");
	assert.equal(agents.listHeader(0, 1), "0 activos · 1 terminado");
});

test("agents status words map every task and tool status", () => {
	setLanguage("es");
	assert.equal(agents.statuses.queued, "en cola");
	assert.equal(agents.statuses.running, "en curso");
	assert.equal(agents.statuses.completed, "completado");
	assert.equal(agents.statuses.failed, "fallido");
	assert.equal(agents.statuses.aborted, "abortado");
	assert.equal(agents.toolStatuses.running, "en curso");
	assert.equal(agents.toolStatuses.done, "listo");
	assert.equal(agents.toolStatuses.error, "error");
});

test("todo card title and fold line pluralize", () => {
	setLanguage("es");
	assert.equal(todo.cardTitle(1, 0), "Tareas · 1 abierta · 0 hechas");
	assert.equal(todo.cardTitle(3, 2), "Tareas · 3 abiertas · 2 hechas");
	assert.equal(todo.fold(2), "… 2 más");
	assert.equal(todo.fold(1), "… 1 más");
});

test("guard dialog body interpolates command and reasons", () => {
	setLanguage("es");
	assert.equal(
		guard.destructiveBody("rm -rf build", ["borrado recursivo de archivos"]),
		"rm -rf build\n\nMotivo: borrado recursivo de archivos. ¿Ejecutarlo igual?",
	);
	assert.equal(
		guard.destructiveBody("x", ["a", "b"]),
		"x\n\nMotivo: a; b. ¿Ejecutarlo igual?",
	);
	assert.equal(guard.outsideBody("/tmp/otro"), "¿Permitir acceso fuera del proyecto: /tmp/otro? El permiso dura solo esta sesión.");
});

test("guard grant notifications pluralize", () => {
	setLanguage("es");
	assert.equal(guard.grantsRevoked(1), "Revocado 1 permiso fuera del proyecto.");
	assert.equal(guard.grantsRevoked(3), "Revocados 3 permisos fuera del proyecto.");
});

test("jobs indicator and overlay header interpolate and pluralize", () => {
	setLanguage("es");
	assert.equal(jobs.indicator(2), "jobs: 2 en ejecución");
	assert.equal(jobs.indicator(1), "jobs: 1 en ejecución");
	assert.equal(jobs.overlayHeader(1, 1), "Jobs · 1 en ejecución · 1 terminado");
	assert.equal(jobs.overlayHeader(2, 3), "Jobs · 2 en ejecución · 3 terminados");
	assert.equal(jobs.overlayHeader(0, 0), "Jobs · 0 en ejecución");
});

test("jobs monitor notices pluralize lines", () => {
	setLanguage("es");
	assert.equal(jobs.monitorReported("job-2", "watch", 1), "El monitor job-2 (watch) reportó 1 línea nueva:");
	assert.equal(jobs.monitorReported("job-2", "watch", 2), "El monitor job-2 (watch) reportó 2 líneas nuevas:");
	assert.equal(jobs.linesDropped(3), "(+3 líneas descartadas)");
});

test("sidebar markers keep their glyphs and pluralize", () => {
	setLanguage("es");
	assert.equal(sidebar.created(1), "+1 creado");
	assert.equal(sidebar.created(2), "+2 creados");
	assert.equal(sidebar.updated(1), "~1 modificado");
	assert.equal(sidebar.updated(5), "~5 modificados");
	assert.equal(sidebar.deleted(1), "−1 eliminado");
	assert.equal(sidebar.deleted(4), "−4 eliminados");
	assert.equal(sidebar.tasks, "TAREAS");
	assert.equal(sidebar.ellipsis, "…");
});

// --- Language switching (S3) ---------------------------------------------------

test("the language defaults to es and setLanguage/getLanguage round-trip", () => {
	setLanguage("es");
	assert.equal(getLanguage(), "es");
	setLanguage("en");
	assert.equal(getLanguage(), "en");
	setLanguage("es");
	assert.equal(getLanguage(), "es");
});

/** Candidate argument lists by function arity; the first one that runs without
 * throwing proves the entry returns a non-empty string. */
function candidateArgs(arity: number): unknown[][] {
	switch (arity) {
		case 0: return [[]];
		case 1: return [[5], ["sample"], [["a", "b"]]];
		case 2: return [[5, ["a", "b"]], ["sample", ["a", "b"]], [5, "sample"], ["a", "b"]];
		case 3: return [[1, 2, 3]];
		case 4: return [[1, 2, 3, "sample"]];
		default: return [Array.from({ length: arity }, (_, i) => i + 1)];
	}
}

/** Recursive shape check: identical key sets, and every entry is a non-empty
 * string or a function returning one for sample arguments (both languages). */
function walk(esValue: unknown, enValue: unknown, path: string): void {
	if (typeof esValue === "function") {
		assert.equal(typeof enValue, "function", `en.${path} must be a function`);
		assert.equal((esValue as { length: number }).length, (enValue as { length: number }).length, `arity mismatch at ${path}`);
		for (const args of candidateArgs((esValue as { length: number }).length)) {
			let esOut: unknown;
			try {
				esOut = (esValue as (...a: unknown[]) => unknown)(...args);
			} catch {
				continue;
			}
			const enOut = (enValue as (...a: unknown[]) => unknown)(...args);
			assert.equal(typeof esOut, "string", `es.${path}(...) must return a string`);
			assert.ok((esOut as string).length > 0, `es.${path}(...) must return a non-empty string`);
			assert.equal(typeof enOut, "string", `en.${path}(...) must return a string`);
			assert.ok((enOut as string).length > 0, `en.${path}(...) must return a non-empty string`);
			return;
		}
		assert.fail(`no candidate arguments produced a string for ${path}`);
	}
	if (typeof esValue === "string") {
		assert.equal(typeof enValue, "string", `en.${path} must be a string`);
		assert.ok(esValue.length > 0, `es.${path} must be non-empty`);
		assert.ok((enValue as string).length > 0, `en.${path} must be non-empty`);
		return;
	}
	assert.equal(typeof esValue, "object", `es.${path} must be an object, string or function`);
	assert.equal(typeof enValue, "object", `en.${path} must be an object`);
	assert.deepEqual(Object.keys(esValue as object), Object.keys(enValue as object), `key sets differ at ${path}`);
	for (const key of Object.keys(esValue as object)) {
		walk((esValue as Record<string, unknown>)[key], (enValue as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
	}
}

/** Shallow-copy every namespace with the ACTIVE language (the proxies resolve
 * at access time, so the spread captures that dictionary's entries). */
function snapshot(): Record<string, Record<string, unknown>> {
	return {
		guardReasons: { ...guardReasons },
		guard: { ...guard },
		agents: { ...agents },
		todo: { ...todo },
		jobs: { ...jobs },
		sidebar: { ...sidebar },
		ui: { ...ui },
		activity: { ...activity },
	};
}

test("es and en dictionaries have the same key set and every entry is usable", () => {
	try {
		setLanguage("es");
		const esDict = snapshot();
		setLanguage("en");
		const enDict = snapshot();
		setLanguage("es");
		assert.deepEqual(Object.keys(esDict), Object.keys(enDict));
		for (const area of Object.keys(esDict)) {
			assert.deepEqual(Object.keys(esDict[area]!), Object.keys(enDict[area]!), `top-level keys differ in ${area}`);
			walk(esDict[area], enDict[area], area);
		}
	} finally {
		setLanguage("es");
	}
});

test("the English dictionary reproduces the original English guard strings", () => {
	try {
		setLanguage("en");
		assert.equal(guardReasons.recursiveRemoval, "recursive file removal");
		assert.equal(guardReasons.forcedRemoval, "forced file removal");
		assert.equal(guardReasons.ddDevice, "dd writes to a device");
		assert.equal(guardReasons.gitForcePush, "git force push");
		assert.equal(guardReasons.gitCheckoutWholeTree, "git checkout of the whole tree");
		assert.equal(guardReasons.gitRestoreWholeTree, "git restore of the whole tree");
		assert.equal(guardReasons.sqlDropTruncate, "SQL DROP/TRUNCATE statement");
		assert.equal(guardReasons.sqlDeleteWithoutWhere, "DELETE without WHERE");
		assert.equal(guardReasons.recursiveBroadPath("chmod"), "recursive chmod on a broad path");
		assert.equal(guard.yes, "Yes");
		assert.equal(guard.no, "No");
		assert.equal(guard.destructiveTitle, "Destructive command");
		assert.equal(guard.destructiveBody("rm -rf build", ["recursive file removal"]), "rm -rf build\n\nWhy: recursive file removal. Run it anyway?");
		assert.equal(guard.declined("rm -rf build"), "The user declined this destructive command: rm -rf build. Find a safer way.");
		assert.equal(guard.blocked(["recursive file removal"]), "Blocked: recursive file removal. No interactive user is available to approve it.");
		assert.equal(guard.catastrophic("recursive file removal"), "Catastrophic target denied without a prompt: recursive file removal.");
		assert.equal(guard.outsideTitle, "Outside-project access");
		assert.equal(guard.outsideBody("/tmp/x"), "Allow access outside the project: /tmp/x? The grant lasts only for this session.");
		assert.equal(
			guard.outsideNeedsGrant("/tmp/x", "/repo"),
			"Access outside the project (/tmp/x) needs a grant and there is no UI to ask. Grant it in an interactive session, or keep work inside /repo.",
		);
		assert.equal(guard.outsideDeclined("/tmp/x", "/repo"), "Access to /tmp/x was not approved. Stay inside /repo or ask the user to grant it.");
		assert.equal(guard.grantsRevoked(3), "Revoked 3 outside-project grant(s).");
	} finally {
		setLanguage("es");
	}
});

test("the English dictionary reproduces the original English agents strings", () => {
	try {
		setLanguage("en");
		assert.equal(agents.statuses.queued, "queued");
		assert.equal(agents.statuses.completed, "completed");
		assert.equal(agents.toolStatuses.done, "done");
		assert.equal(agents.cardTitle(1, 0, 0), "Agents · 1 active · 0 done");
		assert.equal(agents.cardTitle(3, 2, 4), "Agents · 3 active · 2 done · 4 failed");
		assert.equal(agents.fold(4, "alt+a"), "… 4 more · alt+a to view");
		assert.equal(agents.listHeader(1, 2), "1 active · 2 finished");
		assert.equal(agents.listHeader(0, 0), "0 active · 0 finished");
		assert.equal(agents.sectionResult, "── Result ──");
		assert.equal(agents.sectionThread, "── Thread ──");
		assert.equal(agents.inProgress, "in progress…");
		assert.equal(agents.hint("split"), "j/k task  ctrl+j/k scroll  f follow  esc back  q close");
		assert.equal(agents.hint("narrow"), "j/k select  enter thread  esc back  q close");
		assert.equal(agents.finishedMessage("Do it", "coder", "t1", "completed"), "Subagent finished: Do it (coder, t1)\nStatus: completed");
		assert.equal(agents.taskStatusWord("failed"), "task failed");
		assert.equal(agents.cancelled("t1"), "Cancelled task t1.");
		assert.equal(agents.notCancellable("t1"), "Task t1 cannot be cancelled (unknown id or already finished).");
	} finally {
		setLanguage("es");
	}
});

test("the English dictionary reproduces the original English todo, jobs, sidebar and activity strings", () => {
	try {
		setLanguage("en");
		assert.equal(todo.cardTitle(3, 2), "Todo · 3 open · 2 done");
		assert.equal(todo.fold(2), "… 2 more");
		assert.equal(todo.empty, "No tasks.");
		assert.equal(todo.blockedNeedsNote, "blocked needs a note naming what it waits for");
		assert.equal(todo.titleRequired, "title is required");
		assert.equal(todo.noTask(9), "no task #9");
		assert.equal(todo.nothingToUpdate, "nothing to update: pass status, title, or note");
		assert.equal(todo.unknownStatus("doing"), 'unknown status "doing" (use pending, in_progress, blocked, done, or dropped)');
		assert.equal(todo.unknownAction("purge"), 'unknown action "purge" (use write, add, update, clear, or list)');
		assert.equal(todo.shown, "Todo card shown.");
		assert.equal(todo.hidden, "Todo card hidden.");

		assert.equal(jobs.jobRunning, "running");
		assert.equal(jobs.jobStopped, "stopped");
		assert.equal(jobs.jobFailed("boom"), "failed: boom");
		assert.equal(jobs.jobSignal("SIGTERM"), "killed by signal SIGTERM");
		assert.equal(jobs.jobExited(0), "exited with code 0");
		assert.equal(jobs.indicator(2), "jobs: 2 running");
		assert.equal(jobs.overlayHeader(1, 1), "Jobs · 1 running · 1 finished");
		assert.equal(jobs.overlayHeader(0, 0), "Jobs · 0 running");
		assert.equal(jobs.listEmpty, "No jobs.");
		assert.equal(jobs.listEmptyHint, "No jobs. Start one with bash_background or monitor.");
		assert.equal(jobs.confirmStop("job-1", "build check"), "s again to stop job-1 (build check)");
		assert.equal(jobs.hint, "j/k select  s stop  q close");
		assert.equal(jobs.jobStart("job-1", "build check", "/tmp/x.log"), "Started job job-1 (build check). Output: /tmp/x.log");
		assert.equal(jobs.monitorStart("job-2", "watch", 20, "/tmp/x.log"), "Started monitor job-2 (watch) for up to 20s. Output: /tmp/x.log");
		assert.equal(jobs.monitorReported("job-2", "watch", 1), "Monitor job-2 (watch) reported 1 new line:");
		assert.equal(jobs.monitorReported("job-2", "watch", 2), "Monitor job-2 (watch) reported 2 new lines:");
		assert.equal(jobs.linesDropped(3), "(+3 lines dropped)");
		assert.equal(jobs.capError(25), "At most 25 jobs can run at once; stop one with job_stop first.");
		assert.equal(jobs.timeoutSecondsInvalid(1800), "timeout_seconds is required and must be a whole number from 1 to 1800.");
		assert.equal(jobs.jobStopUnknown("job-9"), "Unknown job id job-9. Use job_list to see the current jobs.");
		assert.equal(jobs.jobStopNotRunning("job-1", "build check", "finished"), "Job job-1 (build check) is not running anymore: finished.");
		assert.equal(jobs.jobStoppedNotice("job-1", "build check"), "Stopped job job-1 (build check).");

		assert.equal(sidebar.project, "PROJECT");
		assert.equal(sidebar.changes, "CHANGES");
		assert.equal(sidebar.tasks, "TASKS");
		assert.equal(sidebar.model, "MODEL");
		assert.equal(sidebar.usage, "USAGE");
		assert.equal(sidebar.noRepo, "no repo");
		assert.equal(sidebar.clean, "clean");
		assert.equal(sidebar.noModel, "no model");
		assert.equal(sidebar.created(1), "+1 created");
		assert.equal(sidebar.created(2), "+2 created");
		assert.equal(sidebar.updated(2), "~2 updated");
		assert.equal(sidebar.deleted(4), "−4 deleted");
		assert.equal(sidebar.ellipsis, "…");

		assert.equal(activity.phases.thinking, "thinking");
		assert.equal(activity.phases.exploring, "exploring");
		assert.equal(activity.phases.implementing, "implementing");
		assert.equal(activity.phases.checking, "checking");
		assert.equal(activity.phases.running, "running");

		assert.equal(ui.languageSet, "Language: English");
		assert.equal(ui.languageUsage, "usage: /idioma [es|en]");
	} finally {
		setLanguage("es");
	}
});

test("switching back to es restores the Spanish dictionary everywhere", () => {
	try {
		setLanguage("en");
		setLanguage("es");
		assert.equal(guard.yes, "Sí");
		assert.equal(agents.cardTitle(1, 0, 0), "Agentes · 1 activo · 0 terminados");
		assert.equal(todo.cardTitle(3, 2), "Tareas · 3 abiertas · 2 hechas");
		assert.equal(jobs.indicator(2), "jobs: 2 en ejecución");
		assert.equal(sidebar.project, "PROYECTO");
		assert.equal(sidebar.changes, "CAMBIOS");
		assert.equal(sidebar.tasks, "TAREAS");
		assert.equal(sidebar.model, "MODELO");
		assert.equal(sidebar.usage, "USO");
		assert.equal(activity.phases.checking, "verificando");
		assert.equal(ui.languageSet, "Idioma: Español");
		assert.equal(ui.languageUsage, "uso: /idioma [es|en]");
	} finally {
		setLanguage("es");
	}
});
