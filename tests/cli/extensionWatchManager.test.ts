import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ExtensionWatchManager,
  resolveWatchTarget,
} from "../../src/cli/ExtensionWatchManager.js";

test("missing extension paths use a shallow ancestor watcher", async () => {
  const root = await mkdtemp(join(tmpdir(), "pilotdeck-watch-"));
  try {
    const intended = join(root, "project", ".pilotdeck", "plugins");
    mkdirSync(join(root, "project"), { recursive: true });

    assert.deepEqual(resolveWatchTarget(intended), {
      target: join(root, "project"),
      recursive: false,
    });

    mkdirSync(intended, { recursive: true });
    assert.deepEqual(resolveWatchTarget(intended), {
      target: intended,
      recursive: true,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("watcher follows an extension directory created after startup", async () => {
  const root = await mkdtemp(join(tmpdir(), "pilotdeck-watch-"));
  const projectRoot = join(root, "project");
  const pilotHome = join(root, "home");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(pilotHome, { recursive: true });

  const events: string[][] = [];
  const manager = new ExtensionWatchManager({
    pilotHome,
    debounceMs: 20,
    onChange: (event) => events.push(event.changedPaths),
  });
  manager.watchProject(projectRoot);
  const stop = manager.start();

  try {
    const plugins = join(projectRoot, ".pilotdeck", "plugins");
    mkdirSync(plugins, { recursive: true });
    await waitFor(() => events.length > 0);
    events.length = 0;

    writeFileSync(join(plugins, "example.ts"), "export default {}\n");
    await waitFor(() => events.some((paths) => paths.includes(plugins)));
  } finally {
    stop();
    await rm(root, { recursive: true, force: true });
  }
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      assert.fail("timed out waiting for extension watch event");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
