import assert from "node:assert/strict";
import test from "node:test";
import type { AgentEvent } from "../../src/agent/protocol/events.js";
import { mapAgentEvent } from "../../src/gateway/client/InProcessGateway.js";

const largeOutput = `head-${"x".repeat(120_000)}-tail`;

function textToolResultEvent(): Extract<AgentEvent, { type: "tool_result" }> {
  return {
    type: "tool_result",
    sessionId: "session-1",
    turnId: "turn-1",
    result: {
      type: "success",
      toolCallId: "tool-1",
      toolName: "bash",
      content: [{ type: "text", text: largeOutput }],
      data: { command: "cat huge.log", stdout: largeOutput },
      startedAt: "2026-07-09T00:00:00.000Z",
      completedAt: "2026-07-09T00:00:01.000Z",
    },
  };
}

test("gateway bounds tool result previews and structured strings", () => {
  const frame = mapAgentEvent(textToolResultEvent(), "run-1").find(
    (event) => event.type === "tool_call_finished",
  );

  assert.ok(frame);
  assert.ok(frame.resultPreview?.length && frame.resultPreview.length <= 21_000);
  assert.match(frame.resultPreview ?? "", /Gateway preview truncated/);
  assert.match(frame.resultPreview ?? "", /^head-/);
  assert.match(frame.resultPreview ?? "", /-tail$/);
  assert.equal(frame.resultBytes, Buffer.byteLength(largeOutput, "utf8"));
  const stdout = frame.data?.stdout as { preview?: string; originalBytes?: number; truncated?: true };
  assert.equal(stdout.truncated, true);
  assert.equal(stdout.originalBytes, Buffer.byteLength(largeOutput, "utf8"));
  assert.ok(stdout.preview?.length && stdout.preview.length <= 4_500);
});

test("gateway bounds subagent tool result content", () => {
  const source = textToolResultEvent();
  const frame = mapAgentEvent({
    type: "subagent_tool_result",
    sessionId: "session-1",
    turnId: "turn-1",
    subagentId: "sub-1",
    subagentType: "explore",
    result: source.result,
  }, "run-1").find((event) => event.type === "agent_status" && event.event === "subagent_tool_result");

  assert.ok(frame?.type === "agent_status");
  const detail = frame.detail as { content?: string; resultBytes?: number };
  assert.ok(detail.content?.length && detail.content.length <= 21_000);
  assert.match(detail.content ?? "", /Gateway preview truncated/);
  assert.equal(detail.resultBytes, Buffer.byteLength(largeOutput, "utf8"));
});
