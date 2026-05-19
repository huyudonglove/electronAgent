import fs from "node:fs";
import path from "node:path";
import type { ModelBlockConfig, ModelRuntimeConfig, ModelRuntimeRole, ModelRuntimeSettings } from "@xiaomi/shared";
import { MIMO_BASE_URL, MIMO_MAX_TOKENS, MIMO_MODEL, MIMO_OPENAI_BASE_URL, OLLAMA_BASE_URL, OLLAMA_INTENT_MODEL } from "./modelConfig";
import { getMimoApiKey } from "./localSecrets";
import { resolveAppStoragePath, resolveProjectPath } from "./utils/projectRoot";

export function getModelRuntimeSettings(): ModelRuntimeSettings {
  return normalizeSettings(readModelRuntimeSettings());
}

export function saveModelRuntimeSettings(settings: ModelRuntimeSettings): ModelRuntimeSettings {
  const normalized = normalizeSettings(settings);
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");

  return normalized;
}

export function getModelRuntimeConfig(role: ModelRuntimeRole): ModelRuntimeConfig {
  return getModelRuntimeSettings()[role];
}

function readModelRuntimeSettings(): Partial<ModelRuntimeSettings> {
  const configPath = getReadableConfigPath();
  if (!configPath || !fs.existsSync(configPath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<ModelRuntimeSettings>;
  } catch {
    return {};
  }
}

function getConfigPath(): string {
  return resolveAppStoragePath("config", "model-runtime.local.json");
}

function getReadableConfigPath(): string | undefined {
  const appConfigPath = getConfigPath();
  if (fs.existsSync(appConfigPath)) {
    return appConfigPath;
  }

  const legacyConfigPath = resolveProjectPath("config", "model-runtime.local.json");
  if (fs.existsSync(legacyConfigPath)) {
    return legacyConfigPath;
  }

  return appConfigPath;
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
  const normalized: ModelBlockConfig = {
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

  if (fallback.id === "mimo-v2-5" && normalized.providerKind === "anthropic-compatible") {
    return {
      ...normalized,
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2.5"
    };
  }

  if (fallback.id === "mimo-anthropic-pro") {
    return {
      ...normalized,
      providerKind: "anthropic-compatible",
      baseURL: MIMO_BASE_URL,
      model: MIMO_MODEL
    };
  }

  return normalized;
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
      maxTokens: 2048,
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
      id: "mimo-v2-5",
      label: "MiMo V2.5",
      provider: "MiMo",
      description: "同系列较轻文本模型，适合尝试更快回复。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2.5",
      apiKey: "",
      temperature: 0.8,
      maxTokens: MIMO_MAX_TOKENS,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-v2-5-pro-openai",
      label: "MiMo V2.5 Pro",
      provider: "MiMo",
      description: "文本主模型，适合继续走 OpenAI-compatible 路径测试速度。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2.5-Pro",
      apiKey: "",
      temperature: 1,
      maxTokens: MIMO_MAX_TOKENS,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-v2-pro",
      label: "MiMo V2 Pro",
      provider: "MiMo",
      description: "上一代 Pro 文本模型，可用于速度与质量对比。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2-Pro",
      apiKey: "",
      temperature: 1,
      maxTokens: MIMO_MAX_TOKENS,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-v2-omni",
      label: "MiMo V2 Omni",
      provider: "MiMo",
      description: "Omni 多模态模型，当前文本链路可先当通用对话模型试用。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2-Omni",
      apiKey: "",
      temperature: 1,
      maxTokens: MIMO_MAX_TOKENS,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-v2-5-tts",
      label: "MiMo V2.5 TTS",
      provider: "MiMo",
      description: "TTS 模型，先保留在模型库中，当前文本 Agent 主链通常不优先使用。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2.5-TTS",
      apiKey: "",
      temperature: 0.7,
      maxTokens: 4096,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-v2-5-tts-voiceclone",
      label: "MiMo V2.5 TTS VoiceClone",
      provider: "MiMo",
      description: "偏语音克隆，当前文本链路可配置但不建议作为默认主模型。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2.5-TTS-VoiceClone",
      apiKey: "",
      temperature: 0.7,
      maxTokens: 4096,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-v2-5-tts-voicedesign",
      label: "MiMo V2.5 TTS VoiceDesign",
      provider: "MiMo",
      description: "偏语音设计，当前文本链路可配置但不建议作为默认主模型。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2.5-TTS-VoiceDesign",
      apiKey: "",
      temperature: 0.7,
      maxTokens: 4096,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    },
    {
      id: "mimo-v2-tts",
      label: "MiMo V2 TTS",
      provider: "MiMo",
      description: "上一代 TTS 模型，保留用于模型库切换测试。",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: "MiMo-V2-TTS",
      apiKey: "",
      temperature: 0.7,
      maxTokens: 4096,
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
    maxTokens: 1024,
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
