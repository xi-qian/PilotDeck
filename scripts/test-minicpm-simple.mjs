import { createRequire } from "module";
import { readFileSync } from "fs";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"));
const WebSocket = require("ws");

const token = readFileSync(`${homedir()}/.pilotdeck/server-token`, "utf8").trim();
let reqId = 0;

async function withGateway(fn) {
  const ws = new WebSocket("ws://127.0.0.1:18790/ws");
  const pending = new Map();
  const send = (method, params) => {
    const id = `t${++reqId}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject, events: [] });
      ws.send(JSON.stringify({ type: "request", id, method, params }));
    });
  };
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "response") {
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error?.message || JSON.stringify(msg.error)));
      return;
    }
    if (msg.type === "event") {
      const p = pending.get(msg.id);
      if (!p) return;
      p.events.push(msg.event);
      const e = msg.event;
      if (e.type === "model_request_started") console.log("  model_request:", e.model);
      if (e.type === "tool_call_started") console.log("  tool_call:", e.name);
      if (e.type === "tool_call_finished") console.log("  tool_done:", e.toolName || e.name, e.ok ? "ok" : "fail", (e.resultPreview || "").slice(0, 80));
      if (e.type === "turn_error" || e.type === "error") console.log("  ERROR:", e.message || e.code || JSON.stringify(e).slice(0, 200));
      if (msg.final) {
        const text = p.events.filter((x) => x.type === "assistant_text_delta").map((x) => x.text).join("");
        p.resolve({ events: p.events, text, finishReason: e.finishReason });
      }
    }
  });
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  ws.send(JSON.stringify({ type: "hello", protocolVersion: "1.0", clientName: "test", clientVersion: "1.0.0", token }));
  await new Promise((r) => setTimeout(r, 300));
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

async function runTurn(send, label, message) {
  console.log(`\n=== ${label} ===`);
  console.log("user:", message);
  const session = await send("new_session", { channelKey: "test", projectKey: "home-modelbest-.pilotdeck" });
  console.log("session:", session.sessionKey);
  const result = await send("submit_turn", {
    sessionKey: session.sessionKey,
    channelKey: "test",
    projectKey: "home-modelbest-.pilotdeck",
    message,
    mode: "bypassPermissions",
    maxTurns: 8,
    timeoutMs: 180000,
  });
  const errors = result.events.filter((e) => e.type === "turn_error" || e.type === "error");
  console.log("assistant:", (result.text || "").slice(0, 500));
  console.log("finish:", result.finishReason, "errors:", errors.length);
  if (errors.length) throw new Error(errors[0].message || errors[0].code);
  return result;
}

try {
  await withGateway(async (send) => {
    await runTurn(send, "simple greeting", "你好，用一句话自我介绍");
    await runTurn(send, "web search (tool loop)", "帮我搜索一下AI录音卡市场规模，用两句话总结");
  });
  console.log("\nALL TESTS PASSED");
} catch (e) {
  console.error("\nFAILED:", e.message);
  process.exitCode = 1;
}
