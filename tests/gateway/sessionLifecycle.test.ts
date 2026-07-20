import assert from "node:assert/strict";
import test from "node:test";

import type { AgentSession } from "../../src/agent/index.js";
import { InProcessGateway } from "../../src/gateway/client/InProcessGateway.js";
import {
  SessionRouter,
  type GatewaySessionContext,
} from "../../src/gateway/SessionRouter.js";

function fakeSession(): AgentSession {
  return {
    abort() {},
    async *submit() {},
  } as unknown as AgentSession;
}

async function drain(iterable: AsyncIterable<unknown>): Promise<unknown[]> {
  const events = [];
  for await (const event of iterable) {
    events.push(event);
  }
  return events;
}

test("ephemeral submit evicts the session after the turn settles", async () => {
  const contexts: GatewaySessionContext[] = [];
  const evicted: string[] = [];
  const router = new SessionRouter({
    createSession(context) {
      contexts.push(context);
      return fakeSession();
    },
    onSessionEvict: (sessionKey) => evicted.push(sessionKey),
  });
  const gateway = new InProcessGateway(router, { uuid: () => "run-1" });

  const events = [];
  for await (const event of gateway.submitTurn({
    sessionKey: "web:research",
    channelKey: "web",
    message: "research",
    mcpMode: "disabled",
    sessionLifecycle: "ephemeral",
  })) {
    events.push(event);
  }

  assert.deepEqual(events, []);
  assert.equal(contexts[0]?.mcpMode, "disabled");
  assert.equal(router.sessionCount(), 0);
  assert.deepEqual(evicted, ["web:research"]);
});

test("persistent submit keeps the session available for another turn", async () => {
  const router = new SessionRouter({ createSession: () => fakeSession() });
  const gateway = new InProcessGateway(router, { uuid: () => "run-1" });

  for await (const _event of gateway.submitTurn({
    sessionKey: "web:chat",
    channelKey: "web",
    message: "hello",
  })) {
    // No events are emitted by the fake session.
  }

  assert.equal(router.sessionCount(), 1);
});

test("ephemeral submit evicts the session after a provider failure", async () => {
  const evicted: string[] = [];
  const session = {
    abort() {},
    async *submit() {
      throw new Error("provider failed");
    },
  } as unknown as AgentSession;
  const router = new SessionRouter({
    createSession: () => session,
    onSessionEvict: (sessionKey) => evicted.push(sessionKey),
  });
  const gateway = new InProcessGateway(router, { uuid: () => "run-failure" });

  const events = await drain(gateway.submitTurn({
    sessionKey: "web:failure",
    channelKey: "web",
    message: "fail",
    sessionLifecycle: "ephemeral",
  }));

  assert.deepEqual(events, [{
    type: "error",
    code: "gateway_submit_failed",
    message: "provider failed",
    recoverable: false,
  }]);
  assert.equal(router.sessionCount(), 0);
  assert.deepEqual(evicted, ["web:failure"]);
});

test("ephemeral submit evicts the session after cancellation", async () => {
  let releaseSubmit!: () => void;
  const submitBlocked = new Promise<void>((resolve) => {
    releaseSubmit = resolve;
  });
  let sessionCreated!: () => void;
  const created = new Promise<void>((resolve) => {
    sessionCreated = resolve;
  });
  const abortReasons: (string | undefined)[] = [];
  const evicted: string[] = [];
  const session = {
    abort(reason?: string) {
      abortReasons.push(reason);
      releaseSubmit();
    },
    async *submit() {
      await submitBlocked;
    },
  } as unknown as AgentSession;
  const router = new SessionRouter({
    createSession() {
      sessionCreated();
      return session;
    },
    onSessionEvict: (sessionKey) => evicted.push(sessionKey),
  });
  const gateway = new InProcessGateway(router, { uuid: () => "run-cancel" });

  const turn = drain(gateway.submitTurn({
    sessionKey: "web:cancel",
    channelKey: "web",
    message: "wait",
    runId: "run-cancel",
    sessionLifecycle: "ephemeral",
  }));
  await created;
  await gateway.abortTurn({ sessionKey: "web:cancel", runId: "run-cancel" });
  await turn;

  assert.deepEqual(abortReasons, ["aborted:run-cancel"]);
  assert.equal(router.sessionCount(), 0);
  assert.deepEqual(evicted, ["web:cancel"]);
});

test("timed-out submit evicts the session even when persistent", async () => {
  let releaseSubmit!: () => void;
  const submitBlocked = new Promise<void>((resolve) => {
    releaseSubmit = resolve;
  });
  const abortReasons: (string | undefined)[] = [];
  const evicted: string[] = [];
  const session = {
    abort(reason?: string) {
      abortReasons.push(reason);
      releaseSubmit();
    },
    async *submit() {
      await submitBlocked;
    },
  } as unknown as AgentSession;
  const router = new SessionRouter({
    createSession: () => session,
    onSessionEvict: (sessionKey) => evicted.push(sessionKey),
  });
  const gateway = new InProcessGateway(router, { uuid: () => "run-timeout" });

  const events = await drain(gateway.submitTurn({
    sessionKey: "web:timeout",
    channelKey: "web",
    message: "wait",
    timeoutMs: 5,
  }));

  assert.deepEqual(events, [{
    type: "error",
    code: "turn_timeout",
    message: "Turn exceeded the 5ms timeout.",
    recoverable: false,
  }]);
  assert.deepEqual(abortReasons, ["timeout:run-timeout"]);
  assert.equal(router.sessionCount(), 0);
  assert.deepEqual(evicted, ["web:timeout"]);
});

test("changing MCP mode recreates a cached session and evicts its resources", async () => {
  let creates = 0;
  let recreates = 0;
  const evicted: string[] = [];
  const router = new SessionRouter({
    createSession() {
      creates += 1;
      return fakeSession();
    },
    recreateSession() {
      recreates += 1;
      return fakeSession();
    },
    onSessionEvict: (sessionKey) => evicted.push(sessionKey),
  });

  await router.getOrCreate({
    sessionKey: "web:mode-change",
    channelKey: "web",
    mcpMode: "disabled",
  });
  await router.getOrCreate({
    sessionKey: "web:mode-change",
    channelKey: "web",
    mcpMode: "auto",
  });

  assert.equal(creates, 1);
  assert.equal(recreates, 1);
  assert.deepEqual(evicted, ["web:mode-change"]);
});
