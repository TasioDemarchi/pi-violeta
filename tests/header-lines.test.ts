import { test } from "node:test";
import assert from "node:assert/strict";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { headerLines, headerTitle, type HeaderData, type HeaderStyle } from "../src/header-lines.ts";

// Identity style: keeps the exact text visible in assertions.
const style: HeaderStyle = { fg: (_role, text) => text, bold: (text) => text };

const base: HeaderData = { name: "violeta", version: VERSION, mode: "jarvis", project: "violeta", branch: "main" };

test("the header reads name, pi version, mode, project and branch in that order", () => {
	assert.equal(headerTitle(base, style), `▍ violeta · pi ${VERSION} · jarvis · violeta · main`);
});

test("without a branch the segment is omitted entirely", () => {
	const expected = `▍ violeta · pi ${VERSION} · jarvis · violeta`;
	assert.equal(headerTitle({ ...base, branch: undefined }, style), expected);
	assert.equal(headerTitle({ ...base, branch: null }, style), expected);
	assert.equal(headerTitle({ ...base, branch: "" }, style), expected);
});

test("without a mode the mode segment is omitted", () => {
	assert.equal(headerTitle({ ...base, mode: undefined }, style), `▍ violeta · pi ${VERSION} · violeta · main`);
});

test("the unattended warning follows the project and branch", () => {
	assert.equal(headerTitle({ ...base, unattended: true }, style), `▍ violeta · pi ${VERSION} · jarvis · violeta · main · unattended`);
});

test("the rule line stays a full-width faint divider under the title", () => {
	assert.deepEqual(headerLines(base, 24, style), [`▍ violeta · pi ${VERSION} · jarvis · violeta · main`, "─".repeat(24)]);
	// Never collapses to an empty rule at a zero width.
	assert.deepEqual(headerLines(base, 0, style)[1], "─");
});
