import { test } from "node:test";
import assert from "node:assert/strict";
import { fmtTokens, fmtCost, fmtPercent } from "../src/format.ts";

test("tokens are compacted", () => {
	assert.equal(fmtTokens(0), "0");
	assert.equal(fmtTokens(999), "999");
	assert.equal(fmtTokens(1500), "1.5k");
	assert.equal(fmtTokens(2_400_000), "2.4M");
});

test("cost keeps precision for small amounts", () => {
	assert.equal(fmtCost(0), "$0.00");
	assert.equal(fmtCost(0.0042), "$0.004");
	assert.equal(fmtCost(1.234), "$1.23");
});

test("percent rounds and clamps", () => {
	assert.equal(fmtPercent(0.426), "43%");
	assert.equal(fmtPercent(1.4), "100%");
	assert.equal(fmtPercent(-1), "0%");
});
