import { existsSync, statSync, watch, type FSWatcher } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { getPilotExtensionPaths } from "../pilot/index.js";

export type ExtensionWatchScope =
  | { kind: "global" }
  | { kind: "project"; projectRoot: string };

export type ExtensionWatchEvent = {
  scope: ExtensionWatchScope;
  changedPaths: string[];
};

export type ExtensionWatchManagerOptions = {
  pilotHome: string;
  debounceMs?: number;
  onChange(event: ExtensionWatchEvent): void;
  onError?(scope: ExtensionWatchScope, error: Error): void;
};

type ScopeWatchRecord = {
  scope: ExtensionWatchScope;
  watchedPaths: string[];
  watchers: FSWatcher[];
  pendingPaths: Set<string>;
  timer?: NodeJS.Timeout;
};

export class ExtensionWatchManager {
  private readonly scopes = new Map<string, ScopeWatchRecord>();
  private started = false;

  constructor(private readonly options: ExtensionWatchManagerOptions) {}

  start(): () => void {
    if (this.started) {
      return () => this.stop();
    }
    this.started = true;
    this.ensureGlobalScope();
    for (const record of this.scopes.values()) {
      if (record.watchers.length === 0) {
        record.watchers.push(...this.createWatchers(record.scope, record.watchedPaths));
      }
    }
    return () => this.stop();
  }

  stop(): void {
    this.started = false;
    for (const record of this.scopes.values()) {
      if (record.timer) {
        clearTimeout(record.timer);
        record.timer = undefined;
      }
      for (const watcher of record.watchers) {
        try {
          watcher.close();
        } catch {
          // Best-effort shutdown.
        }
      }
      record.watchers = [];
      record.pendingPaths.clear();
    }
  }

  watchProject(projectRoot: string): void {
    this.ensureGlobalScope();
    this.ensureScope({ kind: "project", projectRoot: resolve(projectRoot) });
  }

  private ensureGlobalScope(): void {
    this.ensureScope({ kind: "global" });
  }

  private ensureScope(scope: ExtensionWatchScope): void {
    const key = scopeKey(scope);
    if (this.scopes.has(key)) {
      return;
    }
    const watchedPaths = this.getWatchedPaths(scope);
    const record: ScopeWatchRecord = {
      scope,
      watchedPaths,
      watchers: [],
      pendingPaths: new Set<string>(),
    };
    if (this.started) {
      record.watchers.push(...this.createWatchers(scope, watchedPaths));
    }
    this.scopes.set(key, record);
  }

  private getWatchedPaths(scope: ExtensionWatchScope): string[] {
    if (scope.kind === "global") {
      return [
        resolve(this.options.pilotHome, "mcp.json"),
        resolve(this.options.pilotHome, "plugins"),
        resolve(this.options.pilotHome, "skills"),
      ];
    }
    const paths = getPilotExtensionPaths(scope.projectRoot, this.options.pilotHome);
    return [resolve(scope.projectRoot, ".pilotdeck", "mcp.json"), paths.projectPluginsDir, paths.projectSkillsDir];
  }

  private createWatchers(scope: ExtensionWatchScope, watchedPaths: string[]): FSWatcher[] {
    const watchers: FSWatcher[] = [];
    for (const watchedPath of watchedPaths) {
      const { target: watchTarget, recursive } = resolveWatchTarget(watchedPath);
      const schedule = (filename: string) => {
        if (shouldHandleWatchSignal(watchTarget, watchedPath, filename)) {
          this.schedule(scope, watchedPath);
        }
      };
      const errorTarget = (error: unknown) =>
        this.options.onError?.(scope, error instanceof Error ? error : new Error(String(error)));
      const watcher = this.tryWatch(watchTarget, recursive, schedule, errorTarget);
      if (watcher) {
        watchers.push(watcher);
        continue;
      }
      if (recursive) {
        const plainWatcher = this.tryWatch(watchTarget, false, schedule, errorTarget);
        if (plainWatcher) {
          watchers.push(plainWatcher);
        }
      }
    }
    return watchers;
  }

  private tryWatch(
    target: string,
    recursive: boolean,
    onSignal: (filename: string) => void,
    onError: (error: unknown) => void,
  ): FSWatcher | undefined {
    try {
      const watcher = watch(target, { recursive }, (_event, filename) => onSignal(toUtf8(filename)));
      watcher.on("error", onError);
      return watcher;
    } catch {
      return undefined;
    }
  }

  private schedule(scope: ExtensionWatchScope, changedPath: string): void {
    const record = this.scopes.get(scopeKey(scope));
    if (!record) {
      return;
    }
    record.pendingPaths.add(changedPath);
    if (record.timer) {
      clearTimeout(record.timer);
    }
    record.timer = setTimeout(() => {
      record.timer = undefined;
      const changedPaths = [...record.pendingPaths].sort();
      record.pendingPaths.clear();
      this.refreshWatchers(record);
      this.options.onChange({ scope: record.scope, changedPaths });
    }, this.options.debounceMs ?? 250);
  }

  private refreshWatchers(record: ScopeWatchRecord): void {
    for (const watcher of record.watchers) {
      try {
        watcher.close();
      } catch {
        // Best-effort replacement after an extension path is created or removed.
      }
    }
    record.watchers = this.started
      ? this.createWatchers(record.scope, record.watchedPaths)
      : [];
  }
}

function scopeKey(scope: ExtensionWatchScope): string {
  return scope.kind === "global" ? "__global__" : scope.projectRoot;
}

export function resolveWatchTarget(path: string): { target: string; recursive: boolean } {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  // Recursing from a fallback ancestor can traverse an entire project or home
  // directory when `.pilotdeck/` does not exist. Watch that ancestor shallowly
  // until the intended extension path is created, then refresh onto the path.
  return {
    target: current,
    recursive: current === path && statSync(current).isDirectory(),
  };
}

function shouldHandleWatchSignal(watchTarget: string, watchedPath: string, filename: string): boolean {
  if (filename.length === 0) {
    return true;
  }
  const absoluteChanged = resolve(watchTarget, filename);
  return absoluteChanged === watchedPath
    || absoluteChanged.startsWith(`${watchedPath}${sep}`)
    || watchedPath.startsWith(`${absoluteChanged}${sep}`);
}

function toUtf8(value: string | Buffer | null | undefined): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value.toString === "function") {
    return value.toString("utf8");
  }
  return "";
}
