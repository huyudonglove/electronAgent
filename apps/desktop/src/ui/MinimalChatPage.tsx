import { useEffect, useRef, useState } from "react";
import { Bug, CheckCircle2, CircleDashed, RefreshCw, Send, SlidersHorizontal, X } from "lucide-react";
import type {
  AgentEventRecord,
  ChatMessage,
  ChatSessionId,
  ChatStreamEvent,
  ModelProviderKind,
  ModelRuntimeConfig,
  ModelRuntimeRole,
  ModelRuntimeSettings,
  ModelToolCallingMode,
  ModelProfile,
  ProviderDebugLog,
} from "@xiaomi/shared";

const PROJECT_ID = "local-project";
const MIMO_OPENAI_BASE_URL = "https://api.xiaomimimo.com/v1";
const MIMO_MODEL = "mimo-v2.5-pro";

const initialMessage: ChatMessage = {
  id: "minimal-welcome",
  sender: "assistant",
  roleLabel: "项目角色",
  content: "说出你想做什么，我会从对话中帮你组建 Agent、生成编排、记录记忆，并继续推进项目。",
  createdAt: new Date().toISOString()
};

interface MinimalChatPageProps {
  readonly modelProfiles: readonly ModelProfile[];
}

export function MinimalChatPage({ modelProfiles }: MinimalChatPageProps): JSX.Element {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([initialMessage]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<ChatSessionId | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<readonly ProviderDebugLog[]>([]);
  const [eventLogs, setEventLogs] = useState<readonly AgentEventRecord[]>([]);
  const [selectedTurnId, setSelectedTurnId] = useState<string | undefined>();
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelRuntimeSettings | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "end"
    });
  }, [messages, stageLabel, error]);

  async function sendMessage(): Promise<void> {
    const content = draft.trim();
    if (!content || isSending) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `pending-user-${Date.now()}`,
      sender: "user",
      roleLabel: "你",
      content,
      createdAt: new Date().toISOString()
    };

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setIsSending(true);
    setError(null);
    setStageLabel(null);

    let removeListener: (() => void) | undefined;
    let completedSessionId: ChatSessionId | undefined;
    try {
      removeListener = window.workbench.onChatStreamEvent((event) => {
        if (event.type === "done") {
          completedSessionId = event.session.id;
        }
        handleStreamEvent(event);
      });
      await window.workbench.streamChatMessage({
        sessionId,
        projectId: PROJECT_ID,
        modelProfileId: modelProfiles.find((profile) => profile.id === "mimo-v2-5-pro")?.id ?? "mimo-v2-5-pro",
        message: content,
      });
      await refreshDebugData(completedSessionId, Boolean(completedSessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshDebugData(completedSessionId);
    } finally {
      removeListener?.();
      setIsSending(false);
      setStageLabel(null);
    }
  }

  function handleStreamEvent(event: ChatStreamEvent): void {
    if (event.type === "stage") {
      setStageLabel(event.detail ? `${event.label}：${event.detail}` : event.label);
      return;
    }

    if (event.type === "start") {
      setStageLabel(null);
      setSessionId(event.sessionId);
      setMessages((current) => [
        ...current,
        {
          id: event.messageId,
          sender: "assistant",
          roleLabel: event.roleLabel,
          content: "",
          createdAt: new Date().toISOString()
        }
      ]);
      return;
    }

    if (event.type === "delta") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.messageId
            ? {
                ...message,
                content: `${message.content}${event.delta}`
              }
            : message
        )
      );
      return;
    }

    if (event.type === "replace") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.messageId
            ? {
                ...message,
                content: event.content
              }
            : message
        )
      );
      return;
    }

    if (event.type === "done") {
      setStageLabel(null);
      setSessionId(event.session.id);
      setMessages(event.session.messages);
      void refreshSessionEvents(event.session.id, true);
      return;
    }

    setStageLabel(null);
    setError(event.error);
  }

  async function refreshDebugData(targetSessionId = sessionId, selectLatest = false): Promise<void> {
    const logs = await window.workbench.listProviderDebugLogs();
    setDebugLogs(logs);

    if (targetSessionId) {
      await refreshSessionEvents(targetSessionId, selectLatest);
    }
  }

  async function refreshSessionEvents(targetSessionId: ChatSessionId, selectLatest = false): Promise<void> {
    const events = await window.workbench.listSessionEvents({
      projectId: PROJECT_ID,
      sessionId: targetSessionId
    });
    setEventLogs(events);
    setSelectedTurnId((current) => {
      const latestTurnId = getLatestTurnId(events);
      if (selectLatest || !current) {
        return latestTurnId;
      }

      const currentStillExists = buildConversationTurns(events).some((turn) => turn.id === current);
      return currentStillExists ? current : latestTurnId;
    });
  }

  return (
    <main className="minimal-chat">
      <div className="top-actions">
        <button
          className="debug-toggle"
          type="button"
          onClick={async () => {
            const nextOpen = !modelSettingsOpen;
            setModelSettingsOpen(nextOpen);
            setDebugOpen(false);
            if (nextOpen) {
              await refreshModelSettings();
            }
          }}
        >
          <SlidersHorizontal size={16} />
          模型
        </button>
        <button
          className="debug-toggle"
          type="button"
          onClick={async () => {
            const nextOpen = !debugOpen;
            setDebugOpen(nextOpen);
            setModelSettingsOpen(false);
            if (nextOpen) {
              await refreshDebugData();
            }
          }}
        >
          <Bug size={16} />
          调试
        </button>
      </div>

      <section className="minimal-chat__messages" aria-label="对话消息">
        {messages.map((message) => (
          <article className={`minimal-message minimal-message--${message.sender}`} key={message.id}>
            <div className="minimal-message__meta">{message.roleLabel}</div>
            <MessageContent content={message.content} sender={message.sender} />
          </article>
        ))}
        {stageLabel ? <div className="minimal-chat__stage">{stageLabel}</div> : null}
        {error ? <div className="minimal-chat__error">{error}</div> : null}
        <div ref={messagesEndRef} />
      </section>

      <footer className="minimal-composer">
        <textarea
          aria-label="输入对话"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="描述你的目标，例如：帮我组建 Agent 团队继续开发这个项目..."
          spellCheck={false}
        />
        <button type="button" onClick={() => void sendMessage()} disabled={!draft.trim() || isSending} title="发送">
          <Send size={18} />
        </button>
      </footer>

      {debugOpen ? (
        <aside className="debug-drawer" aria-label="接口调试面板">
          <header>
            <div>
              <h2>接口调试</h2>
              <p>按本轮 Agent 链路查看 Router、模型、工具和验收，原始数据在步骤内展开。</p>
            </div>
            <div className="debug-drawer__actions">
              <button type="button" onClick={() => void refreshDebugData()} title="刷新">
                <RefreshCw size={16} />
              </button>
              <button type="button" onClick={() => setDebugOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
          </header>

          <section className="debug-log-list">
            <TraceView
              events={eventLogs}
              logs={debugLogs}
              onSelectTurn={setSelectedTurnId}
              selectedTurnId={selectedTurnId}
              sessionId={sessionId}
            />
          </section>
        </aside>
      ) : null}

      {modelSettingsOpen ? (
        <aside className="debug-drawer model-drawer" aria-label="模型配置面板">
          <header>
            <div>
              <h2>模型配置</h2>
              <p>配置前置 Router、主模型和会话压缩模型，保存到本地文件。</p>
            </div>
            <div className="debug-drawer__actions">
              <button type="button" onClick={() => void refreshModelSettings()} title="刷新">
                <RefreshCw size={16} />
              </button>
              <button type="button" onClick={() => setModelSettingsOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
          </header>

          <section className="model-settings">
            {modelSettings ? (
              <>
                {(["router", "main", "compression"] as const).map((role) => (
                  <ModelConfigEditor
                    config={modelSettings[role]}
                    key={role}
                    onChange={(config) => {
                      setModelSettings((current) => current ? { ...current, [role]: config } : current);
                    }}
                  />
                ))}
                <div className="model-settings__actions">
                  <button type="button" onClick={() => void saveModelSettings()}>
                    保存模型配置
                  </button>
                  <button type="button" onClick={() => applyMiMoNativePreset()}>
                    使用 MiMo 原生工具
                  </button>
                  <button type="button" onClick={() => applyDeepSeekPreset()}>
                    使用 DeepSeek 预设
                  </button>
                </div>
                {settingsStatus ? <p className="model-settings__status">{settingsStatus}</p> : null}
              </>
            ) : (
              <p className="debug-empty">正在读取模型配置...</p>
            )}
          </section>
        </aside>
      ) : null}
    </main>
  );

  async function refreshModelSettings(): Promise<void> {
    const settings = await window.workbench.getModelRuntimeSettings();
    setModelSettings(settings);
    setSettingsStatus(null);
  }

  async function saveModelSettings(): Promise<void> {
    if (!modelSettings) {
      return;
    }

    const saved = await window.workbench.saveModelRuntimeSettings(modelSettings);
    setModelSettings(saved);
    setSettingsStatus("已保存到 config/model-runtime.local.json");
  }

  function applyDeepSeekPreset(): void {
    setModelSettings((current) => {
      if (!current) {
        return current;
      }

      return {
        router: {
          ...current.router,
          label: "DeepSeek Router",
          providerKind: "openai-compatible",
          baseURL: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          temperature: 0.2,
          maxTokens: 768,
          toolCallingMode: "text-json",
          thinkingEnabled: false
        },
        main: {
          ...current.main,
          label: "DeepSeek Main",
          providerKind: "openai-compatible",
          baseURL: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          temperature: 0.7,
          maxTokens: 8192,
          toolCallingMode: "text-json",
          thinkingEnabled: false
        },
        compression: {
          ...current.compression,
          label: "DeepSeek Compression",
          providerKind: "openai-compatible",
          baseURL: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          temperature: 0.2,
          maxTokens: 1024,
          toolCallingMode: "text-json",
          thinkingEnabled: false
        }
      };
    });
    setSettingsStatus("已套用 DeepSeek 预设，请填写 API Key 后保存。");
  }

  function applyMiMoNativePreset(): void {
    setModelSettings((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        main: {
          ...current.main,
          label: "MiMo Native Main",
          providerKind: "openai-compatible",
          baseURL: MIMO_OPENAI_BASE_URL,
          model: MIMO_MODEL,
          temperature: 1,
          maxTokens: 8192,
          toolCallingMode: "native-openai",
          thinkingEnabled: true
        }
      };
    });
    setSettingsStatus("已切换主模型为 MiMo OpenAI 原生工具模式，请确认 API Key 后保存。");
  }
}

function MessageContent(props: {
  readonly content: string;
  readonly sender: ChatMessage["sender"];
}): JSX.Element {
  if (props.sender === "user") {
    return <div className="minimal-message__body">{props.content}</div>;
  }

  const sections = splitAssistantMessage(props.content);

  return (
    <div className="minimal-message__body minimal-message__body--assistant">
      {sections.map((section, index) => (
        <section className={`message-section message-section--${section.kind}`} key={`${section.kind}-${index}`}>
          {section.title ? <div className="message-section__title">{section.title}</div> : null}
          <div className="message-section__content">{section.content || "(empty)"}</div>
        </section>
      ))}
    </div>
  );
}

function splitAssistantMessage(content: string): readonly {
  readonly kind: "answer" | "tool" | "revision" | "system";
  readonly title: string;
  readonly content: string;
}[] {
  const markers = [
    { marker: "【工具结果整理】", kind: "tool" as const, title: "工具结果整理" },
    { marker: "【补充修正】", kind: "revision" as const, title: "补充修正" }
  ];
  const sections: Array<{
    readonly kind: "answer" | "tool" | "revision" | "system";
    readonly title: string;
    readonly content: string;
  }> = [];
  let rest = content;
  let currentKind: "answer" | "tool" | "revision" | "system" = "answer";
  let currentTitle = "正式回复";

  while (rest.length > 0) {
    const nextMarker = markers
      .map((item) => ({ ...item, index: rest.indexOf(item.marker) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => a.index - b.index)[0];

    if (!nextMarker) {
      pushMessageSection(sections, currentKind, currentTitle, rest);
      break;
    }

    pushMessageSection(sections, currentKind, currentTitle, rest.slice(0, nextMarker.index));
    rest = rest.slice(nextMarker.index + nextMarker.marker.length);
    currentKind = nextMarker.kind;
    currentTitle = nextMarker.title;
  }

  return sections.length > 0 ? sections : [{ kind: "answer", title: "正式回复", content }];
}

function pushMessageSection(
  sections: Array<{
    readonly kind: "answer" | "tool" | "revision" | "system";
    readonly title: string;
    readonly content: string;
  }>,
  kind: "answer" | "tool" | "revision" | "system",
  title: string,
  content: string
): void {
  const trimmed = content.trim();
  if (!trimmed) {
    return;
  }

  const systemNoticeIndex = trimmed.indexOf("[系统提示：");
  if (systemNoticeIndex > 0) {
    pushMessageSection(sections, kind, title, trimmed.slice(0, systemNoticeIndex));
    pushMessageSection(sections, "system", "系统提示", trimmed.slice(systemNoticeIndex));
    return;
  }

  sections.push({
    kind: trimmed.startsWith("[系统提示：") ? "system" : kind,
    title: trimmed.startsWith("[系统提示：") ? "系统提示" : title,
    content: trimmed
  });
}

function ModelConfigEditor(props: {
  readonly config: ModelRuntimeConfig;
  readonly onChange: (config: ModelRuntimeConfig) => void;
}): JSX.Element {
  const roleLabels: Record<ModelRuntimeRole, string> = {
    router: "前置 Router",
    main: "主对话模型",
    compression: "会话压缩模型"
  };

  function update(patch: Partial<ModelRuntimeConfig>): void {
    const next = normalizeLinkedModelConfig({
      ...props.config,
      ...patch
    });
    props.onChange(next);
  }

  const canUseNativeOpenAiTools = props.config.role === "main" && props.config.providerKind === "openai-compatible";

  return (
    <article className="model-card">
      <h3>{roleLabels[props.config.role]}</h3>
      <label>
        <span>名称</span>
        <input value={props.config.label} onChange={(event) => update({ label: event.target.value })} />
      </label>
      <label>
        <span>Provider</span>
        <select
          value={props.config.providerKind}
          onChange={(event) => update({ providerKind: event.target.value as ModelProviderKind })}
        >
          <option value="ollama">Ollama</option>
          <option value="openai-compatible">OpenAI Compatible</option>
          <option value="anthropic-compatible">Anthropic Compatible</option>
        </select>
      </label>
      <label>
        <span>Base URL</span>
        <input value={props.config.baseURL} onChange={(event) => update({ baseURL: event.target.value })} />
      </label>
      <label>
        <span>Model</span>
        <input value={props.config.model} onChange={(event) => update({ model: event.target.value })} />
      </label>
      <label>
        <span>API Key</span>
        <input
          type="password"
          value={props.config.apiKey}
          onChange={(event) => update({ apiKey: event.target.value })}
          placeholder={props.config.providerKind === "ollama" ? "Ollama 可留空" : "本地保存，不提交"}
        />
      </label>
      <div className="model-card__grid">
        <label>
          <span>Temperature</span>
          <input
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={props.config.temperature}
            onChange={(event) => update({ temperature: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>Max Tokens</span>
          <input
            type="number"
            min="1"
            step="1"
            value={props.config.maxTokens}
            onChange={(event) => update({ maxTokens: Number(event.target.value) })}
          />
        </label>
      </div>
      {props.config.role === "main" ? (
        <div className="model-card__grid">
          <label>
            <span>Tool Mode</span>
            <select
              value={props.config.toolCallingMode}
              disabled={!canUseNativeOpenAiTools}
              onChange={(event) => {
                const toolCallingMode = event.target.value as ModelToolCallingMode;
                update({
                  toolCallingMode,
                  thinkingEnabled: toolCallingMode === "native-openai"
                });
              }}
            >
              <option value="text-json">Text JSON</option>
              <option value="native-openai">Native OpenAI</option>
            </select>
          </label>
          <label className="model-card__check">
            <input
              type="checkbox"
              checked={props.config.thinkingEnabled}
              disabled={!canUseNativeOpenAiTools}
              onChange={(event) => update({
                thinkingEnabled: event.target.checked,
                toolCallingMode: event.target.checked ? "native-openai" : "text-json"
              })}
            />
            <span>Thinking</span>
          </label>
        </div>
      ) : null}
      {props.config.role === "main" ? (
        <p className="model-card__hint">
          Native OpenAI 会自动绑定 OpenAI Compatible 和 Thinking；切到其他 Provider 时会回到 Text JSON。
        </p>
      ) : null}
    </article>
  );
}

function normalizeLinkedModelConfig(config: ModelRuntimeConfig): ModelRuntimeConfig {
  if (config.role !== "main") {
    return config;
  }

  if (config.providerKind !== "openai-compatible") {
    return {
      ...config,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    };
  }

  if (config.toolCallingMode === "native-openai") {
    return {
      ...config,
      thinkingEnabled: true
    };
  }

  if (config.thinkingEnabled) {
    return {
      ...config,
      toolCallingMode: "native-openai"
    };
  }

  return {
    ...config,
    toolCallingMode: "text-json"
  };
}

function TraceView(props: {
  readonly events: readonly AgentEventRecord[];
  readonly logs: readonly ProviderDebugLog[];
  readonly onSelectTurn: (turnId: string) => void;
  readonly selectedTurnId?: string;
  readonly sessionId?: ChatSessionId;
}): JSX.Element {
  if (!props.sessionId) {
    return <p className="debug-empty">发送第一条消息后，这里会按步骤显示本轮 Agent 链路。</p>;
  }

  if (props.events.length === 0 && props.logs.length === 0) {
    return <p className="debug-empty">当前会话还没有 Trace 数据。</p>;
  }

  const turns = buildConversationTurns(props.events);
  const selectedTurn = turns.find((turn) => turn.id === props.selectedTurnId) ?? turns.at(-1);
  const visibleEvents = selectedTurn?.events ?? props.events;
  const visibleLogs = selectedTurn ? filterLogsForTurn(props.logs, selectedTurn) : props.logs;
  const steps = buildTraceSteps(visibleEvents, visibleLogs);
  const highlights = buildTraceHighlights(visibleEvents, visibleLogs);
  const nodeOutputs = buildNodeOutputs(visibleEvents, visibleLogs);
  const promptViews = buildPromptViews(visibleLogs);
  const infoFlows = buildInfoFlows(visibleEvents, visibleLogs);
  const reversedTurns = [...turns].reverse();

  return (
    <div className="trace-panel">
      {turns.length > 0 ? (
        <section className="turn-picker" aria-label="选择对话回合">
          {reversedTurns.map((turn) => (
            <button
              data-active={turn.id === selectedTurn?.id}
              key={turn.id}
              onClick={() => props.onSelectTurn(turn.id)}
              title={turn.userContent}
              type="button"
            >
              <span>第 {turn.index} 轮</span>
              <strong>{compactText(turn.userContent, 28)}</strong>
            </button>
          ))}
        </section>
      ) : null}

      <section className="trace-summary" aria-label="本轮摘要">
        <div>
          <span>步骤</span>
          <strong>{steps.filter((step) => step.present).length}/{steps.length}</strong>
        </div>
        <div>
          <span>模型请求</span>
          <strong>{visibleLogs.length}</strong>
        </div>
        <div>
          <span>事件</span>
          <strong>{visibleEvents.length}</strong>
        </div>
      </section>

      {highlights.length > 0 ? (
        <section className="trace-highlights" aria-label="本轮关键信息">
          <header>
            <span>本轮关键信息</span>
            <strong>{selectedTurn ? `第 ${selectedTurn.index} 轮` : "当前会话"}</strong>
          </header>
          <dl>
            {highlights.map((item) => (
              <div data-tone={item.tone ?? "default"} key={item.label}>
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {nodeOutputs.length > 0 ? (
        <section className="node-output-panel" aria-label="节点产物">
          <header>
            <span>节点产物</span>
            <strong>看每一步产出了什么</strong>
          </header>
          <div className="node-output-grid">
            {nodeOutputs.map((node) => (
              <article className="node-output-card" data-status={node.status} key={node.id}>
                <header>
                  <div>
                    <span>{node.kind}</span>
                    <h3>{node.title}</h3>
                  </div>
                  <strong>{node.badge}</strong>
                </header>
                <p>{node.output}</p>
                {node.fields.length > 0 ? (
                  <dl>
                    {node.fields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {node.details.length > 0 ? (
                  <div className="node-output-details">
                    {node.details.map((item) => (
                      <details className="debug-details" key={item.label}>
                        <summary>{item.label}</summary>
                        <pre>{item.content}</pre>
                      </details>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {promptViews.length > 0 ? (
        <section className="prompt-panel" aria-label="提示词">
          <header>
            <span>提示词</span>
            <strong>看每次模型调用的最终拼装结果</strong>
          </header>
          <div className="prompt-grid">
            {promptViews.map((prompt) => (
              <article className="prompt-card" data-status={prompt.status} key={prompt.id}>
                <header>
                  <div>
                    <span>{prompt.providerId}</span>
                    <h3>{prompt.title}</h3>
                  </div>
                  <strong>{prompt.model}</strong>
                </header>
                <p>{prompt.purpose}</p>
                <section className="prompt-template">
                  <h4>模板</h4>
                  <dl>
                    <div>
                      <dt>名称</dt>
                      <dd>{prompt.template.name}</dd>
                    </div>
                    <div>
                      <dt>版本</dt>
                      <dd>{prompt.template.version}</dd>
                    </div>
                    <div>
                      <dt>变量</dt>
                      <dd>{prompt.template.variables.join(" / ") || "none"}</dd>
                    </div>
                  </dl>
                  <details className="debug-details">
                    <summary>模板模块</summary>
                    <pre>{prompt.template.files.join("\n")}</pre>
                  </details>
                </section>
                <dl>
                  {prompt.parameters.map((field) => (
                    <div key={field.label}>
                      <dt>{field.label}</dt>
                      <dd>{field.value}</dd>
                    </div>
                  ))}
                </dl>
                {prompt.system ? (
                  <section className="prompt-system">
                    <h4>System</h4>
                    <pre>{prompt.system}</pre>
                  </section>
                ) : null}
                {prompt.messages.length > 0 ? (
                  <ol className="prompt-message-list">
                    {prompt.messages.map((message, index) => (
                      <li key={`${prompt.id}-${index}`}>
                        <span>{message.role}</span>
                        <pre>{message.content || "(empty)"}</pre>
                      </li>
                    ))}
                  </ol>
                ) : null}
                <details className="debug-details">
                  <summary>完整提示词请求</summary>
                  <pre>{prompt.raw}</pre>
                </details>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {infoFlows.length > 0 ? (
        <section className="info-flow-panel" aria-label="输出信息">
          <header>
            <span>输出信息</span>
            <strong>看信息怎么流动</strong>
          </header>
          <ol>
            {infoFlows.map((item) => (
              <li className="info-flow-item" data-tone={item.tone ?? "default"} key={item.id}>
                <div>
                  <span>{item.from}</span>
                  <strong>{item.to}</strong>
                </div>
                <article>
                  <h3>{item.title}</h3>
                  <p>{item.content}</p>
                  {item.raw ? (
                    <details className="debug-details">
                      <summary>{item.rawLabel ?? "完整内容"}</summary>
                      <pre>{item.raw}</pre>
                    </details>
                  ) : null}
                </article>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <details className="trace-timeline">
        <summary>时间线明细</summary>
        <ol className="trace-steps">
          {steps.map((step) => (
            <li className="trace-step" data-present={step.present} data-status={step.status} key={step.id}>
              <div className="trace-step__icon" aria-hidden="true">
                {step.present ? <CheckCircle2 size={16} /> : <CircleDashed size={16} />}
              </div>
              <article>
                <header>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.summary}</p>
                  </div>
                  <span>{step.badge}</span>
                </header>
                {step.fields.length > 0 ? (
                  <dl className="trace-fields">
                    {step.fields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
                {step.raw ? (
                  <details className="debug-details">
                    <summary>{step.rawLabel ?? "原始数据"}</summary>
                    <pre>{step.raw}</pre>
                  </details>
                ) : null}
                {step.related.length > 0 ? (
                  <div className="trace-related">
                    {step.related.map((item) => (
                      <details className="debug-details" key={item.label}>
                        <summary>{item.label}</summary>
                        <pre>{item.content}</pre>
                      </details>
                    ))}
                  </div>
                ) : null}
              </article>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}

interface TraceStep {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly badge: string;
  readonly present: boolean;
  readonly status: "done" | "pending" | "failed";
  readonly fields: readonly { readonly label: string; readonly value: string }[];
  readonly rawLabel?: string;
  readonly raw?: string;
  readonly related: readonly { readonly label: string; readonly content: string }[];
}

interface TraceHighlight {
  readonly label: string;
  readonly value: string;
  readonly tone?: "default" | "success" | "warning" | "danger";
}

interface EvaluationDisplay {
  readonly badge: string;
  readonly status: "done" | "pending" | "failed" | "skipped";
  readonly tone: "default" | "success" | "warning" | "danger";
  readonly action: string;
  readonly summary: string;
}

interface NodeOutput {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly badge: string;
  readonly status: "done" | "pending" | "failed" | "skipped";
  readonly output: string;
  readonly fields: readonly { readonly label: string; readonly value: string }[];
  readonly details: readonly { readonly label: string; readonly content: string }[];
}

interface PromptView {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly providerId: string;
  readonly model: string;
  readonly status: ProviderDebugLog["status"];
  readonly template: PromptTemplateView;
  readonly system: string;
  readonly messages: readonly { readonly role: string; readonly content: string }[];
  readonly parameters: readonly { readonly label: string; readonly value: string }[];
  readonly raw: string;
}

interface PromptTemplateView {
  readonly name: string;
  readonly version: string;
  readonly files: readonly string[];
  readonly variables: readonly string[];
}

interface InfoFlowItem {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly title: string;
  readonly content: string;
  readonly tone?: "default" | "success" | "warning" | "danger";
  readonly rawLabel?: string;
  readonly raw?: string;
}

interface ConversationTurn {
  readonly id: string;
  readonly index: number;
  readonly userContent: string;
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly events: readonly AgentEventRecord[];
}

function buildConversationTurns(events: readonly AgentEventRecord[]): readonly ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let currentTurn: {
    id: string;
    index: number;
    userContent: string;
    startedAt: string;
    events: AgentEventRecord[];
  } | undefined;

  for (const event of events) {
    if (event.type === "chat_message" && event.actor === "user") {
      if (currentTurn) {
        turns.push({
          ...currentTurn,
          endedAt: event.createdAt
        });
      }

      currentTurn = {
        id: event.messageId ?? event.id,
        index: turns.length + 1,
        userContent: event.content ?? "用户输入",
        startedAt: event.createdAt,
        events: [event]
      };
      continue;
    }

    currentTurn?.events.push(event);
  }

  if (currentTurn) {
    turns.push(currentTurn);
  }

  return turns;
}

function getLatestTurnId(events: readonly AgentEventRecord[]): string | undefined {
  return buildConversationTurns(events).at(-1)?.id;
}

function filterLogsForTurn(logs: readonly ProviderDebugLog[], turn: ConversationTurn): readonly ProviderDebugLog[] {
  const startTime = new Date(turn.startedAt).getTime() - 1000;
  const endTime = turn.endedAt ? new Date(turn.endedAt).getTime() - 1 : Number.POSITIVE_INFINITY;

  return logs.filter((log) => {
    const logTime = new Date(log.startedAt).getTime();
    return logTime >= startTime && logTime <= endTime;
  });
}

function buildTraceHighlights(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly TraceHighlight[] {
  const userMessage = events.find((event) => event.type === "chat_message" && event.actor === "user");
  const routerPayload = asRecord(findLastEvent(events, "router_result")?.payload);
  const toolPayload = asRecord(findLastEvent(events, "tool_selection")?.payload);
  const evaluationPayload = asRecord(findLastEvent(events, "output_evaluation")?.payload);
  const errorEvent = findLastEvent(events, "error");
  const mainModelLog = findLast(logs, (log) => log.providerId.includes("main") || log.providerId.includes("anthropic") || log.providerId.includes("openai"));
  const evaluationDisplay = Object.keys(evaluationPayload).length > 0 ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
  const items: TraceHighlight[] = [];

  if (userMessage?.content) {
    items.push({
      label: "用户输入",
      value: compactText(userMessage.content, 80)
    });
  }

  if (Object.keys(routerPayload).length > 0) {
    items.push(
      {
        label: "意图",
        value: joinNonEmpty([
          stringField(routerPayload, "intent"),
          stringField(routerPayload, "task_type")
        ], " / ") || "-"
      },
      {
        label: "任务目标",
        value: compactText(stringField(routerPayload, "task_goal") || stringField(routerPayload, "rewritten_input") || "-", 100)
      },
      {
        label: "计划步骤",
        value: compactText(stringArrayField(routerPayload, "planned_steps") || "-", 100)
      },
      {
        label: "置信度",
        value: numberField(routerPayload, "confidence"),
        tone: confidenceTone(routerPayload)
      }
    );
  }

  if (Object.keys(toolPayload).length > 0 || booleanRaw(routerPayload, "needs_tools")) {
    items.push({
      label: "工具",
      value: formatToolHighlight(routerPayload, toolPayload),
      tone: stringArrayField(toolPayload, "selected_tools") ? "success" : booleanRaw(routerPayload, "needs_tools") ? "warning" : "default"
    });
  }

  if (mainModelLog) {
    items.push({
      label: "主模型",
      value: joinNonEmpty([
        mainModelLog.model,
        mainModelLog.response?.stopReason ? `stop=${mainModelLog.response.stopReason}` : "",
        mainModelLog.durationMs ? `${mainModelLog.durationMs}ms` : ""
      ], " / "),
      tone: mainModelLog.status === "failed" ? "danger" : mainModelLog.response?.stopReason === "max_tokens" ? "warning" : "success"
    });
  }

  if (evaluationDisplay) {
    items.push({
      label: "输出验收",
      value: joinNonEmpty([
        evaluationDisplay.badge,
        evaluationDisplay.action,
        compactText(stringArrayField(evaluationPayload, "missing_criteria"), 80)
      ], " / "),
      tone: evaluationDisplay.tone
    });
  }

  if (errorEvent) {
    items.push({
      label: "错误",
      value: compactText(errorEvent.content ?? "未知错误", 100),
      tone: "danger"
    });
  }

  return items;
}

function buildNodeOutputs(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly NodeOutput[] {
  const routerEvent = findLastEvent(events, "router_result");
  const memoryWriteEvent = findLastEvent(events, "memory_write");
  const memoryRecallEvent = findLastEvent(events, "memory_recall");
  const toolSelectionEvent = findLastEvent(events, "tool_selection");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const evaluationEvent = findLastEvent(events, "output_evaluation");
  const promptIterationEvent = findLastEvent(events, "prompt_iteration");
  const assistantMessage = findLast(events, (event) => event.type === "chat_message" && event.actor === "assistant");
  const errorEvent = findLastEvent(events, "error");
  const routerPayload = asRecord(routerEvent?.payload);
  const memoryWritePayload = asRecord(memoryWriteEvent?.payload);
  const memoryRecallPayload = asRecord(memoryRecallEvent?.payload);
  const toolPayload = asRecord(toolSelectionEvent?.payload);
  const evaluationPayload = asRecord(evaluationEvent?.payload);
  const promptIterationPayload = asRecord(promptIterationEvent?.payload);
  const evaluationDisplay = evaluationEvent ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
  const routerLog = findRouterLog(logs);
  const mainModelLog = findMainModelLog(logs);
  const evaluatorLog = findEvaluatorLog(logs);
  const nodes: NodeOutput[] = [];

  nodes.push({
    id: "router",
    kind: "Router",
    title: "意图识别产物",
    badge: routerEvent ? "完成" : "等待",
    status: routerEvent ? "done" : "pending",
    output: routerEvent
      ? compactText(joinNonEmpty([
          stringField(routerPayload, "rewritten_input"),
          stringField(routerPayload, "task_goal"),
          stringField(routerPayload, "reasoning_brief"),
          stringField(routerPayload, "tool_reason")
        ], " | "), 150) || "Router 已产出结构化结果"
      : "等待小模型产出意图、任务类型、工具建议和验收条件。",
    fields: [
      { label: "intent", value: stringField(routerPayload, "intent") || "-" },
      { label: "taskType", value: stringField(routerPayload, "task_type") || "-" },
      { label: "steps", value: compactText(stringArrayField(routerPayload, "planned_steps") || "-", 96) },
      { label: "output", value: compactText(stringField(routerPayload, "expected_output") || "-", 96) },
      { label: "confidence", value: numberField(routerPayload, "confidence") },
      { label: "criteria", value: compactText(stringArrayField(routerPayload, "success_criteria") || "-", 96) }
    ],
    details: [
      ...(routerEvent ? [{ label: "Router 结构化产物", content: formatJson(routerPayload) }] : []),
      ...(routerLog ? modelLogDetails(routerLog) : [])
    ]
  });

  nodes.push({
    id: "tool-policy",
    kind: "Core",
    title: "工具策略产物",
    badge: toolSelectionEvent ? stringField(toolPayload, "access_mode") || "完成" : "等待",
    status: toolSelectionEvent ? "done" : "pending",
    output: toolSelectionEvent
      ? compactText(stringField(toolPayload, "reason") || formatToolHighlight(routerPayload, toolPayload), 150)
      : "等待 Core 根据 Router 结果选择本轮可开放工具。",
    fields: [
      { label: "tools", value: stringArrayField(toolPayload, "selected_tools") || "none" },
      { label: "mode", value: stringField(toolPayload, "access_mode") || "-" },
      { label: "auto", value: booleanField(toolPayload, "auto_allowed") }
    ],
    details: toolSelectionEvent ? [{ label: "工具策略 JSON", content: formatJson(toolPayload) }] : []
  });

  nodes.push({
    id: "memory",
    kind: "Memory",
    title: "长期记忆产物",
    badge: memoryRecallEvent ? `${arrayField(memoryRecallPayload, "memories").length} recalled` : memoryWriteEvent ? "已写入" : "跳过",
    status: memoryRecallEvent || memoryWriteEvent ? "done" : "skipped",
    output: formatMemoryOutput(memoryWritePayload, memoryRecallPayload),
    fields: [
      { label: "write", value: String(arrayField(memoryWritePayload, "memories").length) },
      { label: "recall", value: String(arrayField(memoryRecallPayload, "memories").length) }
    ],
    details: [
      ...(memoryWriteEvent ? [{ label: "写入记忆", content: formatJson(memoryWritePayload) }] : []),
      ...(memoryRecallEvent ? [{ label: "召回记忆", content: formatJson(memoryRecallPayload) }] : [])
    ]
  });

  nodes.push({
    id: "context-package",
    kind: "Context",
    title: "大模型输入产物",
    badge: mainModelLog ? `${mainModelLog.request.messageCount} messages` : "等待",
    status: mainModelLog ? "done" : "pending",
    output: mainModelLog
      ? compactText(mainModelLog.request.latestUserMessage ?? readModelRequestMessages(mainModelLog).at(-1)?.content ?? "已组装大模型请求。", 150)
      : "等待上下文构建后形成大模型请求。",
    fields: [
      { label: "provider", value: mainModelLog?.providerId ?? "-" },
      { label: "model", value: mainModelLog?.model ?? "-" },
      { label: "messages", value: mainModelLog ? String(mainModelLog.request.messageCount) : "-" }
    ],
    details: mainModelLog ? [{ label: "大模型输入", content: formatModelRequest(mainModelLog) }] : []
  });

  nodes.push({
    id: "main-model",
    kind: "Model",
    title: "主模型产物",
    badge: mainModelLog?.response?.stopReason ?? mainModelLog?.status ?? "等待",
    status: mainModelLog?.status === "failed" ? "failed" : mainModelLog ? "done" : "pending",
    output: mainModelLog?.response
      ? compactText(formatModelResponseSummary(mainModelLog.response), 180)
      : mainModelLog?.error ? compactText(mainModelLog.error, 180) : "等待主模型返回内容。",
    fields: [
      { label: "duration", value: mainModelLog?.durationMs ? `${mainModelLog.durationMs}ms` : "-" },
      { label: "stop", value: mainModelLog?.response?.stopReason ?? "-" },
      { label: "status", value: mainModelLog?.status ?? "-" }
    ],
    details: mainModelLog ? modelLogDetails(mainModelLog) : []
  });

  nodes.push({
    id: "tools",
    kind: "Tools",
    title: "工具执行产物",
    badge: toolCallEvents.length > 0 ? `${toolResultEvents.length}/${toolCallEvents.length}` : "跳过",
    status: toolResultEvents.some((event) => stringField(asRecord(event.payload), "status") === "failed") ? "failed" : toolCallEvents.length > 0 ? "done" : "skipped",
    output: toolCallEvents.length > 0
      ? compactText(formatToolEventsSummary(toolCallEvents, toolResultEvents), 180)
      : "本轮没有执行工具。",
    fields: [
      { label: "calls", value: String(toolCallEvents.length) },
      { label: "results", value: String(toolResultEvents.length) }
    ],
    details: toolCallEvents.length > 0 || toolResultEvents.length > 0
      ? [{ label: "工具调用与结果", content: formatJson({ calls: toolCallEvents, results: toolResultEvents }) }]
      : []
  });

  nodes.push({
    id: "evaluator",
    kind: "Evaluator",
    title: "输出验收产物",
    badge: evaluationDisplay?.badge ?? "跳过",
    status: evaluationDisplay?.status ?? "skipped",
    output: evaluationEvent
      ? compactText(joinNonEmpty([
          evaluationDisplay?.summary,
          stringField(evaluationPayload, "decision_reason")
        ], " | "), 180)
      : "普通聊天或本轮未触发输出验收。",
    fields: [
      { label: "action", value: evaluationDisplay?.action ?? "-" },
      { label: "passed", value: booleanField(evaluationPayload, "passed") },
      { label: "checks", value: compactText(stringArrayField(evaluationPayload, "check_steps") || "-", 96) },
      { label: "confidence", value: numberField(evaluationPayload, "confidence") },
      { label: "missing", value: compactText(stringArrayField(evaluationPayload, "missing_criteria") || "none", 96) }
    ],
    details: [
      ...(evaluationEvent ? [{ label: "验收结果 JSON", content: formatJson(evaluationPayload) }] : []),
      ...(evaluatorLog ? modelLogDetails(evaluatorLog) : [])
    ]
  });

  nodes.push({
    id: "prompt-iteration",
    kind: "Prompt",
    title: "提示词迭代候选",
    badge: promptIterationEvent ? stringField(promptIterationPayload, "status") || "proposed" : "跳过",
    status: promptIterationEvent ? "pending" : "skipped",
    output: promptIterationEvent
      ? compactText(stringField(promptIterationPayload, "suggestedChange") || promptIterationEvent.content || "已生成提示词迭代候选。", 180)
      : "本轮没有生成提示词迭代候选。",
    fields: [
      { label: "template", value: stringField(promptIterationPayload, "targetTemplate") || "-" },
      { label: "trigger", value: stringField(promptIterationPayload, "trigger") || "-" }
    ],
    details: promptIterationEvent ? [{ label: "提示词迭代候选 JSON", content: formatJson(promptIterationPayload) }] : []
  });

  nodes.push({
    id: "final-output",
    kind: "Output",
    title: "最终回复产物",
    badge: errorEvent ? "错误" : assistantMessage ? "完成" : "等待",
    status: errorEvent ? "failed" : assistantMessage ? "done" : "pending",
    output: assistantMessage?.content
      ? compactText(assistantMessage.content, 180)
      : errorEvent?.content ? compactText(errorEvent.content, 180) : "等待写入最终回复。",
    fields: [
      { label: "message", value: assistantMessage?.messageId ?? "-" },
      { label: "time", value: assistantMessage ? formatTime(assistantMessage.createdAt) : "-" }
    ],
    details: assistantMessage
      ? [{ label: "最终回复完整内容", content: assistantMessage.content ?? "" }]
      : errorEvent ? [{ label: "错误事件", content: formatJson(errorEvent) }] : []
  });

  return nodes;
}

function buildPromptViews(logs: readonly ProviderDebugLog[]): readonly PromptView[] {
  return [
    promptViewFromLog(findRouterLog(logs), {
      id: "router-prompt",
      title: "Router 提示词",
      purpose: "小模型用于识别意图、任务类型、工具需求和验收条件。",
      template: {
        name: "router.intent.v1",
        version: "v1",
        files: [
          "packages/memorizes/intent/01-parser.md",
          "packages/memorizes/intent/02-input.md"
        ],
        variables: ["recent_messages", "input"]
      }
    }),
    promptViewFromLog(findMainModelLog(logs), {
      id: "main-prompt",
      title: "主模型提示词",
      purpose: "大模型用于生成本轮面向用户或工具执行后的回复。",
      template: {
        name: "main.agent.v1",
        version: "v1",
        files: [
          "packages/memorizes/system/01-role.md",
          "packages/memorizes/system/02-goals.md",
          "packages/memorizes/system/03-style.md",
          "packages/memorizes/context/intent-result.md"
        ],
        variables: ["intent_result", "messages"]
      }
    }),
    promptViewFromLog(findEvaluatorLog(logs), {
      id: "evaluator-prompt",
      title: "Evaluator 提示词",
      purpose: "小模型用于判断主模型输出是否满足本轮成功条件。",
      template: {
        name: "output.evaluator.v1",
        version: "v1",
        files: [
          "packages/memorizes/evaluator/01-system.md",
          "packages/memorizes/evaluator/02-input.md"
        ],
        variables: ["user_input", "router_result", "assistant_answer"]
      }
    })
  ].filter((view): view is PromptView => Boolean(view));
}

function promptViewFromLog(
  log: ProviderDebugLog | undefined,
  info: {
    readonly id: string;
    readonly title: string;
    readonly purpose: string;
    readonly template: PromptTemplateView;
  }
): PromptView | undefined {
  if (!log) {
    return undefined;
  }

  const body = asRecord(log.request.body);
  const options = asRecord(body.options);
  const messages = readModelRequestMessages(log);
  const system = stringField(body, "system");
  const systemFromMessages = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  return {
    id: info.id,
    title: info.title,
    purpose: info.purpose,
    providerId: log.providerId,
    model: stringField(body, "model") || log.model,
    status: log.status,
    template: info.template,
    system: system || systemFromMessages,
    messages,
    parameters: [
      { label: "status", value: log.status },
      { label: "messages", value: String(log.request.messageCount) },
      { label: "temperature", value: numberOrFallback(body, "temperature", options, "temperature") },
      { label: "max", value: numberField(body, "max_tokens") !== "-" ? numberField(body, "max_tokens") : numberField(options, "num_predict") },
      { label: "stream", value: booleanField(body, "stream") }
    ],
    raw: formatModelRequest(log)
  };
}

function buildInfoFlows(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly InfoFlowItem[] {
  const userMessage = events.find((event) => event.type === "chat_message" && event.actor === "user");
  const routerEvent = findLastEvent(events, "router_result");
  const toolSelectionEvent = findLastEvent(events, "tool_selection");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const evaluationEvent = findLastEvent(events, "output_evaluation");
  const assistantMessage = findLast(events, (event) => event.type === "chat_message" && event.actor === "assistant");
  const routerLog = findRouterLog(logs);
  const mainModelLog = findMainModelLog(logs);
  const evaluatorLog = findEvaluatorLog(logs);
  const flows: InfoFlowItem[] = [];

  if (userMessage?.content) {
    flows.push({
      id: "user-to-router",
      from: "User",
      to: "Router",
      title: "用户输入进入意图识别",
      content: compactText(userMessage.content, 140),
      rawLabel: "用户输入",
      raw: userMessage.content
    });
  }

  if (routerLog) {
    flows.push({
      id: "router-request",
      from: "Core",
      to: "小模型",
      title: "小模型请求",
      content: compactText(routerLog.request.latestUserMessage ?? readModelRequestMessages(routerLog).at(-1)?.content ?? "已发送 Router 请求。", 140),
      rawLabel: "Router 请求",
      raw: formatModelRequest(routerLog)
    });
  }

  if (routerEvent) {
    const routerPayload = asRecord(routerEvent.payload);
    flows.push({
      id: "router-output",
      from: "Router",
      to: "Core",
      title: "Router 返回结构化产物",
      content: compactText(joinNonEmpty([
        stringField(routerPayload, "intent"),
        stringField(routerPayload, "task_type"),
        stringField(routerPayload, "task_goal")
      ], " / "), 140),
      rawLabel: "Router 输出 JSON",
      raw: formatJson(routerPayload),
      tone: confidenceTone(routerPayload)
    });
  }

  if (toolSelectionEvent) {
    const toolPayload = asRecord(toolSelectionEvent.payload);
    flows.push({
      id: "tool-policy-output",
      from: "Core",
      to: "Model",
      title: "本轮工具开放信息",
      content: compactText(formatToolHighlight(asRecord(routerEvent?.payload), toolPayload), 140),
      rawLabel: "工具策略",
      raw: formatJson(toolPayload),
      tone: stringArrayField(toolPayload, "selected_tools") ? "success" : "default"
    });
  }

  if (mainModelLog) {
    flows.push({
      id: "main-request",
      from: "Core",
      to: "大模型",
      title: "大模型上下文包",
      content: compactText(formatModelMessagesSummary(mainModelLog), 150),
      rawLabel: "大模型请求",
      raw: formatModelRequest(mainModelLog)
    });
  }

  if (mainModelLog?.response?.content) {
    flows.push({
      id: "main-response",
      from: "大模型",
      to: "Core",
      title: "大模型返回",
      content: compactText(formatModelResponseSummary(mainModelLog.response), 160),
      rawLabel: "大模型响应",
      raw: formatResponse(mainModelLog.response),
      tone: mainModelLog.response.stopReason === "max_tokens" ? "warning" : "success"
    });
  }

  if (toolCallEvents.length > 0 || toolResultEvents.length > 0) {
    flows.push({
      id: "tool-io",
      from: "Core",
      to: "Tools",
      title: "工具输入与输出",
      content: compactText(formatToolEventsSummary(toolCallEvents, toolResultEvents), 160),
      rawLabel: "工具事件",
      raw: formatJson({ calls: toolCallEvents, results: toolResultEvents }),
      tone: toolResultEvents.some((event) => stringField(asRecord(event.payload), "status") === "failed") ? "danger" : "success"
    });
  }

  if (evaluatorLog || evaluationEvent) {
    const evaluationPayload = asRecord(evaluationEvent?.payload);
    const evaluationDisplay = evaluationEvent ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
    flows.push({
      id: "evaluation-flow",
      from: "Core",
      to: "Evaluator",
      title: "输出验收",
      content: evaluationDisplay?.summary ?? "已发送输出验收请求。",
      rawLabel: "验收请求/返回",
      raw: formatJson({
        request: evaluatorLog ? formatModelRequest(evaluatorLog) : undefined,
        result: evaluationEvent?.payload
      }),
      tone: evaluationDisplay?.tone ?? "default"
    });
  }

  if (assistantMessage?.content) {
    flows.push({
      id: "final-response",
      from: "Core",
      to: "User",
      title: "最终展示给用户",
      content: compactText(assistantMessage.content, 160),
      rawLabel: "最终回复",
      raw: assistantMessage.content,
      tone: "success"
    });
  }

  return flows;
}

function buildTraceSteps(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly TraceStep[] {
  const userMessage = events.find((event) => event.type === "chat_message" && event.actor === "user");
  const routerEvent = findLastEvent(events, "router_result");
  const toolSelectionEvent = findLastEvent(events, "tool_selection");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const modelReturnEvents = events.filter((event) => event.type === "model_return");
  const evaluationEvent = findLastEvent(events, "output_evaluation");
  const assistantMessage = findLast(events, (event) => event.type === "chat_message" && event.actor === "assistant");
  const errorEvent = findLastEvent(events, "error");
  const routerPayload = asRecord(routerEvent?.payload);
  const toolPayload = asRecord(toolSelectionEvent?.payload);
  const evaluationPayload = asRecord(evaluationEvent?.payload);
  const evaluationDisplay = evaluationEvent ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
  const mainModelLog = findLast(logs, (log) => log.providerId.includes("main") || log.providerId.includes("anthropic") || log.providerId.includes("openai"));
  const routerLog = findLast(logs, (log) => log.providerId.includes("router") || log.providerId.includes("intent"));
  const evaluatorLog = findLast(logs, (log) => log.providerId.includes("evaluator"));

  return [
    {
      id: "input",
      title: "用户输入",
      summary: userMessage?.content ? compactText(userMessage.content, 96) : "等待用户消息写入事件链",
      badge: userMessage ? formatTime(userMessage.createdAt) : "等待",
      present: Boolean(userMessage),
      status: "done",
      fields: [
        { label: "messageId", value: userMessage?.messageId ?? "-" }
      ],
      rawLabel: "chat_message event",
      raw: userMessage ? formatJson(userMessage) : undefined,
      related: []
    },
    {
      id: "router",
      title: "Router 意图识别",
      summary: routerEvent ? `${stringField(routerPayload, "intent")} / ${stringField(routerPayload, "task_type")}` : "等待 Router 结果",
      badge: routerEvent ? "完成" : "等待",
      present: Boolean(routerEvent),
      status: "done",
      fields: [
        { label: "意图", value: stringField(routerPayload, "intent") },
        { label: "类型", value: stringField(routerPayload, "task_type") },
        { label: "任务", value: booleanField(routerPayload, "is_task") },
        { label: "置信度", value: numberField(routerPayload, "confidence") },
        { label: "验收问题", value: compactText(stringField(routerPayload, "verification_question"), 120) },
        { label: "成功条件", value: stringArrayField(routerPayload, "success_criteria") }
      ],
      rawLabel: "router_result event",
      raw: routerEvent ? formatJson(routerPayload) : undefined,
      related: routerLog ? modelLogDetails(routerLog) : []
    },
    {
      id: "tool-selection",
      title: "Core 工具策略",
      summary: toolSelectionEvent ? stringField(toolPayload, "reason") || "工具策略已计算" : "等待工具策略",
      badge: toolSelectionEvent ? stringField(toolPayload, "access_mode") : "等待",
      present: Boolean(toolSelectionEvent),
      status: "done",
      fields: [
        { label: "开放工具", value: stringArrayField(toolPayload, "selected_tools") || "none" },
        { label: "权限", value: stringField(toolPayload, "access_mode") },
        { label: "自动开放", value: booleanField(toolPayload, "auto_allowed") }
      ],
      rawLabel: "tool_selection event",
      raw: toolSelectionEvent ? formatJson(toolPayload) : undefined,
      related: []
    },
    {
      id: "main-model",
      title: "主模型回复",
      summary: mainModelLog?.response ? compactText(formatModelResponseSummary(mainModelLog.response), 110) : "等待主模型返回",
      badge: mainModelLog?.status ?? (modelReturnEvents.length > 0 ? "完成" : "等待"),
      present: Boolean(mainModelLog || modelReturnEvents.length > 0),
      status: mainModelLog?.status === "failed" ? "failed" : "done",
      fields: [
        { label: "Provider", value: mainModelLog?.providerId ?? "-" },
        { label: "Model", value: mainModelLog?.model ?? "-" },
        { label: "耗时", value: mainModelLog?.durationMs ? `${mainModelLog.durationMs}ms` : "-" },
        { label: "Stop", value: mainModelLog?.response?.stopReason ?? "-" }
      ],
      rawLabel: "model_return events",
      raw: modelReturnEvents.length > 0 ? formatJson(modelReturnEvents) : undefined,
      related: mainModelLog ? modelLogDetails(mainModelLog) : []
    },
    {
      id: "tools",
      title: "工具执行",
      summary: toolCallEvents.length > 0 ? `${toolCallEvents.length} 个请求，${toolResultEvents.length} 个结果` : "本轮未执行工具",
      badge: toolCallEvents.length > 0 ? "已触发" : "跳过",
      present: true,
      status: toolResultEvents.some((event) => stringField(asRecord(event.payload), "status") === "failed") ? "failed" : "done",
      fields: [
        { label: "请求数", value: String(toolCallEvents.length) },
        { label: "结果数", value: String(toolResultEvents.length) }
      ],
      rawLabel: "tool_call / tool_result events",
      raw: toolCallEvents.length > 0 || toolResultEvents.length > 0 ? formatJson({ calls: toolCallEvents, results: toolResultEvents }) : undefined,
      related: []
    },
    {
      id: "evaluation",
      title: "输出验收",
      summary: evaluationDisplay?.summary ?? "普通聊天或本轮尚未触发验收",
      badge: evaluationDisplay?.badge ?? "跳过",
      present: true,
      status: evaluationDisplay?.status === "failed" ? "failed" : "done",
      fields: [
        { label: "是否通过", value: booleanField(evaluationPayload, "passed") },
        { label: "下一步", value: evaluationDisplay?.action ?? "-" },
        { label: "缺失项", value: stringArrayField(evaluationPayload, "missing_criteria") || "none" }
      ],
      rawLabel: "output_evaluation event",
      raw: evaluationEvent ? formatJson(evaluationPayload) : undefined,
      related: evaluatorLog ? modelLogDetails(evaluatorLog) : []
    },
    {
      id: "final",
      title: "最终回复",
      summary: assistantMessage?.content ? compactText(assistantMessage.content, 110) : errorEvent ? compactText(errorEvent.content ?? "出现错误", 110) : "等待最终回复",
      badge: errorEvent ? "错误" : assistantMessage ? "完成" : "等待",
      present: Boolean(assistantMessage || errorEvent),
      status: errorEvent ? "failed" : "done",
      fields: [
        { label: "messageId", value: assistantMessage?.messageId ?? "-" },
        { label: "错误", value: errorEvent?.content ? compactText(errorEvent.content, 120) : "-" }
      ],
      rawLabel: assistantMessage ? "assistant chat_message event" : "error event",
      raw: assistantMessage ? formatJson(assistantMessage) : errorEvent ? formatJson(errorEvent) : undefined,
      related: []
    }
  ];
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatResponse(response: ProviderDebugLog["response"]): string {
  if (!response) {
    return "";
  }

  const native = parseNativeModelResponse(response.content);
  if (native) {
    return [
      `stopReason: ${response.stopReason ?? "-"}`,
      `usage: ${formatJson(response.usage ?? {})}`,
      "",
      "【正式产出 content】",
      native.content || "(empty)",
      "",
      "【模型思考 reasoning_content】",
      native.reasoningContent || "(empty)",
      "",
      "【工具调用 tool_calls】",
      native.toolCalls.length > 0 ? formatJson(native.toolCalls) : "none"
    ].join("\n");
  }

  return [
    `stopReason: ${response.stopReason ?? "-"}`,
    `usage: ${formatJson(response.usage ?? {})}`,
    "",
    response.content
  ].join("\n");
}

function formatModelResponseSummary(response: ProviderDebugLog["response"]): string {
  if (!response) {
    return "";
  }

  const native = parseNativeModelResponse(response.content);
  if (!native) {
    return response.content;
  }

  return joinNonEmpty([
    native.content ? `正式产出：${native.content}` : "",
    native.toolCalls.length > 0 ? `工具调用：${native.toolCalls.map((call) => stringField(asRecord(call.function), "name") || call.id).join(" / ")}` : "",
    native.reasoningContent ? `思考：${compactText(native.reasoningContent, 80)}` : ""
  ], "\n") || "(empty)";
}

function parseNativeModelResponse(content: string): {
  readonly reasoningContent: string;
  readonly content: string;
  readonly toolCalls: readonly Record<string, unknown>[];
} | undefined {
  const parsed = parseJsonValue(content);
  const record = asRecord(parsed);
  const hasNativeShape = "reasoning_content" in record || "tool_calls" in record;

  if (!hasNativeShape) {
    return undefined;
  }

  return {
    reasoningContent: stringField(record, "reasoning_content"),
    content: stringField(record, "content"),
    toolCalls: arrayField(record, "tool_calls").map(asRecord)
  };
}

function parseJsonValue(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function formatModelRequest(log: ProviderDebugLog): string {
  const body = asRecord(log.request.body);
  const lines = [
    `provider: ${log.providerId}`,
    `status: ${log.status}`,
    `method: ${log.request.method ?? "-"}`,
    `endpoint: ${log.request.endpoint ?? "-"}`,
    `model: ${stringField(body, "model") || log.model}`,
    `baseURL: ${log.baseURL ?? "-"}`,
    `duration: ${log.durationMs ? `${log.durationMs}ms` : "-"}`,
    `temperature: ${numberField(body, "temperature")}`,
    `max_tokens: ${numberField(body, "max_tokens")}`,
    `stream: ${booleanField(body, "stream")}`
  ];
  const system = stringField(body, "system");
  const messages = readMessages(body);
  const options = asRecord(body.options);

  if (Object.keys(options).length > 0) {
    lines.push("", "options:", formatIndented(formatJson(options)));
  }

  if (system) {
    lines.push("", "system:", system);
  }

  if (messages.length > 0) {
    lines.push("", "messages:");
    messages.forEach((message, index) => {
      lines.push(
        "",
        `#${index + 1} role=${message.role}`,
        message.content || "(empty)"
      );
    });
  }

  const remaining = formatRemainingBody(body);
  if (remaining) {
    lines.push("", "other:", remaining);
  }

  return lines.join("\n");
}

function readMessages(body: Record<string, unknown>): readonly { readonly role: string; readonly content: string }[] {
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.map((message) => {
    const record = asRecord(message);
    return {
      role: stringField(record, "role") || "-",
      content: readMessageContent(record.content)
    };
  });
}

function readMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content.map((item) => {
      const record = asRecord(item);
      return stringField(record, "text") || stringField(record, "content") || formatJson(item);
    }).join("\n");
  }

  if (content === undefined || content === null) {
    return "";
  }

  return formatJson(content);
}

function formatRemainingBody(body: Record<string, unknown>): string {
  const omitted = new Set(["model", "messages", "system", "temperature", "max_tokens", "stream", "options"]);
  const remaining = Object.fromEntries(Object.entries(body).filter(([key]) => !omitted.has(key)));
  return Object.keys(remaining).length > 0 ? formatIndented(formatJson(remaining)) : "";
}

function formatIndented(value: string): string {
  return value.split("\n").map((line) => `  ${line}`).join("\n");
}

function findRouterLog(logs: readonly ProviderDebugLog[]): ProviderDebugLog | undefined {
  return findLast(logs, (log) => log.providerId.includes("router") || log.providerId.includes("intent"));
}

function findMainModelLog(logs: readonly ProviderDebugLog[]): ProviderDebugLog | undefined {
  return findLast(logs, (log) => log.providerId.includes("main") || log.providerId.includes("anthropic") || log.providerId.includes("openai"));
}

function findEvaluatorLog(logs: readonly ProviderDebugLog[]): ProviderDebugLog | undefined {
  return findLast(logs, (log) => log.providerId.includes("evaluator"));
}

function readModelRequestMessages(log: ProviderDebugLog): readonly { readonly role: string; readonly content: string }[] {
  return readMessages(asRecord(log.request.body));
}

function formatModelMessagesSummary(log: ProviderDebugLog): string {
  const messages = readModelRequestMessages(log);
  const roles = messages.map((message) => message.role).join(" -> ");
  const latest = log.request.latestUserMessage ?? messages.at(-1)?.content ?? "";
  return joinNonEmpty([
    `${log.request.messageCount} messages`,
    roles,
    latest
  ], " | ");
}

function formatToolEventsSummary(
  calls: readonly AgentEventRecord[],
  results: readonly AgentEventRecord[]
): string {
  const callNames = calls.map((event) => {
    const payload = asRecord(event.payload);
    return stringField(payload, "type") || stringField(payload, "tool") || stringField(payload, "name") || event.type;
  });
  const failedResults = results.filter((event) => stringField(asRecord(event.payload), "status") === "failed").length;

  return joinNonEmpty([
    callNames.length > 0 ? `调用：${callNames.join(" / ")}` : "",
    results.length > 0 ? `结果：${results.length}` : "",
    failedResults > 0 ? `失败：${failedResults}` : ""
  ], "；") || "工具事件已记录";
}

function modelLogDetails(log: ProviderDebugLog): readonly { readonly label: string; readonly content: string }[] {
  const details = [
    {
      label: `模型请求：${log.providerId}`,
      content: formatModelRequest(log)
    },
    {
      label: "原始请求 JSON",
      content: formatJson({
        method: log.request.method,
        endpoint: log.request.endpoint,
        headers: log.request.headers,
        body: log.request.body
      })
    }
  ];

  if (log.response) {
    return [
      ...details,
      ...modelResponseDetailItems(log.response)
    ];
  }

  if (log.error) {
    return [
      ...details,
      {
        label: "模型错误",
        content: log.error
      }
    ];
  }

  return details;
}

function modelResponseDetailItems(response: ProviderDebugLog["response"]): readonly { readonly label: string; readonly content: string }[] {
  if (!response) {
    return [];
  }

  const native = parseNativeModelResponse(response.content);
  if (!native) {
    return [{
      label: "模型响应",
      content: formatResponse(response)
    }];
  }

  return [
    {
      label: "正式产出 content",
      content: native.content || "(empty)"
    },
    {
      label: "模型思考 reasoning_content",
      content: native.reasoningContent || "(empty)"
    },
    {
      label: "工具调用 tool_calls",
      content: native.toolCalls.length > 0 ? formatJson(native.toolCalls) : "none"
    },
    {
      label: "完整模型响应",
      content: formatResponse(response)
    }
  ];
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false
  });
}

function findLastEvent(events: readonly AgentEventRecord[], type: AgentEventRecord["type"]): AgentEventRecord | undefined {
  return findLast(events, (event) => event.type === type);
}

function findLast<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (predicate(item)) {
      return item;
    }
  }

  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayField(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function booleanRaw(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function booleanField(record: Record<string, unknown>, key: string): string {
  if (record[key] === true) {
    return "true";
  }

  if (record[key] === false) {
    return "false";
  }

  return "-";
}

function numberField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "number" ? String(value) : "-";
}

function numberOrFallback(
  primary: Record<string, unknown>,
  primaryKey: string,
  fallback: Record<string, unknown>,
  fallbackKey: string
): string {
  const primaryValue = numberField(primary, primaryKey);
  return primaryValue !== "-" ? primaryValue : numberField(fallback, fallbackKey);
}

function stringArrayField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").join(" / ") : "";
}

function joinNonEmpty(values: readonly (string | undefined)[], separator: string): string {
  return values.filter((value): value is string => Boolean(value && value.trim())).join(separator);
}

function confidenceTone(record: Record<string, unknown>): TraceHighlight["tone"] {
  const value = record.confidence;
  if (typeof value !== "number") {
    return "default";
  }

  return value >= 0.7 ? "success" : "warning";
}

function formatToolHighlight(routerPayload: Record<string, unknown>, toolPayload: Record<string, unknown>): string {
  const selectedTools = stringArrayField(toolPayload, "selected_tools");
  const suggestedTools = stringArrayField(routerPayload, "suggested_tools");
  const accessMode = stringField(toolPayload, "access_mode");

  if (selectedTools) {
    return joinNonEmpty([selectedTools, accessMode], " / ");
  }

  if (suggestedTools) {
    return `建议：${suggestedTools}`;
  }

  return booleanRaw(routerPayload, "needs_tools") ? "需要工具，但尚未开放" : "未使用工具";
}

function formatMemoryOutput(writePayload: Record<string, unknown>, recallPayload: Record<string, unknown>): string {
  const written = arrayField(writePayload, "memories");
  const recalled = arrayField(recallPayload, "memories");

  if (written.length === 0 && recalled.length === 0) {
    return "本轮没有写入或召回长期记忆。";
  }

  return compactText(
    [
      written.length > 0 ? `写入 ${written.length} 条长期记忆` : "",
      recalled.length > 0 ? `召回 ${recalled.length} 条长期记忆` : ""
    ]
      .filter((item) => item.length > 0)
      .join("；"),
    140
  );
}

function evaluationDisplayFromPayload(payload: Record<string, unknown>): EvaluationDisplay {
  if (booleanRaw(payload, "passed")) {
    return {
      badge: "通过",
      status: "done",
      tone: "success",
      action: "final",
      summary: "回复满足本轮成功条件"
    };
  }

  const nextAction = stringField(payload, "next_action");
  const missing = stringArrayField(payload, "missing_criteria");
  const issues = stringArrayField(payload, "issues");
  const reason = compactText(missing || issues || "Evaluator 认为需要后续处理", 120);

  if (nextAction === "revise_answer") {
    return {
      badge: "需修正",
      status: "pending",
      tone: "warning",
      action: "revise_answer",
      summary: reason
    };
  }

  if (nextAction === "use_tools") {
    return {
      badge: "需工具",
      status: "pending",
      tone: "warning",
      action: "use_tools",
      summary: reason
    };
  }

  if (nextAction === "ask_user") {
    return {
      badge: "需追问",
      status: "pending",
      tone: "warning",
      action: "ask_user",
      summary: reason
    };
  }

  if (nextAction === "final") {
    return {
      badge: "可放行",
      status: "done",
      tone: "success",
      action: "final",
      summary: reason
    };
  }

  return {
    badge: "需确认",
    status: "pending",
    tone: "warning",
    action: nextAction || "-",
    summary: reason
  };
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}...` : compacted;
}

function evaluationSummary(payload: Record<string, unknown>): string {
  return evaluationDisplayFromPayload(payload).summary;
}
