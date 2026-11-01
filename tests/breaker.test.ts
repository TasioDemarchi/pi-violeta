import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BREAKER, DispatchBreaker, breakerConfigFromEnv } from "../src/agents/breaker.ts";

const MIN = 60_000;

function make(overrides: Partial<typeof DEFAULT_BREAKER> = {}) {
	let clock = 1_000_000;
	const breaker = new DispatchBreaker({ ...DEFAULT_BREAKER, ...overrides }, () => clock);
	let n = 0;
	/** Dispatch the way the tool does: ask, then record when allowed. */
	const dispatch = (agent = "builder", label = `task ${n}`) => {
		const decision = breaker.beforeDispatch(agent, label);
		if (decision.kind !== "confirm") breaker.record({ id: `t${n++}`, agent, label });
		return decision;
	};
	return { breaker, dispatch, advance: (ms: number) => (clock += ms) };
}

test("a quiet start allows dispatches without reporting", () => {
	const { dispatch } = make();
	for (let i = 0; i < 4; i++) assert.equal(dispatch().kind, "allow");
});

test("reports once every N dispatches and never stops anything", () => {
	const { dispatch } = make();
	const kinds = Array.from({ length: 9 }, () => dispatch().kind);
	// 4 dispatches recorded -> the 5th asks; then 4 more -> the 9th asks again.
	assert.deepEqual(kinds, ["allow", "allow", "allow", "allow", "report", "allow", "allow", "allow", "report"]);
});

test("reports by time when something ran, and not when nothing did", () => {
	const { dispatch, advance, breaker } = make();
	advance(20 * MIN);
	assert.equal(breaker.beforeDispatch("builder", "first").kind, "allow", "nothing has run yet, so there is nothing to report");
	dispatch("builder", "first");
	advance(16 * MIN);
	assert.equal(dispatch("builder", "second").kind, "report");
});

test("the third identical dispatch asks; different labels do not", () => {
	const { dispatch } = make({ hardDispatches: 99, reportEvery: 99 });
	assert.equal(dispatch("judge", "Final review").kind, "allow");
	assert.equal(dispatch("judge", "  final REVIEW ").kind, "allow", "same label up to case and spacing");
	const third = dispatch("judge", "Final review");
	assert.equal(third.kind, "confirm");
	assert.equal(third.kind === "confirm" && third.reason, "loop");
	assert.equal(dispatch("judge", "Another review").kind, "allow");
	assert.equal(dispatch("builder", "Final review").kind, "allow", "same label, different agent");
});

test("the hard ceiling asks by dispatch count", () => {
	const { dispatch } = make({ reportEvery: 99, hardDispatches: 3 });
	for (let i = 0; i < 3; i++) assert.equal(dispatch("builder", `piece ${i}`).kind, "allow");
	const next = dispatch("builder", "piece 3");
	assert.equal(next.kind, "confirm");
	assert.equal(next.kind === "confirm" && next.reason, "ceiling");
});

test("the hard ceiling asks by elapsed time once something has run", () => {
	const { dispatch, advance } = make({ reportEvery: 99, reportMs: 10_000 * MIN });
	dispatch("scout", "map");
	advance(61 * MIN);
	assert.equal(dispatch("builder", "late").kind, "confirm");
});

test("the user speaking starts a new window", () => {
	const { dispatch, breaker } = make({ reportEvery: 99, hardDispatches: 2 });
	dispatch("builder", "a");
	dispatch("builder", "b");
	assert.equal(dispatch("builder", "c").kind, "confirm");
	breaker.userTurn();
	assert.equal(dispatch("builder", "c").kind, "allow");
});

test("approving a confirmation restarts the window, loop counts included", () => {
	const { dispatch, breaker } = make({ reportEvery: 99 });
	dispatch("judge", "same");
	dispatch("judge", "same");
	assert.equal(dispatch("judge", "same").kind, "confirm");
	breaker.approve();
	assert.equal(dispatch("judge", "same").kind, "allow");
});

test("a refused confirmation records nothing, so asking again asks again", () => {
	const { dispatch } = make({ reportEvery: 99, hardDispatches: 1 });
	dispatch("builder", "a");
	assert.equal(dispatch("builder", "b").kind, "confirm");
	assert.equal(dispatch("builder", "b").kind, "confirm");
});

test("summary is structured, bounded and uses the task lookup", () => {
	const { dispatch, breaker, advance } = make({ reportEvery: 99, hardDispatches: 99 });
	for (let i = 0; i < 7; i++) dispatch("builder", `piece ${i}`);
	advance(5 * MIN);
	const s = breaker.summary((id) => ({ status: id === "t6" ? "running" : "completed", turns: 3, tokens: 1000 }));
	assert.equal(s.dispatches, 7);
	assert.equal(s.minutes, 5);
	assert.equal(s.tokens, 7000);
	assert.deepEqual(s.counts, { completed: 6, running: 1 });
	assert.equal(s.recent.length, 5, "only the latest rows are shown");
	assert.equal(s.recent.at(-1)?.label, "piece 6");
});

test("environment variables override the defaults; junk falls back", () => {
	const config = breakerConfigFromEnv({
		VIOLETA_BREAKER_REPORT_EVERY: "2",
		VIOLETA_BREAKER_HARD_MINUTES: "30",
		VIOLETA_BREAKER_LOOP_REPEAT: "nope",
	} as NodeJS.ProcessEnv);
	assert.equal(config.reportEvery, 2);
	assert.equal(config.hardMs, 30 * MIN);
	assert.equal(config.loopRepeat, DEFAULT_BREAKER.loopRepeat);
	assert.equal(config.hardDispatches, DEFAULT_BREAKER.hardDispatches);
});

test("the shipped numbers are the ones agreed from the Android replay", () => {
	assert.deepEqual(DEFAULT_BREAKER, { reportEvery: 4, reportMs: 15 * MIN, hardDispatches: 12, hardMs: 60 * MIN, loopRepeat: 3 });
});
