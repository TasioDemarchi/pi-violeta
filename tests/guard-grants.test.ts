import { test } from "node:test";
import assert from "node:assert/strict";
import { OutsideGrants } from "../src/guard/grants.ts";

test("a granted directory is granted once: has() is true immediately and stays true", () => {
	const grants = new OutsideGrants();
	grants.sync("session-1");
	assert.equal(grants.has("/tmp/other"), false);
	grants.grant("/tmp/other");
	assert.equal(grants.has("/tmp/other"), true);
	grants.sync("session-1");
	assert.equal(grants.has("/tmp/other"), true);
});

test("grants are per directory: a sibling directory is not granted", () => {
	const grants = new OutsideGrants();
	grants.sync("session-1");
	grants.grant("/tmp/other");
	assert.equal(grants.has("/tmp/other"), true);
	assert.equal(grants.has("/tmp/elsewhere"), false);
});

test("grants are lost on a session change", () => {
	const grants = new OutsideGrants();
	grants.sync("session-1");
	grants.grant("/tmp/other");
	grants.sync("session-2");
	assert.equal(grants.has("/tmp/other"), false);
	assert.deepEqual(grants.list(), []);
	// and the old session coming back does not resurrect them
	grants.grant("/tmp/new");
	grants.sync("session-1");
	assert.deepEqual(grants.list(), []);
});

test("list() returns the current grants sorted, without duplicates", () => {
	const grants = new OutsideGrants();
	grants.sync("session-1");
	grants.grant("/tmp/zzz");
	grants.grant("/tmp/aaa");
	grants.grant("/tmp/aaa");
	assert.deepEqual(grants.list(), ["/tmp/aaa", "/tmp/zzz"]);
});

test("clear() revokes everything and reports how many grants it dropped", () => {
	const grants = new OutsideGrants();
	grants.sync("session-1");
	assert.equal(grants.clear(), 0);
	grants.grant("/tmp/a");
	grants.grant("/tmp/b");
	assert.equal(grants.clear(), 2);
	assert.deepEqual(grants.list(), []);
	assert.equal(grants.has("/tmp/a"), false);
});
