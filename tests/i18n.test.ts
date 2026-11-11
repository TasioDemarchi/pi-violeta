/**
 * One dictionary, English, and nothing else (S4). Its sections ARE the
 * exports: no language switch, no second copy, no lookup at access time. These
 * tests assert the strings the screen actually shows, one expectation per test.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import * as i18n from "../src/i18n.ts";
import { agents, btw, context, guard, palette, sidebar, todo, usage } from "../src/i18n.ts";

test("the guard dialog offers Yes and No", () => {
	assert.equal(guard.yes, "Yes");
	assert.equal(guard.no, "No");
});

test("the sidebar section titles are the English ones", () => {
	assert.equal(sidebar.changes, "CHANGES");
	assert.equal(sidebar.tasks, "TASKS");
	assert.equal(sidebar.modelUsage, "MODEL · USAGE");
});

test("the todo card and its messages speak English", () => {
	assert.equal(todo.cardTitle(3, 2), "Todo · 3 open · 2 done");
	assert.equal(todo.fold(2), "… 2 more");
	assert.equal(todo.empty, "No tasks.");
	assert.equal(todo.unknownStatus("doing"), 'unknown status "doing" (use pending, in_progress, blocked, done, or dropped)');
	assert.equal(todo.unknownAction("purge"), 'unknown action "purge" (use write, add, update, clear, or list)');
	assert.equal(todo.shown, "Todo card shown.");
	assert.equal(todo.hidden, "Todo card hidden.");
});

test("the agents card, its statuses and its fold line speak English", () => {
	assert.equal(agents.statuses.queued, "queued");
	assert.equal(agents.statuses.failed, "failed");
	assert.equal(agents.toolStatuses.done, "done");
	assert.equal(agents.cardTitle(3, 2, 4), "Agents · 3 active · 2 done · 4 failed");
	assert.equal(agents.fold(4, "alt+a"), "… 4 more · alt+a to view");
	assert.equal(agents.listHeader(1, 2), "1 active · 2 finished");
	assert.equal(agents.inProgress, "in progress…");
});

test("the usage report speaks English", () => {
	assert.equal(usage.title(1), "Session usage · 1 reply");
	assert.equal(usage.title(2), "Session usage · 2 replies");
	assert.equal(usage.tokens("1.2k", "300", "$0.004"), "In 1.2k · Out 300 · Cost $0.004");
	assert.equal(usage.cache("1k", "200"), "Cache: 1k read · 200 written");
	assert.equal(usage.byModel, "By model:");
});

test("the context report speaks English", () => {
	assert.equal(context.line("42%", "64k"), "Context: 42% of 64k tokens.");
	assert.equal(context.usedFree("27k", "37k"), "Used 27k · Free 37k");
	assert.equal(context.compactSuggest, "Context is at 80%. Consider /compact.");
});

test("the command palette speaks English", () => {
	assert.equal(palette.title, "Command palette");
	assert.equal(palette.empty, "No matches.");
	assert.equal(palette.groups.tools, "Tools");
	assert.equal(palette.shortcuts.stop, "stop agents");
});

test("the side chat speaks English", () => {
	assert.equal(btw.title, "By the way");
	assert.equal(btw.thinking, "thinking…");
	assert.equal(btw.opened, "Side chat open.");
	assert.equal(btw.cleared, "Side chat: conversation cleared.");
	assert.equal(btw.noModel, "No active model: the side chat cannot ask.");
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

/** Recursive shape check: every entry of every section is a non-empty string
 * or a function that returns one for sample arguments. */
function walk(value: unknown, path: string): void {
	if (typeof value === "function") {
		for (const args of candidateArgs((value as { length: number }).length)) {
			let out: unknown;
			try {
				out = (value as (...a: unknown[]) => unknown)(...args);
			} catch {
				continue;
			}
			assert.equal(typeof out, "string", `${path}(...) must return a string`);
			assert.ok((out as string).length > 0, `${path}(...) must return a non-empty string`);
			return;
		}
		assert.fail(`no candidate arguments produced a string for ${path}`);
	}
	if (typeof value === "string") {
		assert.ok(value.length > 0, `${path} must be a non-empty string`);
		return;
	}
	assert.equal(typeof value, "object", `${path} must be an object, a string or a function`);
	for (const key of Object.keys(value as Record<string, unknown>)) {
		walk((value as Record<string, unknown>)[key], path ? `${path}.${key}` : key);
	}
}

test("every dictionary entry is a non-empty string or a function that returns one", () => {
	const sections = Object.keys(i18n);
	assert.ok(sections.length > 0, "the dictionary exports at least one section");
	for (const section of sections) walk((i18n as unknown as Record<string, unknown>)[section], section);
});

test("both model-facing strings ask for Spanish answers and keep the English labels", () => {
	assert.match(btw.systemPrompt, /answer in spanish/i, "the aside must ask for a Spanish answer");
	assert.doesNotMatch(btw.systemPrompt, /answer in english/i, "and must not ask for an English one");

	const prompt = guard.explainPrompt("rm -rf build");
	assert.match(prompt, /in spanish/i, "the explanation itself must come back in Spanish");
	assert.doesNotMatch(prompt, /in english/i, "nothing asks for an English explanation");
	assert.ok(prompt.includes("rm -rf build"), "the command itself must be in the prompt");
	assert.deepEqual(Object.values(guard.explainLabels), ["Action", "Files", "Folders"], "the parser's labels stay English");
	for (const label of Object.values(guard.explainLabels)) {
		assert.ok(prompt.includes(`${label}:`), `the prompt never asks for ${label}`);
	}
});
