import { test } from "node:test";
import assert from "node:assert/strict";
import { getShared, setShared, subscribeShared } from "../src/shared-hub.ts";

test("getShared starts empty and setShared merges patches", () => {
	setShared({});
	assert.deepEqual(getShared(), {});
	setShared({ sidebarActive: true });
	assert.equal(getShared().sidebarActive, true);
	setShared({ todoVisible: false });
	assert.equal(getShared().sidebarActive, true); // earlier keys survive
	assert.equal(getShared().todoVisible, false);
	setShared({ sidebarActive: false });
	assert.equal(getShared().sidebarActive, false); // later writes win
});

test("setShared notifies subscribers with the new state; unsubscribe stops it", () => {
	const seen: Array<boolean | undefined> = [];
	const unsub = subscribeShared((state) => seen.push(state.sidebarActive));
	setShared({ sidebarActive: true });
	assert.deepEqual(seen, [true]);
	unsub();
	setShared({ sidebarActive: false });
	assert.equal(seen.length, 1); // no notification after unsubscribing
});

test("the hub lives on globalThis[Symbol.for('violeta.shared')], so a second module instance shares the same state", async () => {
	setShared({ sidebarActive: true });
	const second = await import("../src/shared-hub.ts?second-instance");
	assert.equal(second.getShared().sidebarActive, true, "a fresh module instance must see the same hub");
	second.setShared({ sidebarActive: false });
	assert.equal(getShared().sidebarActive, false, "writes through the second instance are visible to the first");
	const hub = (globalThis as Record<symbol, unknown>)[Symbol.for("violeta.shared")];
	assert.equal(typeof hub, "object");
});
