import { test } from "node:test";
import assert from "node:assert/strict";
import { agents, guard, jobs, sidebar, todo } from "../src/i18n.ts";

test("agents card title pluralizes activos/terminados and adds fallidos only when present", () => {
	assert.equal(agents.cardTitle(1, 0, 0), "Agentes · 1 activo · 0 terminados");
	assert.equal(agents.cardTitle(2, 1, 0), "Agentes · 2 activos · 1 terminado");
	assert.equal(agents.cardTitle(0, 1, 1), "Agentes · 0 activos · 1 terminado · 1 fallido");
	assert.equal(agents.cardTitle(3, 2, 4), "Agentes · 3 activos · 2 terminados · 4 fallidos");
});

test("agents fold line and list header use the Spanish dictionary", () => {
	assert.equal(agents.fold(4, "alt+a"), "… 4 más · alt+a para ver");
	assert.equal(agents.listHeader(1, 2), "1 activo · 2 terminados");
	assert.equal(agents.listHeader(0, 1), "0 activos · 1 terminado");
});

test("agents status words map every task and tool status", () => {
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
	assert.equal(todo.cardTitle(1, 0), "Tareas · 1 abierta · 0 hechas");
	assert.equal(todo.cardTitle(3, 2), "Tareas · 3 abiertas · 2 hechas");
	assert.equal(todo.fold(2), "… 2 más");
	assert.equal(todo.fold(1), "… 1 más");
});

test("guard dialog body interpolates command and reasons", () => {
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
	assert.equal(guard.grantsRevoked(1), "Revocado 1 permiso fuera del proyecto.");
	assert.equal(guard.grantsRevoked(3), "Revocados 3 permisos fuera del proyecto.");
});

test("jobs indicator and overlay header interpolate and pluralize", () => {
	assert.equal(jobs.indicator(2), "jobs: 2 en ejecución");
	assert.equal(jobs.indicator(1), "jobs: 1 en ejecución");
	assert.equal(jobs.overlayHeader(1, 1), "Jobs · 1 en ejecución · 1 terminado");
	assert.equal(jobs.overlayHeader(2, 3), "Jobs · 2 en ejecución · 3 terminados");
	assert.equal(jobs.overlayHeader(0, 0), "Jobs · 0 en ejecución");
});

test("jobs monitor notices pluralize lines", () => {
	assert.equal(jobs.monitorReported("job-2", "watch", 1), "El monitor job-2 (watch) reportó 1 línea nueva:");
	assert.equal(jobs.monitorReported("job-2", "watch", 2), "El monitor job-2 (watch) reportó 2 líneas nuevas:");
	assert.equal(jobs.linesDropped(3), "(+3 líneas descartadas)");
});

test("sidebar markers keep their glyphs and pluralize", () => {
	assert.equal(sidebar.created(1), "+1 creado");
	assert.equal(sidebar.created(2), "+2 creados");
	assert.equal(sidebar.updated(1), "~1 modificado");
	assert.equal(sidebar.updated(5), "~5 modificados");
	assert.equal(sidebar.deleted(1), "−1 eliminado");
	assert.equal(sidebar.deleted(4), "−4 eliminados");
	assert.equal(sidebar.more(3), "+3 más");
});
