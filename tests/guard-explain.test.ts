// The dangerous command turned into words. Every fixture here is an answer the
// free model really gave for the command above it, so the parser is exercised
// against what it will actually receive, not against what would be convenient.
// The screen is English, so the labels are English; the content of each line is
// Spanish, because that is what the owner reads and what the prompt asks for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_MAX, explainedBody, parseExplanation } from "../src/guard/explain.ts";
import { guard } from "../src/i18n.ts";

test("the real answers for five real commands are read into the three fields", () => {
	const real: [string, string, string][] = [
		[
			"rm -rf build node_modules",
			"Action: Elimina de forma permanente una carpeta de compilación y las dependencias de un proyecto.\nFiles: todos los archivos dentro de build y node_modules.\nFolders: build, node_modules.",
			"build, node_modules.",
		],
		[
			"git reset --hard origin/main",
			"Action: Descarta todos los cambios locales no confirmados y hace que la carpeta sea idéntica a la copia de origen en el servidor.\nFiles: Todos los archivos que difieran entre la copia local y la de origen.\nFolders: Ninguna.",
			"Ninguna.",
		],
		[
			'find . -name "*.tmp" -exec rm {} \;',
			"Action: Busca y borra temporalmente los archivos que se parezcan con su terminación para limpiar el sistema.\nFiles: los archivos que terminan en .tmp.\nFolders: ninguna.",
			"ninguna.",
		],
		[
			"dd if=/dev/zero of=/dev/sda bs=1M",
			"Action: Borra todos los datos del disco duro, escribiendo ceros en su lugar.\nFiles: /dev/zero, /dev/sda\nFolders: ninguna",
			"ninguna",
		],
		[
			"chmod -R 777 /home/tachii",
			"Action: Da permisos de lectura, escritura y ejecución a todos los archivos y carpetas para cualquier usuario.\nFiles: todos los archivos dentro de /home/tachii.\nFolders: /home/tachii y todas sus subcarpetas.",
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
	const explanation = parseExplanation("**Action:** Borra la carpeta\n- Files: ninguno\n  *  Folders: build");
	assert.deepEqual(explanation, { action: "Borra la carpeta", files: "ninguno", folders: "build" });
});

test("case in the labels does not matter, since the model's does not", () => {
	assert.equal(parseExplanation("ACTION: borra todo")?.action, "borra todo");
	assert.equal(parseExplanation("action: borra todo")?.action, "borra todo");
	assert.equal(parseExplanation("Action: borra todo")?.action, "borra todo");
});

test("an answer without the action is no answer: the caller shows the command", () => {
	assert.equal(parseExplanation(""), undefined);
	assert.equal(parseExplanation("Files: a.txt\nFolders: build"), undefined, "paths alone are what the command already was");
	assert.equal(parseExplanation("Claro, con gusto te explico este comando."), undefined);
	assert.equal(parseExplanation("Action:"), undefined, "a label with nothing after it is not an explanation");
});

test("an answer that uses the Spanish labels is still read", () => {
	// The prompt asks for the English labels, but the cheap guard model
	// sometimes answers with its own: those three words are synonyms, not a
	// reason to throw the explanation away.
	assert.deepEqual(
		parseExplanation("Acción: Borra la carpeta\nArchivos: ninguno\nCarpetas: build"),
		{ action: "Borra la carpeta", files: "ninguno", folders: "build" },
	);
	// Accents and case are flattened away, so every spelling of the same word
	// lands on the same label.
	assert.equal(parseExplanation("ACCION: borra todo")?.action, "borra todo");
	assert.equal(parseExplanation("accion: borra todo")?.action, "borra todo");
	// What the prompt asks for: the English labels, the content in Spanish.
	assert.equal(parseExplanation("Action: Borra la carpeta build\nFiles: ninguno\nFolders: build")?.action, "Borra la carpeta build");
});

test("a label nobody asked for is still not an explanation", () => {
	// The aliases are a closed list: an answer under an unrelated label is
	// exactly the mangled answer the caller must not show.
	assert.equal(parseExplanation("Answer: Elimina la carpeta"), undefined);
	assert.equal(parseExplanation("Answer: Elimina la carpeta\nFiles: ninguno"), undefined);
});

test("a model that writes an essay cannot push the Yes/No off the screen", () => {
	const long = "x".repeat(FIELD_MAX + 50);
	const explanation = parseExplanation(`Action: ${long}`);
	assert.ok(explanation);
	assert.equal(explanation.action.length, FIELD_MAX + 1, "cut to the ceiling plus the ellipsis");
	assert.ok(explanation.action.endsWith("…"));
});

test("only the first line of each label counts, so a repeat cannot overwrite it", () => {
	const explanation = parseExplanation("Action: lo primero\nAction: lo segundo");
	assert.equal(explanation?.action, "lo primero");
});

test("the dialog shows the summary first and the command underneath, not instead", () => {
	const body = explainedBody(
		{ action: "Borra dos carpetas con todo su contenido", files: "ninguno", folders: "build, node_modules" },
		"rm -rf build node_modules",
		["recursive file removal"],
	);
	assert.equal(
		body,
		[
			"Action: Borra dos carpetas con todo su contenido",
			"Files: ninguno",
			"Folders: build, node_modules",
			"",
			"Why: recursive file removal.",
			"Command: rm -rf build node_modules",
			"",
			"Run it anyway?",
		].join("\n"),
	);
	// The summary is written by a model that can be wrong, so the real command
	// must survive to the dialog.
	assert.ok(body.includes("rm -rf build node_modules"));
});

test("the missing fields are left out instead of printed empty", () => {
	const body = explainedBody({ action: "Apaga la máquina" }, "shutdown now", ["system shutdown"]);
	assert.ok(!body.includes("Files"));
	assert.ok(!body.includes("Folders"));
	assert.ok(body.startsWith("Action: Apaga la máquina"));
});

test("the prompt asks for the explanation in Spanish while keeping the English labels", () => {
	// The dialog and the parser are English, the explanation is for the owner:
	// Spanish content under the three labels the dictionary already uses.
	const prompt = guard.explainPrompt("rm -rf build");
	assert.match(prompt, /in spanish/i, "the explanation itself must come back in Spanish");
	assert.doesNotMatch(prompt, /in english/i, "nothing asks for an English explanation");
	// The labels are the parser's contract, so the Spanish content must still
	// be read out of them.
	const parsed = parseExplanation("Action: Borra la carpeta build\nFiles: ninguno\nFolders: build");
	assert.equal(parsed?.action, "Borra la carpeta build");
});

test("the prompt asks for exactly the three labels the parser looks for", () => {
	// The one thing that would break this silently: renaming a label in the
	// dictionary and forgetting the prompt, leaving every answer unparsable.
	const prompt = guard.explainPrompt("rm -rf build");
	for (const label of Object.values(guard.explainLabels)) {
		assert.ok(prompt.includes(`${label}:`), `the prompt never asks for ${label}`);
	}
	assert.ok(prompt.includes("rm -rf build"), "the command itself must be in the prompt");
});
