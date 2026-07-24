import assert from "node:assert/strict";
import test from "node:test";

import type { CanonicalModelRequest } from "../../src/model/protocol/canonical.js";
import { createDefaultPermissionContext } from "../../src/permission/index.js";
import {
  __setWebFetchHookForTesting,
  clearWebFetchCache,
} from "../../src/tool/index.js";
import { createWebFetchTool } from "../../src/tool/builtin/webFetch.js";
import type {
  PilotDeckToolModelClient,
  PilotDeckToolRuntimeContext,
} from "../../src/tool/protocol/types.js";

const testUrl = "https://example.com/web-fetch-test";

test.afterEach(() => {
  __setWebFetchHookForTesting(null);
  clearWebFetchCache();
});

test("web_fetch uses its configured non-thinking model instead of the context model", async () => {
  const requests: CanonicalModelRequest[] = [];
  let contextModelCalled = false;
  const configuredModel: PilotDeckToolModelClient = {
    async *stream(request) {
      requests.push(request);
      yield { type: "text_delta", text: "Extracted page answer" };
      yield { type: "message_end", finishReason: "stop" };
    },
  };
  const contextModel: PilotDeckToolModelClient = {
    async *stream() {
      contextModelCalled = true;
      yield { type: "text_delta", text: "Wrong routed answer" };
    },
  };
  __setWebFetchHookForTesting(async () => ({
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/plain" },
    arrayBuffer: async () => new TextEncoder().encode("Full page text").buffer,
  }));
  const tool = createWebFetchTool({
    model: configuredModel,
    provider: "bifrost",
    modelId: "local-llama/qwen3.6-35b",
    maxOutputTokens: 4096,
    temperature: 0,
  });
  const context = createContext(contextModel);

  const result = await tool.execute(
    { url: testUrl, prompt: "Summarize the page" },
    context,
  );

  assert.equal(contextModelCalled, false);
  assert.equal(requests[0]?.provider, "bifrost");
  assert.equal(requests[0]?.model, "local-llama/qwen3.6-35b");
  assert.equal(requests[0]?.maxOutputTokens, 4096);
  assert.deepEqual(requests[0]?.thinking, { enabled: false });
  assert.deepEqual(result.content[0], { type: "text", text: "Extracted page answer" });
});

test("web_fetch rejects a secondary response containing only thinking", async () => {
  __setWebFetchHookForTesting(async () => ({
    status: 200,
    statusText: "OK",
    headers: { "content-type": "text/plain" },
    arrayBuffer: async () => new TextEncoder().encode("Full page text").buffer,
  }));
  const configuredModel: PilotDeckToolModelClient = {
    async *stream() {
      yield { type: "thinking_delta", text: "internal reasoning" };
      yield { type: "message_end", finishReason: "stop" };
    },
  };
  const tool = createWebFetchTool({ model: configuredModel });

  await assert.rejects(
    tool.execute(
      { url: testUrl, prompt: "Summarize the page" },
      createContext(configuredModel),
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /no visible text/);
      return true;
    },
  );
});

test("web_fetch retries transient transport failures within one tool call", async () => {
  let attempts = 0;
  __setWebFetchHookForTesting(async () => {
    attempts += 1;
    if (attempts < 3) throw new TypeError("fetch failed");
    return {
      status: 200,
      statusText: "OK",
      headers: { "content-type": "text/plain" },
      arrayBuffer: async () => new TextEncoder().encode("Recovered page text").buffer,
    };
  });
  const tool = createWebFetchTool();

  const result = await tool.execute(
    { url: testUrl, prompt: "Return the page" },
    createContext(undefined),
  );

  assert.equal(attempts, 3);
  assert.deepEqual(result.content[0], { type: "text", text: "Recovered page text" });
});

function createContext(model?: PilotDeckToolModelClient): PilotDeckToolRuntimeContext {
  const cwd = process.cwd();
  return {
    sessionId: "session-1",
    turnId: "turn-1",
    cwd,
    permissionMode: "default",
    permissionContext: createDefaultPermissionContext({ cwd }),
    ...(model ? { model } : {}),
  };
}
