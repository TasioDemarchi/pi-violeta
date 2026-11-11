import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobRegistry } from "../src/jobs/registry.ts";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(condition: () => boolean, timeoutMs: number, what: string): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await delay(25);
	}
	throw new Error(`condition not met within ${timeoutMs}ms: ${what}`);
}

function tmpRepo(): string {
	return mkdtempSync(join(tmpdir(), "violeta-jobs-test-"));
}

function realSchedule(fn: () => void, ms: number): () => void {
	const timer = setTimeout(fn, ms);
	timer.unref?.();
	return () => clearTimeout(timer);
}

test("start returns immediately, streams stdout+stderr to a 0600 temp file, and reports the exit once", async () => {
	const repo = tmpRepo();
	const settled: unknown[] = [];
	const registry = new JobRegistry({ onSettled: (job) => settled.push(job), schedule: realSchedule });
	try {
		const job = registry.start({ command: "printf hello; printf world >&2; sleep 0.2", cwd: repo, label: "echo test" });
		assert.equal(job.status, "running");
		assert.equal(job.kind, "job");
		assert.equal(job.label, "echo test");
		assert.match(job.outputPath, /violeta-jobs-\d+[/\\]job-1\.log$/);
		await waitFor(() => settled.length === 1, 5000, "job exit");
		const done = settled[0] as { status: string; exitCode: number | null; endedAt: number; startedAt: number; tail: string[] };
		assert.equal(done.status, "exited");
		assert.equal(done.exitCode, 0);
		assert.ok(done.endedAt - done.startedAt >= 150, "duration covers the sleep");
		assert.deepEqual(done.tail, ["helloworld"]);
		assert.equal(statSync(job.outputPath).mode & 0o777, 0o600, "output file is 0600");
		assert.equal(readFileSync(job.outputPath, "utf8"), "helloworld");
		await delay(200);
		assert.equal(settled.length, 1, "exit reported exactly once");
		// stopping a finished job does nothing and says so
		const after = registry.stop(job.id);
		assert.equal(after?.status, "exited");
		assert.equal(registry.stop("nope"), undefined, "unknown id");
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});

test("the exit notice data carries a signal when the process is killed", async () => {
	const repo = tmpRepo();
	const settled: Array<{ status: string; exitCode: number | null; signal: string | null }> = [];
	const registry = new JobRegistry({ onSettled: (job) => settled.push(job), schedule: realSchedule });
	try {
		registry.start({ command: "kill -TERM $$", cwd: repo });
		await waitFor(() => settled.length === 1, 5000, "signal exit");
		assert.equal(settled[0].status, "exited");
		assert.equal(settled[0].exitCode, null);
		assert.equal(settled[0].signal, "SIGTERM");
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});

test("the tail keeps the last 20 lines", async () => {
	const repo = tmpRepo();
	const settled: Array<{ tail: string[] }> = [];
	const registry = new JobRegistry({ onSettled: (job) => settled.push(job), schedule: realSchedule });
	try {
		registry.start({ command: "for i in $(seq 1 25); do echo line$i; done", cwd: repo });
		await waitFor(() => settled.length === 1, 5000, "job exit");
		assert.deepEqual(settled[0].tail, Array.from({ length: 20 }, (_, i) => `line${i + 6}`));
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});

test("stop kills the whole process tree: the child of the child dies and no exit notice fires", async () => {
	const repo = tmpRepo();
	const settled: unknown[] = [];
	const registry = new JobRegistry({ onSettled: (job) => settled.push(job), schedule: realSchedule });
	try {
		const marker = join(repo, "inner.pid");
		// Job process (bash) -> inner bash -> `sleep 30` grandchild.
		const job = registry.start({ command: `bash -c 'sleep 30 & echo $$ > ${marker}; wait'`, cwd: repo });
		await waitFor(() => existsSync(marker), 5000, "inner pid file");
		const inner = Number(readFileSync(marker, "utf8").trim());
		assert.ok(inner > 0);
		assert.equal(registry.stop(job.id)?.status, "stopped");
		await waitFor(() => {
			try {
				process.kill(inner, 0);
				return false;
			} catch {
				return true;
			}
		}, 5000, "inner process death");
		await delay(300);
		assert.equal(settled.length, 0, "a stopped job sends no exit notice");
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});

test("killAll force-kills every running job (session shutdown path)", async () => {
	const repo = tmpRepo();
	const registry = new JobRegistry({ schedule: realSchedule });
	try {
		const a = registry.start({ command: "sleep 30", cwd: repo });
		const b = registry.start({ command: "sleep 30", cwd: repo });
		assert.equal(registry.killAll("force"), 2);
		assert.equal(registry.get(a.id)?.status, "stopped");
		assert.equal(registry.get(b.id)?.status, "stopped");
		await waitFor(() => {
			try {
				process.kill(a.pid!, 0);
				return false;
			} catch {
				return true;
			}
		}, 5000, "force-killed job death");
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});

test("at most maxRunning jobs run at once; the extra start throws a clear error", () => {
	const repo = tmpRepo();
	const registry = new JobRegistry({ maxRunning: 2 });
	try {
		registry.start({ command: "sleep 5", cwd: repo });
		registry.start({ command: "sleep 5", cwd: repo });
		assert.throws(() => registry.start({ command: "sleep 5", cwd: repo }), /At most 2 jobs can run at once/);
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});

test("finished records are capped in memory, oldest dropped first", async () => {
	const repo = tmpRepo();
	const settled: string[] = [];
	const registry = new JobRegistry({ finishedCap: 3, onSettled: (job) => settled.push(job.id), schedule: realSchedule });
	try {
		// Sequential quick jobs so the finish order is the start order.
		for (let i = 0; i < 5; i++) {
			const job = registry.start({ command: "true", cwd: repo });
			await waitFor(() => registry.get(job.id)?.status === "exited", 5000, `job ${i + 1} exit`);
		}
		await waitFor(() => settled.length === 5, 5000, "all settled callbacks");
		assert.deepEqual(
			registry.list().map((job) => job.id),
			["job-3", "job-4", "job-5"],
		);
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});

test("subscribe fires on job changes and stops after unsubscribe", async () => {
	const repo = tmpRepo();
	const registry = new JobRegistry({ schedule: realSchedule });
	try {
		let changes = 0;
		const unsubscribe = registry.subscribe(() => changes++);
		const job = registry.start({ command: "true", cwd: repo });
		await waitFor(() => changes >= 2, 5000, "start and exit notifications");
		unsubscribe();
		const before = changes;
		await waitFor(() => registry.get(job.id)?.status === "exited", 5000, "exit");
		await delay(100);
		assert.equal(changes, before);
	} finally {
		registry.dispose();
		rmSync(repo, { recursive: true, force: true });
	}
});
