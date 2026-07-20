import { isRecord } from "../../model/config/schema.js";
import type { ModelConfig } from "../../model/protocol/canonical.js";
import type {
  PilotAgentModelSelection,
  PilotConfigDiagnostic,
  PilotToolsConfig,
  PilotWebFetchConfig,
  PilotWebSearchConfig,
  PilotWebSearchCustomAuth,
  PilotWebSearchCustomMethod,
  PilotWebSearchProvider,
} from "./types.js";

/**
 * Parse the optional `tools` section of `pilotdeck.yaml`.
 *
 *   tools:
 *     webSearch:
 *       provider: glm                    # glm | tavily | custom
 *       apiKey: "..."
 *       endpoint: https://api.z.ai/api/paas/v4/web_search
 *     webFetch:
 *       model: openai/gpt-4.1-mini
 *       maxOutputTokens: 4096
 *
 * Unknown fields produce non-fatal warnings so future additions don't break
 * older deployments.  Returns `undefined` when the section is missing or
 * empty so callers can keep the field off the snapshot entirely.
 */
export function parseToolsConfig(
  rawTools: unknown,
  diagnostics: PilotConfigDiagnostic[],
  modelConfig: ModelConfig,
): PilotToolsConfig | undefined {
  if (rawTools === undefined) {
    return undefined;
  }
  if (!isRecord(rawTools)) {
    diagnostics.push({
      code: "TOOLS_CONFIG_INVALID",
      severity: "fatal",
      message: "tools config must be an object.",
      path: "tools",
      recoverable: false,
    });
    return undefined;
  }

  const webSearch = parseWebSearch(rawTools.webSearch, diagnostics);
  const webFetch = parseWebFetch(rawTools.webFetch, diagnostics, modelConfig);

  for (const key of Object.keys(rawTools)) {
    if (key !== "webSearch" && key !== "webFetch") {
      diagnostics.push({
        code: "TOOLS_UNKNOWN_FIELD",
        severity: "warning",
        message: `Unknown tools config field ${key}.`,
        path: `tools.${key}`,
        recoverable: true,
      });
    }
  }

  if (!webSearch && !webFetch) {
    return undefined;
  }
  return {
    ...(webSearch ? { webSearch } : {}),
    ...(webFetch ? { webFetch } : {}),
  };
}

function parseWebFetch(
  raw: unknown,
  diagnostics: PilotConfigDiagnostic[],
  modelConfig: ModelConfig,
): PilotWebFetchConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "TOOLS_WEB_FETCH_INVALID",
      severity: "fatal",
      message: "tools.webFetch must be an object.",
      path: "tools.webFetch",
      recoverable: false,
    });
    return undefined;
  }

  const model = parseWebFetchModel(raw.model, diagnostics, modelConfig);
  let maxOutputTokens: number | undefined;
  if (raw.maxOutputTokens !== undefined) {
    if (
      typeof raw.maxOutputTokens !== "number" ||
      !Number.isInteger(raw.maxOutputTokens) ||
      raw.maxOutputTokens <= 0
    ) {
      diagnostics.push({
        code: "TOOLS_WEB_FETCH_MAX_OUTPUT_TOKENS_INVALID",
        severity: "fatal",
        message: "tools.webFetch.maxOutputTokens must be a positive integer.",
        path: "tools.webFetch.maxOutputTokens",
        recoverable: false,
      });
    } else {
      maxOutputTokens = raw.maxOutputTokens;
    }
  }

  let temperature: number | undefined;
  if (raw.temperature !== undefined) {
    if (
      typeof raw.temperature !== "number" ||
      !Number.isFinite(raw.temperature) ||
      raw.temperature < 0 ||
      raw.temperature > 2
    ) {
      diagnostics.push({
        code: "TOOLS_WEB_FETCH_TEMPERATURE_INVALID",
        severity: "fatal",
        message: "tools.webFetch.temperature must be a finite number between 0 and 2.",
        path: "tools.webFetch.temperature",
        recoverable: false,
      });
    } else {
      temperature = raw.temperature;
    }
  }

  for (const key of Object.keys(raw)) {
    if (key !== "model" && key !== "maxOutputTokens" && key !== "temperature") {
      diagnostics.push({
        code: "TOOLS_WEB_FETCH_UNKNOWN_FIELD",
        severity: "warning",
        message: `Unknown tools.webFetch field ${key}.`,
        path: `tools.webFetch.${key}`,
        recoverable: true,
      });
    }
  }

  if (!model) {
    return undefined;
  }
  return {
    model,
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

function parseWebFetchModel(
  raw: unknown,
  diagnostics: PilotConfigDiagnostic[],
  modelConfig: ModelConfig,
): PilotAgentModelSelection | undefined {
  const path = "tools.webFetch.model";
  if (typeof raw !== "string" || raw.trim().length === 0) {
    diagnostics.push({
      code: "TOOLS_WEB_FETCH_MODEL_INVALID",
      severity: "fatal",
      message: `${path} must be a non-empty provider/model string.`,
      path,
      recoverable: false,
    });
    return undefined;
  }

  const value = raw.trim();
  const separatorIndex = value.indexOf("/");
  const providerId = separatorIndex >= 0 ? value.slice(0, separatorIndex) : "";
  const modelId = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : "";
  if (!providerId || !modelId) {
    diagnostics.push({
      code: "TOOLS_WEB_FETCH_MODEL_INVALID",
      severity: "fatal",
      message: `${path} must use provider/model format.`,
      path,
      recoverable: false,
    });
    return undefined;
  }

  const provider = modelConfig.providers[providerId];
  if (!provider) {
    diagnostics.push({
      code: "TOOLS_WEB_FETCH_PROVIDER_NOT_FOUND",
      severity: "fatal",
      message: `${path} references unknown provider ${providerId}.`,
      path,
      recoverable: false,
    });
    return undefined;
  }
  if (!provider.models[modelId]) {
    diagnostics.push({
      code: "TOOLS_WEB_FETCH_MODEL_NOT_FOUND",
      severity: "fatal",
      message: `${path} references unknown model ${modelId} for provider ${providerId}.`,
      path,
      recoverable: false,
    });
    return undefined;
  }

  return { id: value, provider: providerId, model: modelId };
}

function parseWebSearch(
  raw: unknown,
  diagnostics: PilotConfigDiagnostic[],
): PilotWebSearchConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "TOOLS_WEB_SEARCH_INVALID",
      severity: "fatal",
      message: "tools.webSearch must be an object.",
      path: "tools.webSearch",
      recoverable: false,
    });
    return undefined;
  }

  const result: PilotWebSearchConfig = {};

  if (raw.provider !== undefined) {
    if (raw.provider !== "glm" && raw.provider !== "tavily" && raw.provider !== "custom") {
      diagnostics.push({
        code: "TOOLS_WEB_SEARCH_PROVIDER_INVALID",
        severity: "fatal",
        message: "tools.webSearch.provider must be \"glm\", \"tavily\", or \"custom\".",
        path: "tools.webSearch.provider",
        recoverable: false,
      });
    } else {
      result.provider = raw.provider as PilotWebSearchProvider;
    }
  }

  if (raw.apiKey !== undefined) {
    if (typeof raw.apiKey !== "string" || raw.apiKey.trim().length === 0) {
      diagnostics.push({
        code: "TOOLS_WEB_SEARCH_API_KEY_INVALID",
        severity: "fatal",
        message: "tools.webSearch.apiKey must be a non-empty string.",
        path: "tools.webSearch.apiKey",
        recoverable: false,
      });
    } else {
      result.apiKey = raw.apiKey.trim();
    }
  }

  if (raw.endpoint !== undefined) {
    if (typeof raw.endpoint !== "string" || raw.endpoint.trim().length === 0) {
      diagnostics.push({
        code: "TOOLS_WEB_SEARCH_ENDPOINT_INVALID",
        severity: "fatal",
        message: "tools.webSearch.endpoint must be a non-empty URL string.",
        path: "tools.webSearch.endpoint",
        recoverable: false,
      });
    } else {
      result.endpoint = raw.endpoint.trim();
    }
  }

  const customProvider = parseCustomProvider(raw.customProvider, diagnostics);
  if (customProvider) {
    result.customProvider = customProvider;
  }

  // Soft-deprecate removed legacy fields. Emit warnings + ignore so existing
  // yamls don't break during migration to provider/apiKey/endpoint.
  if (raw.region !== undefined) {
    diagnostics.push({
      code: "TOOLS_WEB_SEARCH_REGION_DEPRECATED",
      severity: "warning",
      message:
        "tools.webSearch.region has been removed. Select tools.webSearch.provider instead.",
      path: "tools.webSearch.region",
      recoverable: true,
    });
  }
  if (raw.tavilyApiKey !== undefined) {
    diagnostics.push({
      code: "TOOLS_WEB_SEARCH_TAVILY_KEY_DEPRECATED",
      severity: "warning",
      message:
        "tools.webSearch.tavilyApiKey has been removed. Set tools.webSearch.provider: tavily and use tools.webSearch.apiKey.",
      path: "tools.webSearch.tavilyApiKey",
      recoverable: true,
    });
  }

  for (const key of Object.keys(raw)) {
    if (key !== "provider" && key !== "apiKey" && key !== "endpoint" && key !== "customProvider" && key !== "region" && key !== "tavilyApiKey") {
      diagnostics.push({
        code: "TOOLS_WEB_SEARCH_UNKNOWN_FIELD",
        severity: "warning",
        message: `Unknown tools.webSearch field ${key}.`,
        path: `tools.webSearch.${key}`,
        recoverable: true,
      });
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseCustomProvider(
  raw: unknown,
  diagnostics: PilotConfigDiagnostic[],
): NonNullable<PilotWebSearchConfig["customProvider"]> | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    diagnostics.push({
      code: "TOOLS_WEB_SEARCH_CUSTOM_PROVIDER_INVALID",
      severity: "fatal",
      message: "tools.webSearch.customProvider must be an object.",
      path: "tools.webSearch.customProvider",
      recoverable: false,
    });
    return undefined;
  }

  const result: NonNullable<PilotWebSearchConfig["customProvider"]> = {};
  const auth = parseEnumField<PilotWebSearchCustomAuth>(
    raw.auth,
    ["bearer", "bodyApiKey", "queryApiKey", "none"],
    "tools.webSearch.customProvider.auth",
    "TOOLS_WEB_SEARCH_CUSTOM_AUTH_INVALID",
    diagnostics,
  );
  if (auth) result.auth = auth;

  const method = parseEnumField<PilotWebSearchCustomMethod>(
    raw.method,
    ["GET", "POST"],
    "tools.webSearch.customProvider.method",
    "TOOLS_WEB_SEARCH_CUSTOM_METHOD_INVALID",
    diagnostics,
  );
  if (method) result.method = method;

  for (const field of [
    "name",
    "queryParam",
    "apiKeyParam",
    "resultsPath",
    "titleField",
    "urlField",
    "snippetField",
    "sourceField",
    "publishedAtField",
  ] as const) {
    const parsed = parseOptionalStringField(raw[field], `tools.webSearch.customProvider.${field}`, diagnostics);
    if (parsed !== undefined) {
      result[field] = parsed;
    }
  }

  for (const key of Object.keys(raw)) {
    if (
      key !== "auth" &&
      key !== "name" &&
      key !== "method" &&
      key !== "queryParam" &&
      key !== "apiKeyParam" &&
      key !== "resultsPath" &&
      key !== "titleField" &&
      key !== "urlField" &&
      key !== "snippetField" &&
      key !== "sourceField" &&
      key !== "publishedAtField"
    ) {
      diagnostics.push({
        code: "TOOLS_WEB_SEARCH_CUSTOM_PROVIDER_UNKNOWN_FIELD",
        severity: "warning",
        message: `Unknown tools.webSearch.customProvider field ${key}.`,
        path: `tools.webSearch.customProvider.${key}`,
        recoverable: true,
      });
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function parseEnumField<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  path: string,
  code: string,
  diagnostics: PilotConfigDiagnostic[],
): T | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    diagnostics.push({
      code,
      severity: "fatal",
      message: `${path} must be one of: ${allowed.join(", ")}.`,
      path,
      recoverable: false,
    });
    return undefined;
  }
  return raw as T;
}

function parseOptionalStringField(
  raw: unknown,
  path: string,
  diagnostics: PilotConfigDiagnostic[],
): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.trim().length === 0) {
    diagnostics.push({
      code: "TOOLS_WEB_SEARCH_CUSTOM_STRING_INVALID",
      severity: "fatal",
      message: `${path} must be a non-empty string.`,
      path,
      recoverable: false,
    });
    return undefined;
  }
  return raw.trim();
}
