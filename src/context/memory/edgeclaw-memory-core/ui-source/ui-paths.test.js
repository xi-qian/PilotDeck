import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryApiUrl } from "./ui-paths.js";

test("memory API URLs inherit the gateway application prefix", () => {
  assert.equal(
    createMemoryApiUrl(
      "/v1/apps/coding/memory-dashboard/index.html",
      "/api/memory/overview",
    ),
    "/v1/apps/coding/api/memory/overview",
  );
});

test("standalone memory API URLs remain rooted at the PilotDeck server", () => {
  assert.equal(
    createMemoryApiUrl("/memory-dashboard/index.html", "/api/memory/overview"),
    "/api/memory/overview",
  );
});
