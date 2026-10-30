import { test } from "node:test";
import assert from "node:assert/strict";
import {
	TITLE_MAX,
	SUMMARY_MAX,
	displayTitle,
	extractSummary,
	fallbackTitle,
	firstLine,
	taskTitle,
} from "../src/agents/summary.ts";

test("taskTitle prefers the explicit label and falls back to the task's first sentence", () => {
	assert.equal(taskTitle("Read note.txt", "read note.txt and report"), "Read note.txt");
	assert.equal(taskTitle("   ", "Corregir parser de git status. Luego revisar el resto."), "Corregir parser de git status.");
	assert.equal(taskTitle(undefined, "Corregir parser de git status. Luego revisar el resto."), "Corregir parser de git status.");
	assert.equal(taskTitle(undefined, "first line only"), "first line only");
});

test("fallbackTitle takes the first non-empty line and its first sentence", () => {
	assert.equal(fallbackTitle("Corregir parser de git status. Después documentar."), "Corregir parser de git status.");
	assert.equal(fallbackTitle("\n  \nsecond line first"), "second line first");
	assert.equal(fallbackTitle("no terminator here"), "no terminator here");
	// a dot not followed by whitespace does not end the sentence
	assert.equal(fallbackTitle("Fix the v1.2 bug today"), "Fix the v1.2 bug today");
});

test("fallbackTitle trims to 60 chars and never invents content", () => {
	assert.equal(fallbackTitle("x".repeat(100)).length, TITLE_MAX);
	assert.equal(fallbackTitle("y".repeat(100)), "y".repeat(TITLE_MAX));
	assert.equal(fallbackTitle(""), "");
});

test("extractSummary uses the summary: line when present", () => {
	assert.equal(extractSummary("step one\nsummary: mapped the footer sources\nmore detail"), "mapped the footer sources");
	assert.equal(extractSummary("SUMMARY: upper case works"), "upper case works");
});

test("extractSummary falls back to the first non-empty line and caps at 200 chars", () => {
	assert.equal(extractSummary("\n  \nThe first real line\nsecond"), "The first real line");
	assert.equal(extractSummary("y".repeat(300)), "y".repeat(SUMMARY_MAX));
	assert.equal(extractSummary("   "), undefined);
	assert.equal(extractSummary(undefined), undefined);
});

test("firstLine takes the first line of an error or abort reason", () => {
	assert.equal(firstLine("pi exited with code 1 before settling\nstderr: boom"), "pi exited with code 1 before settling");
	assert.equal(firstLine("just one"), "just one");
	assert.equal(firstLine(undefined), undefined);
	assert.equal(firstLine("  \n"), undefined);
});

test("displayTitle falls back title -> label -> name", () => {
	assert.equal(displayTitle({ title: "T", label: "L", name: "N" }), "T");
	assert.equal(displayTitle({ label: "L", name: "N" }), "L");
	assert.equal(displayTitle({ name: "N" }), "N");
});
