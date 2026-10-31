import { test } from "node:test";
import assert from "node:assert/strict";
import { contextRole, createCompactWarner } from "../src/context-warning.ts";

// --- Threshold colors ---------------------------------------------------------

test("the ctx indicator color thresholds: muted below 70, warning at 70-89, error at 90+", () => {
	assert.equal(contextRole(69), "muted");
	assert.equal(contextRole(70), "warning");
	assert.equal(contextRole(89), "warning");
	assert.equal(contextRole(90), "error");
	// Bounds and unknown usage.
	assert.equal(contextRole(0), "muted");
	assert.equal(contextRole(100), "error");
	assert.equal(contextRole(null), "muted");
	assert.equal(contextRole(undefined), "muted");
});

// --- The 80% /compact suggestion with hysteresis -------------------------------

test("crossing 80% fires exactly once, even as usage keeps climbing", () => {
	const warner = createCompactWarner();
	assert.equal(warner.check(50), false);
	assert.equal(warner.check(79), false);
	assert.equal(warner.check(80), true, "the crossing fires");
	assert.equal(warner.check(85), false);
	assert.equal(warner.check(95), false);
	assert.equal(warner.check(80), false, "staying above 80 does not fire again");
});

test("usage that starts above 80 fires on the first check", () => {
	const warner = createCompactWarner();
	assert.equal(warner.check(90), true);
});

test("usage below 60 re-arms without firing on the drop itself", () => {
	const warner = createCompactWarner();
	assert.equal(warner.check(82), true);
	assert.equal(warner.check(70), false, "still suppressed above 60");
	assert.equal(warner.check(60), false, "60 itself does not re-arm");
	assert.equal(warner.check(59), false, "the drop below 60 re-arms but does not fire");
});

test("after re-arming, a new crossing of 80% fires again", () => {
	const warner = createCompactWarner();
	assert.equal(warner.check(85), true);
	assert.equal(warner.check(55), false); // re-arms here (below 60)
	assert.equal(warner.check(70), false);
	assert.equal(warner.check(81), true, "second crossing fires");
	assert.equal(warner.check(90), false);
});

test("unknown usage never fires and never re-arms", () => {
	const warner = createCompactWarner();
	assert.equal(warner.check(85), true);
	assert.equal(warner.check(null), false);
	assert.equal(warner.check(undefined), false);
	assert.equal(warner.check(86), false, "still suppressed after a null reading");
	assert.equal(warner.check(50), false);
	assert.equal(warner.check(80), true, "re-armed by the drop below 60");
});
