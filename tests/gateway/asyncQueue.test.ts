import assert from "node:assert/strict";
import test from "node:test";
import { AsyncQueue } from "../../src/gateway/util/AsyncQueue.js";

test("AsyncQueue fails instead of buffering past its byte limit", async () => {
  const queue = new AsyncQueue<string>({ maxBytes: 5, sizeOf: (value) => value.length });
  queue.enqueue("1234");
  queue.enqueue("56");

  await assert.rejects(async () => {
    for await (const _value of queue) {
      // The capacity failure is delivered through the iterator.
    }
  }, /capacity exceeded/);
});
