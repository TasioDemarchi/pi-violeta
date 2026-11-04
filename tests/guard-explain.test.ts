// The dangerous command turned into words. Every fixture here is an answer the
// free model really gave for the command above it, so the parser is exercised
// against what it will actually receive, not against what would be convenient.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_MAX, explainedBody, parseExplanation } from "../src/guard/explain.ts";
import { guard, setLanguage } from "../src/i18n.ts";

test("the real answers for five real commands are read into the three fields", () => {
	setLanguage("es");
	const real: [string, string, string][] = [
		[
			"rm -rf build node_modules",
			"Acción: Elimina de forma permanente una carpeta de compilación y las dependencias de un proyecto.\nArchivos: todos los archivos dentro de build y node_modules.\nCarpetas: build, node_modules.",
			"build, node_modules.",
		],
		[
			"git reset --hard origin/main",
			"Acción: Descarta todos los cambios locales no confirmados y hace que la carpeta sea idéntica a la copia de origen en el servidor.\nArchivos: Todos los archivos que difieran entre la copia local y la de origen.\nCarpetas: Ninguna.",
			"Ninguna.",
		],
		[
			'find . -name "*.tmp" -exec rm {} \;',
			"Acción: Busca y borra temporalmente los archivos que se parezcan con su terminación para limpiar el sistema.\nArchivos: los archivos que terminan en .tmp.\nCarpetas: ninguna.",
			"ninguna.",
		],
		[
			"dd if=/dev/zero of=/dev/sda bs=1M",
			"Acción: Borra todos los datos del disco duro, escribiendo ceros en su lugar.\nArchivos: /dev/zero, /dev/sda\nCarpetas: ninguna",
			"ninguna",
		],
		[
			"chmod -R 777 /home/tachii",
			"Acción: Da permisos de lectura, escritura y ejecución a todos los archivos y carpetas para cualquier usuario.\nArchivos: todos los archivos dentro de /home/tachii.\nCarpetas: /home/tachii y todas sus subcarpetas.",
			"/home/tachii y todas sus subcarpetas.",
		],
	];
	for (const [command, answer, folders] of real) {
		const explanation = parseExplanation(answer);
		assert.ok(explanation, `no explanation for ${command}`);
		assert.ok(explanation.action.length > 0, command);
		assert.ok(explanation.files, command);
		assert.equal(explanation.folders, folders, command);
	}
});

test("the model's decoration is stripped: bullets, bold, dashes and spacing", () => {
	setLanguage("es");
	const explanation = parseExplanation("**Acción:** Borra la carpeta\n- Archivos: ninguno\n  *  Carpetas: build");
	assert.deepEqual(explanation, { action: "Borra la carpeta", files: "ninguno", folders: "build" });
});

test("accents and case in the labels do not matter, since the model's do not", () => {
	setLanguage("es");
	assert.equal(parseExplanation("ACCION: borra todo")?.action, "borra todo");
	assert.equal(parseExplanation("accion: borra todo")?.action, "borra todo");
	assert.equal(parseExplanation("Acción: borra todo")?.action, "borra todo");
});

test("an answer without the action is no answer: the caller shows the command", () => {
	setLanguage("es");
	assert.equal(parseExplanation(""), undefined);
	assert.equal(parseExplanation("Archivos: a.txt\nCarpetas: build"), undefined, "paths alone are what the command already was");
	assert.equal(parseExplanation("Claro, con gusto te explico este comando."), undefined);
	assert.equal(parseExplanation("Acción:"), undefined, "a label with nothing after it is not an explanation");
});

test("an answer in the wrong language does not reach the dialog", () => {
	// The labels are the dictionary's own words, so this needs no language
	// detector: "Action:" is simply not "Acción:".
	setLanguage("es");
	assert.equal(parseExplanation("Action: Deletes the build folder\nFiles: none\nFolders: build"), undefined);
	try {
		setLanguage("en");
		assert.equal(parseExplanation("Action: Deletes the build folder\nFiles: none\nFolders: build")?.action, "Deletes the build folder");
		assert.equal(parseExplanation("Acción: Borra la carpeta"), undefined);
	} finally {
		setLanguage("es");
	}
});

test("a model that writes an essay cannot push the Yes/No off the screen", () => {
	setLanguage("es");
	const long = "x".repeat(FIELD_MAX + 50);
	const explanation = parseExplanation(`Acción: ${long}`);
	assert.ok(explanation);
	assert.equal(explanation.action.length, FIELD_MAX + 1, "cut to the ceiling plus the ellipsis");
	assert.ok(explanation.action.endsWith("…"));
});

test("only the first line of each label counts, so a repeat cannot overwrite it", () => {
	setLanguage("es");
	const explanation = parseExplanation("Acción: lo primero\nAcción: lo segundo");
	assert.equal(explanation?.action, "lo primero");
});

test("the dialog shows the summary first and the command underneath, not instead", () => {
	setLanguage("es");
	const body = explainedBody(
		{ action: "Borra dos carpetas con todo su contenido", files: "ninguno", folders: "build, node_modules" },
		"rm -rf build node_modules",
		["borrado recursivo de archivos"],
	);
	assert.equal(
		body,
		[
			"Acción: Borra dos carpetas con todo su contenido",
			"Archivos: ninguno",
			"Carpetas: build, node_modules",
			"",
			"Motivo: borrado recursivo de archivos.",
			"Comando: rm -rf build node_modules",
			"",
			"¿Ejecutarlo igual?",
		].join("\n"),
	);
	// The summary is written by a model that can be wrong, so the real command
	// must survive to the dialog.
	assert.ok(body.includes("rm -rf build node_modules"));
});

test("the missing fields are left out instead of printed empty", () => {
	setLanguage("es");
	const body = explainedBody({ action: "Apaga la máquina" }, "shutdown now", ["apagado del sistema"]);
	assert.ok(!body.includes("Archivos"));
	assert.ok(!body.includes("Carpetas"));
	assert.ok(body.startsWith("Acción: Apaga la máquina"));
});

test("the prompt asks for exactly the three labels the parser looks for", () => {
	// The one thing that would break this silently: renaming a label in the
	// dictionary and forgetting the prompt, leaving every answer unparsable.
	for (const language of ["es", "en"] as const) {
		try {
			setLanguage(language);
			const prompt = guard.explainPrompt("rm -rf build");
			for (const label of Object.values(guard.explainLabels)) {
				assert.ok(prompt.includes(`${label}:`), `${language}: the prompt never asks for ${label}`);
			}
			assert.ok(prompt.includes("rm -rf build"), `${language}: the command itself must be in the prompt`);
		} finally {
			setLanguage("es");
		}
	}
});
