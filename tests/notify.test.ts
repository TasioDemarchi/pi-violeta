import { test } from "node:test";
import assert from "node:assert/strict";
import {
	MIN_RUN_MS,
	decideNotify,
	emitNotification,
	shortPhrase,
	type NotifyDeps,
} from "../src/notify/decision.ts";
import { getShared, setShared } from "../src/shared-hub.ts";

// --- Decision table --------------------------------------------------------

test("a short run does not notify", () => {
	assert.equal(decideNotify({ enabled: true, dialogWaiting: false, runDurationMs: 5_000 }), "none");
	assert.equal(decideNotify({ enabled: true, dialogWaiting: false, runDurationMs: MIN_RUN_MS }), "none");
});

test("a run longer than 20s notifies on settle", () => {
	assert.equal(decideNotify({ enabled: true, dialogWaiting: false, runDurationMs: MIN_RUN_MS + 1 }), "finished");
	assert.equal(decideNotify({ enabled: true, dialogWaiting: false, runDurationMs: 60_000 }), "finished");
});

test("a waiting confirmation dialog notifies even for a short run", () => {
	assert.equal(decideNotify({ enabled: true, dialogWaiting: true, runDurationMs: 0 }), "needsAnswer");
	assert.equal(decideNotify({ enabled: true, dialogWaiting: true, runDurationMs: MIN_RUN_MS + 1 }), "needsAnswer");
});

test("notify off silences everything", () => {
	assert.equal(decideNotify({ enabled: false, dialogWaiting: false, runDurationMs: 60_000 }), "none");
	assert.equal(decideNotify({ enabled: false, dialogWaiting: true, runDurationMs: 0 }), "none");
});

// --- Emission (bell + notify-send) ------------------------------------------

/** Records bell/exec calls without touching the real terminal or processes. */
function recorder(exists: boolean): NotifyDeps & { bells: string[]; execs: Array<[string, string[]]> } {
	const bells: string[] = [];
	const execs: Array<[string, string[]]> = [];
	return {
		bells,
		execs,
		bell: (data) => {
			bells.push(data);
		},
		exists: () => exists,
		exec: (file, args) => {
			execs.push([file, args]);
		},
	};
}

test("with notify-send present the bell rings and execFile gets an argument array, never a shell", () => {
	const deps = recorder(true);
	emitNotification(deps, "Terminó: listo");
	assert.deepEqual(deps.bells, ["\x07"]);
	assert.deepEqual(deps.execs, [["notify-send", ["violeta", "Terminó: listo"]]]);
});

test("a missing notify-send never throws: only the bell rings", () => {
	const deps = recorder(false);
	assert.doesNotThrow(() => emitNotification(deps, "Terminó: listo"));
	assert.deepEqual(deps.bells, ["\x07"]);
	assert.equal(deps.execs.length, 0);
});

test("a throwing bell or exec is swallowed", () => {
	assert.doesNotThrow(() =>
		emitNotification(
			{
				bell: () => {
					throw new Error("stdout closed");
				},
				exists: () => true,
				exec: () => {
					throw new Error("spawn failed");
				},
			},
			"x",
		),
	);
});

// --- The last short phrase ----------------------------------------------------

test("shortPhrase takes the last non-empty line, flattened and capped", () => {
	assert.equal(shortPhrase("primera línea\n\nsegunda línea"), "segunda línea");
	assert.equal(shortPhrase("  hola   mundo  "), "hola mundo");
	assert.equal(shortPhrase(undefined), "");
	assert.equal(shortPhrase("   \n  "), "");
	const long = "a".repeat(100);
	const out = shortPhrase(long, 60);
	assert.equal(out.length, 60);
	assert.ok(out.endsWith("…"));
});

// --- Shared hub: the guard publishes dialog-waiting for the notify extension ---

test("the shared hub carries notifyNeedsAnswer across module instances", () => {
	setShared({ notifyNeedsAnswer: true });
	assert.equal(getShared().notifyNeedsAnswer, true);
	setShared({ notifyNeedsAnswer: false });
	assert.equal(getShared().notifyNeedsAnswer, false);
	// Unrelated state survives the patch.
	setShared({ sidebarActive: true });
	assert.equal(getShared().sidebarActive, true);
});
