import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import test from "node:test";
import { TextWebSocketConnection } from "../../src/gateway/server/websocket.js";

class FakeSocket extends EventEmitter {
  writableLength = 0;
  destroyed = false;
  writes: Buffer[] = [];

  write(chunk: Buffer): boolean {
    this.writes.push(chunk);
    return true;
  }

  end(): void {
    this.destroyed = true;
  }
}

test("normal WebSocket close notifies handlers exactly once", () => {
  const socket = new FakeSocket();
  const connection = new TextWebSocketConnection(socket as never);
  let closeCount = 0;
  connection.onClose(() => {
    closeCount += 1;
  });

  connection.close();
  socket.emit("close");

  assert.equal(closeCount, 1);
  assert.equal(connection.sendText("after-close"), false);
});

test("slow WebSocket consumers are closed before the write queue grows without bound", () => {
  const socket = new FakeSocket();
  socket.writableLength = 1024 * 1024;
  const connection = new TextWebSocketConnection(socket as never);
  let closeCount = 0;
  connection.onClose(() => {
    closeCount += 1;
  });

  assert.equal(connection.sendText("queued behind a full socket"), false);
  assert.equal(closeCount, 1);
  assert.equal(socket.writes.length, 1);
});
