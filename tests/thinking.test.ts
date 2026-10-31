import assert from "node:assert/strict";
import { test } from "node:test";
import { modelWithThinking, thinkingRole } from "../src/thinking.ts";

// Fake fg that exposes the role: `<role:text>`.
const fg = (role: string, text: string) => `<${role}:${text}>`;

test("each thinking level maps to its own theme role", () => {
	assert.equal(thinkingRole("off"), "thinkingOff");
	assert.equal(thinkingRole("minimal"), "thinkingMinimal");
	assert.equal(thinkingRole("low"), "thinkingLow");
	assert.equal(thinkingRole("medium"), "thinkingMedium");
	assert.equal(thinkingRole("high"), "thinkingHigh");
	assert.equal(thinkingRole("xhigh"), "thinkingXhigh");
});

test("unknown levels fall back to muted", () => {
	assert.equal(thinkingRole("whatever"), "muted");
	assert.equal(thinkingRole(undefined), "muted");
});

test("model and level render as `model · level` with the level colored", () => {
	assert.equal(modelWithThinking("claude-sonnet-5-5", "medium", fg), "<text:claude-sonnet-5-5> <dim:·> <thinkingMedium:medium>");
});

test("without a level only the model shows; without a model the placeholder", () => {
	assert.equal(modelWithThinking("m", undefined, fg), "<text:m>");
	assert.equal(modelWithThinking(undefined, "high", fg, "sin modelo"), "<dim:sin modelo>");
});
