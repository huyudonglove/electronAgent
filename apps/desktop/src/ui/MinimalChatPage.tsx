import { useState } from "react";
import { Bug, RefreshCw, Send, SlidersHorizontal, X } from "lucide-react";
import type {
  AgentEventRecord,
  ChatMessage,
  ChatSessionId,
  ChatStreamEvent,
  ModelProviderKind,
  ModelRuntimeConfig,
  ModelRuntimeRole,
  ModelRuntimeSettings,
  ModelProfile,
  ProviderDebugLog,
} from "@xiaomi/shared";

const PROJECT_ID = "local-project";

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
  const [debugTab, setDebugTab] = useState<"models" | "events">("models");
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelSettings, setModelSettings] = useState<ModelRuntimeSettings | null>(null);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

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
    try {
      removeListener = window.workbench.onChatStreamEvent((event) => {
        handleStreamEvent(event);
      });
      await window.workbench.streamChatMessage({
        sessionId,
        projectId: PROJECT_ID,
        modelProfileId: modelProfiles.find((profile) => profile.id === "mimo-v2-5-pro")?.id ?? "mimo-v2-5-pro",
        message: content,
      });
      await refreshDebugData();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshDebugData();
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
      void refreshSessionEvents(event.session.id);
      return;
    }

    setStageLabel(null);
    setError(event.error);
  }

  async function refreshDebugData(): Promise<void> {
    const logs = await window.workbench.listProviderDebugLogs();
    setDebugLogs(logs);

    if (sessionId) {
      await refreshSessionEvents(sessionId);
    }
  }

  async function refreshSessionEvents(targetSessionId: ChatSessionId): Promise<void> {
    const events = await window.workbench.listSessionEvents({
      projectId: PROJECT_ID,
      sessionId: targetSessionId
    });
    setEventLogs(events);
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
            <p>{message.content}</p>
          </article>
        ))}
        {stageLabel ? <div className="minimal-chat__stage">{stageLabel}</div> : null}
        {error ? <div className="minimal-chat__error">{error}</div> : null}
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
              <p>模型请求、返回和当前会话事件链。</p>
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

          <nav className="debug-tabs" aria-label="调试视图">
            <button
              type="button"
              data-active={debugTab === "models"}
              onClick={() => setDebugTab("models")}
            >
              模型请求
            </button>
            <button
              type="button"
              data-active={debugTab === "events"}
              onClick={() => setDebugTab("events")}
            >
              事件链
            </button>
          </nav>

          <section className="debug-log-list">
            {debugTab === "models" ? (
              debugLogs.length > 0 ? (
              debugLogs.map((log) => (
                <article className="debug-log" key={log.id}>
                  <div className="debug-log__top">
                    <strong>{log.providerId}</strong>
                    <span data-status={log.status}>{log.status}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Method</dt>
                      <dd>{log.request.method ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Endpoint</dt>
                      <dd>{log.request.endpoint ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>{log.model}</dd>
                    </div>
                    <div>
                      <dt>Base URL</dt>
                      <dd>{log.baseURL ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Duration</dt>
                      <dd>{log.durationMs ? `${log.durationMs}ms` : "-"}</dd>
                    </div>
                    <div>
                      <dt>Latest User</dt>
                      <dd>{log.request.latestUserMessage ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Stop Reason</dt>
                      <dd>{log.response?.stopReason ?? "-"}</dd>
                    </div>
                  </dl>
                  <details className="debug-details" open>
                    <summary>请求 Headers</summary>
                    <pre>{formatJson(log.request.headers ?? {})}</pre>
                  </details>
                  <details className="debug-details" open>
                    <summary>请求 Body</summary>
                    <pre>{formatJson(log.request.body ?? {})}</pre>
                  </details>
                  {log.response ? (
                    <details className="debug-details" open>
                      <summary>响应内容</summary>
                      <pre>{formatResponse(log.response)}</pre>
                    </details>
                  ) : log.error ? (
                    <details className="debug-details" open>
                      <summary>错误</summary>
                      <pre className="debug-log__error">{log.error}</pre>
                    </details>
                  ) : null}
                </article>
              ))
            ) : (
              <p className="debug-empty">还没有模型请求记录。</p>
              )
            ) : eventLogs.length > 0 ? (
              eventLogs.map((event) => (
                <article className="debug-log" key={event.id}>
                  <div className="debug-log__top">
                    <strong>{event.type}</strong>
                    <span>{event.actor}</span>
                  </div>
                  <dl>
                    <div>
                      <dt>Time</dt>
                      <dd>{formatTime(event.createdAt)}</dd>
                    </div>
                    <div>
                      <dt>Role</dt>
                      <dd>{event.roleLabel ?? "-"}</dd>
                    </div>
                    <div>
                      <dt>Message</dt>
                      <dd>{event.messageId ?? "-"}</dd>
                    </div>
                  </dl>
                  {event.content ? (
                    <details className="debug-details" open>
                      <summary>内容</summary>
                      <pre>{event.content}</pre>
                    </details>
                  ) : null}
                  <details className="debug-details">
                    <summary>Payload</summary>
                    <pre>{formatJson(event.payload ?? {})}</pre>
                  </details>
                </article>
              ))
            ) : (
              <p className="debug-empty">
                {sessionId ? "当前会话还没有事件记录。" : "发送第一条消息后会显示当前会话事件链。"}
              </p>
            )}
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
          maxTokens: 768
        },
        main: {
          ...current.main,
          label: "DeepSeek Main",
          providerKind: "openai-compatible",
          baseURL: "https://api.deepseek.com",
          model: "deepseek-v4-pro",
          temperature: 0.7,
          maxTokens: 8192
        },
        compression: {
          ...current.compression,
          label: "DeepSeek Compression",
          providerKind: "openai-compatible",
          baseURL: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          temperature: 0.2,
          maxTokens: 1024
        }
      };
    });
    setSettingsStatus("已套用 DeepSeek 预设，请填写 API Key 后保存。");
  }
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
    props.onChange({
      ...props.config,
      ...patch
    });
  }

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
    </article>
  );
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function formatResponse(response: ProviderDebugLog["response"]): string {
  if (!response) {
    return "";
  }

  return [
    `stopReason: ${response.stopReason ?? "-"}`,
    `usage: ${formatJson(response.usage ?? {})}`,
    "",
    response.content
  ].join("\n");
}

function formatTime(value: string): string {
  return new Date(value).toLocaleString("zh-CN", {
    hour12: false
  });
}
