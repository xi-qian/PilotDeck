import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MODEL_CAPABILITIES } from "../../../src/model/protocol/capabilities.js";
import type { ModelConfig } from "../../../src/model/protocol/canonical.js";
import { DEFAULT_MULTIMODAL_CONSTRAINTS } from "../../../src/model/protocol/multimodal.js";
import { parseToolsConfig } from "../../../src/pilot/config/parseToolsConfig.js";
import type { PilotConfigDiagnostic } from "../../../src/pilot/config/types.js";

const modelConfig: ModelConfig = {
  providers: {
    bifrost: {
      id: "bifrost",
      protocol: "openai",
      url: "http://localhost:8080/v1",
      apiKey: "test",
      headers: {},
      models: {
        "local-llama/qwen3.6-35b": {
          id: "local-llama/qwen3.6-35b",
          capabilities: DEFAULT_MODEL_CAPABILITIES,
          multimodal: DEFAULT_MULTIMODAL_CONSTRAINTS,
        },
      },
    },
  },
};

test("parseToolsConfig resolves a webFetch model whose id contains slashes", () => {
  const diagnostics: PilotConfigDiagnostic[] = [];
  const result = parseToolsConfig(
    {
      webFetch: {
        model: "bifrost/local-llama/qwen3.6-35b",
        maxOutputTokens: 4096,
        temperature: 0,
      },
    },
    diagnostics,
    modelConfig,
  );

  assert.deepEqual(diagnostics, []);
  assert.deepEqual(result?.webFetch, {
    model: {
      id: "bifrost/local-llama/qwen3.6-35b",
      provider: "bifrost",
      model: "local-llama/qwen3.6-35b",
    },
    maxOutputTokens: 4096,
    temperature: 0,
  });
});

test("parseToolsConfig rejects unknown webFetch models and invalid limits", () => {
  const diagnostics: PilotConfigDiagnostic[] = [];
  const result = parseToolsConfig(
    {
      webFetch: {
        model: "bifrost/missing",
        maxOutputTokens: 0,
        temperature: 3,
      },
    },
    diagnostics,
    modelConfig,
  );

  assert.equal(result, undefined);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    [
      "TOOLS_WEB_FETCH_MODEL_NOT_FOUND",
      "TOOLS_WEB_FETCH_MAX_OUTPUT_TOKENS_INVALID",
      "TOOLS_WEB_FETCH_TEMPERATURE_INVALID",
    ],
  );
  assert.ok(diagnostics.every((diagnostic) => diagnostic.severity === "fatal"));
});
