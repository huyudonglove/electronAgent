import fs from "node:fs";
import path from "node:path";
import type { ModelRuntimeConfig, ModelRuntimeRole, ModelRuntimeSettings } from "@xiaomi/shared";
import { MIMO_BASE_URL, MIMO_MAX_TOKENS, MIMO_MODEL, OLLAMA_BASE_URL, OLLAMA_INTENT_MODEL } from "./modelConfig";
import { getMimoApiKey } from "./localSecrets";
import { resolveProjectPath } from "./utils/projectRoot";

const CONFIG_PATH = resolveProjectPath("config", "model-runtime.local.json");

export function getModelRuntimeSettings(): ModelRuntimeSettings {
  return normalizeSettings(readModelRuntimeSettings());
}

export function saveModelRuntimeSettings(settings: ModelRuntimeSettings): ModelRuntimeSettings {
  const normalized = normalizeSettings(settings);
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return normalized;
}

export function getModelRuntimeConfig(role: ModelRuntimeRole): ModelRuntimeConfig {
  return getModelRuntimeSettings()[role];
}

function readModelRuntimeSettings(): Partial<ModelRuntimeSettings> {
  if (!fs.existsSync(CONFIG_PATH)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<ModelRuntimeSettings>;
  } catch {
    return {};
  }
}

function normalizeSettings(settings: Partial<ModelRuntimeSettings>): ModelRuntimeSettings {
  return {
    router: normalizeConfig(settings.router, defaultRouterConfig()),
    main: normalizeConfig(settings.main, defaultMainConfig()),
    compression: normalizeConfig(settings.compression, defaultCompressionConfig())
  };
}

function normalizeConfig(value: Partial<ModelRuntimeConfig> | undefined, fallback: ModelRuntimeConfig): ModelRuntimeConfig {
  return {
    role: fallback.role,
    label: stringOr(value?.label, fallback.label),
    providerKind: value?.providerKind === "openai-compatible" || value?.providerKind === "anthropic-compatible" || value?.providerKind === "ollama"
      ? value.providerKind
      : fallback.providerKind,
    baseURL: stringOr(value?.baseURL, fallback.baseURL),
    model: stringOr(value?.model, fallback.model),
    apiKey: stringOr(value?.apiKey, fallback.apiKey),
    temperature: numberOr(value?.temperature, fallback.temperature),
    maxTokens: numberOr(value?.maxTokens, fallback.maxTokens)
  };
}

function defaultRouterConfig(): ModelRuntimeConfig {
  return {
    role: "router",
    label: "Local Qwen Router",
    providerKind: "ollama",
    baseURL: OLLAMA_BASE_URL,
    model: OLLAMA_INTENT_MODEL,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 768
  };
}

function defaultMainConfig(): ModelRuntimeConfig {
  return {
    role: "main",
    label: "MiMo Main",
    providerKind: "anthropic-compatible",
    baseURL: MIMO_BASE_URL,
    model: MIMO_MODEL,
    apiKey: getMimoApiKey() ?? "",
    temperature: 1,
    maxTokens: MIMO_MAX_TOKENS
  };
}

function defaultCompressionConfig(): ModelRuntimeConfig {
  return {
    role: "compression",
    label: "Local Qwen Compression",
    providerKind: "ollama",
    baseURL: OLLAMA_BASE_URL,
    model: OLLAMA_INTENT_MODEL,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 1024
  };
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
