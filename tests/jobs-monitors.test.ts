import { test } from "node:test";
import assert from "node:assert/strict";
import { createMonitorController, validateTimeoutSeconds, type MonitorDeps, type MonitorNotice } from "../src/jobs/monitors.ts";
import type { JobRecord } from "../src/jobs/registry.ts";

/** Fake clock: timers run manually so the 200 ms window and the flood/timeout
 * stops are deterministic. */
function fakeClock() {
	let now = 0;
	let nextId = 0;
	const timers = new Map<number, { at: number; fn: () => void; cancelled: boolean }>();
	const schedule = (fn: () => void, ms: number): (() => void) => {
		const id = ++nextId;
		timers.set(id, { at: now + ms, fn, cancelled: false });
		return () => {
			const timer = timers.get(id);
			if (timer) timer.cancelled = true;
		};
	};
	return {
		schedule,
		now: () => now,
		advance(ms: number) {
			const target = now + ms;
			for (;;) {
				const due = [...timers.values()]
					.filter((timer) => !timer.cancelled && timer.at <= target)
					.sort((a, b) => a.at - b.at)[0];
				if (!due) break;
				now = Math.max(now, due.at);
				due.fn();
				for (const [id, timer] of timers) if (timer.at <= now) timers.delete(id);
			}
			now = target;
		},
	};
}

interface FakeRegistry {
	started: Array<{ job: JobRecord; request: { onLine?: (line: string) => void; kind?: string } }>;
	stoppedIds: string[];
	start(request: never): JobRecord;
	stop(id: string): JobRecord | undefined;
	get(id: string): JobRecord | undefined;
}

function fakeRegistry(): FakeRegistry {
	const self: FakeRegistry = {
		started: [],
		stoppedIds: [],
		start(request: never) {
			const req = request as { kind?: string; onLine?: (line: string) => void };
			const job: JobRecord = {
				id: `job-${self.started.length + 1}`,
				kind: "monitor",
				label: req.kind ?? "",
				command: "",
				cwd: "/tmp",
				outputPath: "/tmp/jobs.log",
				startedAt: 0,
				status: "running",
				tail: [],
			};
			self.started.push({ job, request: req });
			return job;
		},
		stop(id: string) {
			const found = self.started.find((entry) => entry.job.id === id);
			if (!found || found.job.status !== "running") return found?.job;
			found.job.status = "stopped";
			self.stoppedIds.push(id);
			return found.job;
		},
		get(id: string) {
			return self.started.find((entry) => entry.job.id === id)?.job;
		},
	};
	return self;
}

function setup() {
	const clock = fakeClock();
	const registry = fakeRegistry();
	const notices: MonitorNotice[] = [];
	const deps: MonitorDeps = {
		registry: registry as unknown as MonitorDeps["registry"],
		schedule: clock.schedule,
		now: clock.now,
		deliver: (notice) => notices.push(notice),
	};
	return { clock, registry, notices, controller: createMonitorController(deps) };
}

test("timeout_seconds validation: mandatory integer 1-1800 with a clear error", () => {
	for (const bad of [undefined, 0, -1, 1.5, 1801, "20", Number.NaN]) {
		assert.throws(() => validateTimeoutSeconds(bad), /timeout_seconds is required and must be a whole number from 1 to 1800/, String(bad));
	}
	assert.equal(validateTimeoutSeconds(1), 1);
	assert.equal(validateTimeoutSeconds(1800), 1800);
});

test("lines within 200 ms share one notice; a later line opens a new batch", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "tail -f x", cwd: "/tmp", timeoutSeconds: 60 });
	const onLine = registry.started[0].request.onLine!;
	onLine("a");
	onLine("b");
	clock.advance(150);
	onLine("c"); // still inside the first window
	clock.advance(50); // flush fires at +200 from "a"
	assert.deepEqual(
		notices.map((notice) => (notice.kind === "events" ? notice.batch : undefined)),
		[{ lines: ["a", "b", "c"], dropped: 0 }],
	);
	onLine("d");
	clock.advance(200);
	assert.equal(notices.length, 2);
	assert.deepEqual((notices[1] as Extract<MonitorNotice, { kind: "events" }>).batch, { lines: ["d"], dropped: 0 });
});

test("a batch keeps at most 20 lines and notes the dropped count", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "floodish", cwd: "/tmp", timeoutSeconds: 60 });
	const onLine = registry.started[0].request.onLine!;
	for (let i = 0; i < 25; i++) onLine(`line${i + 1}`);
	clock.advance(200);
	const batch = (notices[0] as Extract<MonitorNotice, { kind: "events" }>).batch;
	assert.equal(batch.lines.length, 20);
	assert.equal(batch.dropped, 5);
});

test("more than 120 lines in 60s auto-stops the monitor and says why", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "spam", cwd: "/tmp", timeoutSeconds: 60 });
	const onLine = registry.started[0].request.onLine!;
	for (let i = 0; i < 121; i++) onLine(`l${i}`);
	assert.deepEqual(registry.stoppedIds, ["job-1"]);
	// The pending lines are flushed first, then the final notice says why.
	assert.deepEqual(
		notices.map((notice) => notice.kind),
		["events", "stopped"],
	);
	assert.equal((notices[0] as Extract<MonitorNotice, { kind: "events" }>).batch.dropped, 101);
	assert.equal((notices[1] as Extract<MonitorNotice, { kind: "stopped" }>).reason, "flood");
	// A stopped monitor reports nothing more.
	onLine("late");
	clock.advance(500);
	assert.equal(notices.length, 2);
});

test("the monitor stops at its timeout and says why", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "watch", cwd: "/tmp", timeoutSeconds: 20 });
	clock.advance(19_999);
	assert.equal(registry.stoppedIds.length, 0);
	clock.advance(1);
	assert.deepEqual(registry.stoppedIds, ["job-1"]);
	const notice = notices[0] as Extract<MonitorNotice, { kind: "stopped" }>;
	assert.equal(notice.reason, "timeout");
});

test("pending lines are flushed when the process exits on its own (finish)", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "short", cwd: "/tmp", timeoutSeconds: 60 });
	const onLine = registry.started[0].request.onLine!;
	onLine("final line");
	const job = registry.started[0].job;
	job.status = "exited"; // the registry reports the natural exit
	controller.finish(job);
	assert.deepEqual(
		notices.map((notice) => notice.kind),
		["events"],
	);
	assert.deepEqual((notices[0] as Extract<MonitorNotice, { kind: "events" }>).batch, { lines: ["final line"], dropped: 0 });
	// And the pending timeout stop is disarmed.
	clock.advance(60_000);
	assert.equal(registry.stoppedIds.length, 0);
	assert.equal(notices.length, 1);
});

test("a manual stop (job_stop) cancels quietly: no notices, timers dropped", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "watch", cwd: "/tmp", timeoutSeconds: 60 });
	const job = registry.started[0].job;
	registry.started[0].request.onLine!("kept in the file, not delivered");
	controller.cancel(job.id);
	clock.advance(60_000);
	assert.equal(notices.length, 0);
	assert.equal(registry.stoppedIds.length, 0, "the registry stop is the caller's job");
});

test("cancelAll drops every monitor's timers", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "a", cwd: "/tmp", timeoutSeconds: 60 });
	controller.start({ command: "b", cwd: "/tmp", timeoutSeconds: 60 });
	controller.cancelAll();
	clock.advance(60_000);
	assert.equal(notices.length, 0);
	assert.equal(registry.started.length, 2);
});

test("the timeout budget is enforced even when lines keep arriving", () => {
	const { clock, registry, notices, controller } = setup();
	controller.start({ command: "watch", cwd: "/tmp", timeoutSeconds: 5 });
	const onLine = registry.started[0].request.onLine!;
	for (let s = 0; s < 4; s++) {
		onLine(`tick ${s}`);
		clock.advance(1000);
	}
	assert.equal(registry.stoppedIds.length, 0);
	clock.advance(1000); // 5s elapsed
	assert.deepEqual(registry.stoppedIds, ["job-1"]);
	assert.equal((notices.at(-1) as Extract<MonitorNotice, { kind: "stopped" }>).reason, "timeout");
});
