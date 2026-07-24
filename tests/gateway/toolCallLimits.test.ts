import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalToolCall } from "../../src/model/index.js";
import { applyToolCallLimits } from "../../src/agent/loop/applyToolCallLimits.js";

const call = (id: string, name: string): CanonicalToolCall => ({ id, name, input: {} });

test("tool call limits cap parallel and later calls without affecting other tools", () => {
  const counts = new Map<string, number>();
  const now = () => new Date("2026-07-24T00:00:00Z");

  const first = applyToolCallLimits(
    [call("fetch-1", "web_fetch"), call("fetch-2", "web_fetch"), call("search-1", "web_search")],
    { web_fetch: 2, web_search: 3 },
    counts,
    now,
  );
  const second = applyToolCallLimits(
    [call("fetch-3", "web_fetch"), call("search-2", "web_search")],
    { web_fetch: 2, web_search: 3 },
    counts,
    now,
  );

  assert.deepEqual(first.executable.map((item) => item.id), ["fetch-1", "fetch-2", "search-1"]);
  assert.equal(first.limitedResults.length, 0);
  assert.deepEqual(second.executable.map((item) => item.id), ["search-2"]);
  assert.equal(second.limitedResults.length, 1);
  const limited = second.limitedResults[0]!;
  assert.equal(limited.type, "error");
  if (limited.type !== "error") assert.fail("expected a controlled tool error");
  assert.match(limited.error.message, /web_fetch \(2\)/);
  assert.equal(counts.get("web_fetch"), 2);
  assert.equal(counts.get("web_search"), 2);
});
