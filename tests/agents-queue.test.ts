import { test } from "node:test";
import assert from "node:assert/strict";
import { createConcurrencyQueue } from "../src/agents/queue.ts";

test("admits up to the limit and queues the rest in order", () => {
	const queue = createConcurrencyQueue(2);
	assert.equal(queue.admit("a"), true);
	assert.equal(queue.admit("b"), true);
	assert.equal(queue.admit("c"), false);
	queue.enqueue("c");
	queue.enqueue("d");
	assert.deepEqual(queue.waiting(), ["c", "d"]);
});

test("release frees a slot and promotes the next waiting task", () => {
	const queue = createConcurrencyQueue(1);
	queue.admit("a");
	queue.enqueue("b");
	queue.enqueue("c");
	assert.equal(queue.release("a"), "b");
	assert.deepEqual(queue.running(), ["b"]);
	assert.equal(queue.release("b"), "c");
	assert.equal(queue.release("zz"), undefined);
	assert.equal(queue.release("c"), undefined);
	assert.deepEqual(queue.running(), []);
	assert.deepEqual(queue.waiting(), []);
});

test("a queued task can be dropped before it is promoted", () => {
	const queue = createConcurrencyQueue(1);
	queue.admit("a");
	queue.enqueue("b");
	queue.drop("b");
	assert.equal(queue.release("a"), undefined);
	assert.deepEqual(queue.waiting(), []);
});

test("the limit is clamped to at least 1", () => {
	const queue = createConcurrencyQueue(0);
	assert.equal(queue.admit("a"), true);
});
