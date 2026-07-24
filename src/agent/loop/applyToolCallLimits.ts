import type { CanonicalToolCall } from "../../model/index.js";
import type { PilotDeckToolResult } from "../../tool/index.js";
import { createMissingToolResult } from "./ensureToolResultPairing.js";

export function applyToolCallLimits(
  calls: CanonicalToolCall[],
  limits: Record<string, number> | undefined,
  counts: Map<string, number>,
  now: () => Date = () => new Date(),
): { executable: CanonicalToolCall[]; limitedResults: PilotDeckToolResult[] } {
  const executable: CanonicalToolCall[] = [];
  const limitedResults: PilotDeckToolResult[] = [];

  for (const call of calls) {
    const limit = limits?.[call.name];
    const count = counts.get(call.name) ?? 0;
    if (limit !== undefined && Number.isFinite(limit) && limit >= 0 && count >= limit) {
      limitedResults.push(
        createMissingToolResult(
          call,
          now,
          `Tool call limit reached for ${call.name} (${limit}). Do not call it again; finalize from the results already available.`,
        ),
      );
      continue;
    }
    counts.set(call.name, count + 1);
    executable.push(call);
  }
  return { executable, limitedResults };
}
