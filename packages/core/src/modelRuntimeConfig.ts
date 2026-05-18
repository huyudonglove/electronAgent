import fs from "node:fs";
import path from "node:path";
import type { ModelBlockConfig, ModelRuntimeConfig, ModelRuntimeRole, ModelRuntimeSettings } from "@xiaomi/shared";
import { MIMO_MAX_TOKENS, MIMO_MODEL, MIMO_OPENAI_BASE_URL, OLLAMA_BASE_URL, OLLAMA_INTENT_MODEL } from "./modelConfig";
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
  const modelBlocks = normalizeModelBlocks(settings.modelBlocks);

  return {
    modelBlocks,
    router: normalizeRoleConfig(settings.router, defaultRouterConfig(), modelBlocks),
    planner: normalizeRoleConfig(settings.planner, defaultPlannerConfig(), modelBlocks),
    main: normalizeRoleConfig(settings.main, defaultMainConfig(), modelBlocks),
    evaluator: normalizeRoleConfig(settings.evaluator ?? settings.router, defaultEvaluatorConfig(), modelBlocks),
    compression: normalizeRoleConfig(settings.compression, defaultCompressionConfig(), modelBlocks)
  };
}

function normalizeModelBlocks(value: unknown): readonly ModelBlockConfig[] {
  const inputBlocks = Array.isArray(value) ? value.map(asPartialModelBlock) : [];
  const defaults = defaultModelBlocks();

  return defaults.map((fallback) => normalizeModelBlock(
    inputBlocks.find((block) => block.id === fallback.id),
    fallback
  ));
}

function normalizeModelBlock(value: Partial<ModelBlockConfig> | undefined, fallback: ModelBlockConfig): ModelBlockConfig {
  return {
    id: stringOr(value?.id, fallback.id),
    label: stringOr(value?.label, fallback.label),
    provider: stringOr(value?.provider, fallback.provider),
    description: stringOr(value?.description, fallback.description),
    providerKind: isProviderKind(value?.providerKind) ? value.providerKind : fallback.providerKind,
    baseURL: stringOr(value?.baseURL, fallback.baseURL),
    model: stringOr(value?.model, fallback.model),
    apiKey: stringOr(value?.apiKey, fallback.apiKey),
    temperature: numberOr(value?.temperature, fallback.temperature),
    maxTokens: numberOr(value?.maxTokens, fallback.maxTokens),
    toolCallingMode: value?.toolCallingMode === "native-openai" || value?.toolCallingMode === "text-json"
      ? value.toolCallingMode
      : fallback.toolCallingMode,
    thinkingEnabled: typeof value?.thinkingEnabled === "boolean" ? value.thinkingEnabled : fallback.thinkingEnabled
  };
}

function normalizeRoleConfig(
  value: Partial<ModelRuntimeConfig> | undefined,
  fallback: ModelRuntimeConfig,
  modelBlocks: readonly ModelBlockConfig[]
): ModelRuntimeConfig {
  const normalized = normalizeConfig(value, fallback);
  const block = modelBlocks.find((item) => item.id === normalized.modelBlockId);
  if (!block) {
    return normalized;
  }

  return normalizeConfig({
    ...normalized,
    modelBlockId: block.id,
    label: block.label,
    providerKind: block.providerKind,
    baseURL: block.baseURL,
    model: block.model,
    apiKey: block.apiKey,
    temperature: block.temperature,
    maxTokens: block.maxTokens,
    toolCallingMode: block.toolCallingMode,
    thinkingEnabled: block.thinkingEnabled
  }, fallback);
}

function normalizeConfig(value: Partial<ModelRuntimeConfig> | undefined, fallback: ModelRuntimeConfig): ModelRuntimeConfig {
  const providerKind = isProviderKind(value?.providerKind)
    ? value.providerKind
    : fallback.providerKind;
  const requestedToolMode = value?.toolCallingMode === "native-openai" || value?.toolCallingMode === "text-json"
    ? value.toolCallingMode
    : fallback.toolCallingMode;
  const toolCallingMode = providerKind === "openai-compatible" ? requestedToolMode : "text-json";

  return {
    role: fallback.role,
    modelBlockId: typeof value?.modelBlockId === "string" ? value.modelBlockId : fallback.modelBlockId,
    label: stringOr(value?.label, fallback.label),
    providerKind,
    baseURL: stringOr(value?.baseURL, fallback.baseURL),
    model: stringOr(value?.model, fallback.model),
    apiKey: stringOr(value?.apiKey, fallback.apiKey),
    temperature: numberOr(value?.temperature, fallback.temperature),
    maxTokens: numberOr(value?.maxTokens, fallback.maxTokens),
    toolCallingMode,
    thinkingEnabled: toolCallingMode === "native-openai"
      ? true
      : providerKind === "openai-compatible" && typeof value?.thinkingEnabled === "boolean"
        ? value.thinkingEnabled
        : false
  };
}

function defaultModelBlocks(): readonly ModelBlockConfig[] {
  return [
    {
      id: "deepseek-flash",
      label: "DeepSeek Flash",
      provider: "DeepSeek",
      description: "适合 Router、Evaluator、压缩和轻量执行。",
      providerKind: "openai-compatible",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      apiKey: "",
      temperature: 0.2,
      maxTokens: 1024,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "deepseek-pro",
      label: "DeepSeek Pro",
      provider: "DeepSeek",
      description: "适合主模型和复杂任务规划。",
      providerKind: "openai-compatible",
      baseURL: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      apiKey: "",
      temperature: 0.7,
      maxTokens: MIMO_MAX_TOKENS,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-anthropic-pro",
      label: "MiMo Pro Anthropic",
      provider: "MiMo",
      description: "当前稳定主模型路径，走 Anthropic-compatible。",
      providerKind: "anthropic-compatible",
      baseURL: "https://token-plan-cn.xiaomimimo.com/anthropic",
      model: MIMO_MODEL,
      apiKey: getMimoApiKey() ?? "",
      temperature: 1,
      maxTokens: MIMO_MAX_TOKENS,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-openai-native",
      label: "MiMo Native Tools",
      provider: "MiMo",
      description: "原生 OpenAI tools/thinking 路径，需要 /v1 Key 可用。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: MIMO_MODEL,
      apiKey: "",
      temperature: 1,
      maxTokens: MIMO_MAX_TOKENS,
      toolCallingMode: "native-openai",
      thinkingEnabled: true
    },
    {
      id: "local-qwen",
      label: "Local Qwen",
      provider: "Ollama",
      description: "本地小模型，适合离线 Router 和压缩。",
      providerKind: "ollama",
      baseURL: OLLAMA_BASE_URL,
      model: OLLAMA_INTENT_MODEL,
      apiKey: "",
      temperature: 0.2,
      maxTokens: 1024,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    }
  ];
}

function defaultRouterConfig(): ModelRuntimeConfig {
  return {
    role: "router",
    modelBlockId: "local-qwen",
    label: "Local Qwen Router",
    providerKind: "ollama",
    baseURL: OLLAMA_BASE_URL,
    model: OLLAMA_INTENT_MODEL,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 768,
    toolCallingMode: "text-json",
    thinkingEnabled: false
  };
}

function defaultMainConfig(): ModelRuntimeConfig {
  return {
    role: "main",
    modelBlockId: "mimo-openai-native",
    label: "MiMo Native Main",
    providerKind: "openai-compatible",
    baseURL: MIMO_OPENAI_BASE_URL,
    model: MIMO_MODEL,
    apiKey: getMimoApiKey() ?? "",
    temperature: 1,
    maxTokens: MIMO_MAX_TOKENS,
    toolCallingMode: "native-openai",
    thinkingEnabled: true
  };
}

function defaultPlannerConfig(): ModelRuntimeConfig {
  return {
    role: "planner",
    modelBlockId: "deepseek-pro",
    label: "DeepSeek Pro Planner",
    providerKind: "openai-compatible",
    baseURL: "https://api.deepseek.com",
    model: "deepseek-v4-pro",
    apiKey: "",
    temperature: 0.3,
    maxTokens: 4096,
    toolCallingMode: "text-json",
    thinkingEnabled: false
  };
}

function defaultCompressionConfig(): ModelRuntimeConfig {
  return {
    role: "compression",
    modelBlockId: "local-qwen",
    label: "Local Qwen Compression",
    providerKind: "ollama",
    baseURL: OLLAMA_BASE_URL,
    model: OLLAMA_INTENT_MODEL,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 1024,
    toolCallingMode: "text-json",
    thinkingEnabled: false
  };
}

function defaultEvaluatorConfig(): ModelRuntimeConfig {
  return {
    role: "evaluator",
    modelBlockId: "local-qwen",
    label: "Local Qwen Evaluator",
    providerKind: "ollama",
    baseURL: OLLAMA_BASE_URL,
    model: OLLAMA_INTENT_MODEL,
    apiKey: "",
    temperature: 0.2,
    maxTokens: 768,
    toolCallingMode: "text-json",
    thinkingEnabled: false
  };
}

function isProviderKind(value: unknown): value is ModelRuntimeConfig["providerKind"] {
  return value === "openai-compatible" || value === "anthropic-compatible" || value === "ollama";
}

function asPartialModelBlock(value: unknown): Partial<ModelBlockConfig> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Partial<ModelBlockConfig> : {};
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
