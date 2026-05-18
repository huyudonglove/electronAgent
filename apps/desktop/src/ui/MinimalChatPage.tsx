import { useEffect, useRef, useState } from "react";
import { Bug, CheckCircle2, CircleDashed, GitBranch, RefreshCw, Send, SlidersHorizontal, UserRound, X } from "lucide-react";
import type {
  AgentEventRecord,
  ChatMessage,
  ChatSessionId,
  ChatStreamEvent,
  ModelProviderKind,
  ModelBlockConfig,
  ModelRuntimeConfig,
  ModelRuntimeRole,
  ModelRuntimeSettings,
  ModelToolCallingMode,
  ModelProfile,
  ProviderDebugLog,
} from "@xiaomi/shared";

const PROJECT_ID = "local-project";
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MIMO_ANTHROPIC_BASE_URL = "https://token-plan-cn.xiaomimimo.com/anthropic";
const MIMO_OPENAI_BASE_URL = "https://api.xiaomimimo.com/v1";
const MIMO_MODEL = "mimo-v2.5-pro";
const OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const LOCAL_QWEN_MODEL = "qwen2.5:1.5b";

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
  const [modelLibraryOpen, setModelLibraryOpen] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
            const nextOpen = !profileOpen;
            setProfileOpen(nextOpen);
            setModelLibraryOpen(false);
            setWorkflowOpen(false);
            setDebugOpen(false);
            if (nextOpen) {
              await refreshDebugData();
            }
          }}
        >
          <UserRound size={16} />
          画像
        </button>
        <button
          className="debug-toggle"
          type="button"
          onClick={async () => {
            const nextOpen = !modelLibraryOpen;
            setModelLibraryOpen(nextOpen);
            setWorkflowOpen(false);
            setProfileOpen(false);
            setDebugOpen(false);
            if (nextOpen) {
              await refreshModelSettings();
            }
          }}
        >
          <SlidersHorizontal size={16} />
          模型库
        </button>
        <button
          className="debug-toggle"
          type="button"
          onClick={async () => {
            const nextOpen = !workflowOpen;
            setWorkflowOpen(nextOpen);
            setModelLibraryOpen(false);
            setProfileOpen(false);
            setDebugOpen(false);
            if (nextOpen) {
              await refreshModelSettings();
            }
          }}
        >
          <GitBranch size={16} />
          流程
        </button>
        <button
          className="debug-toggle"
          type="button"
          onClick={async () => {
            const nextOpen = !debugOpen;
            setDebugOpen(nextOpen);
            setModelLibraryOpen(false);
            setWorkflowOpen(false);
            setProfileOpen(false);
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

      {profileOpen ? (
        <aside className="debug-drawer profile-drawer" aria-label="画像面板">
          <header>
            <div>
              <h2>画像</h2>
              <p>独立观察用户、项目和环境画像，来源于 Router 每轮任务分析。</p>
            </div>
            <div className="debug-drawer__actions">
              <button type="button" onClick={() => void refreshDebugData()} title="刷新">
                <RefreshCw size={16} />
              </button>
              <button type="button" onClick={() => setProfileOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
          </header>

          <section className="debug-log-list">
            <ProfileView events={eventLogs} sessionId={sessionId} />
          </section>
        </aside>
      ) : null}

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

      {modelLibraryOpen ? (
        <aside className="debug-drawer model-drawer" aria-label="模型库面板">
          <header>
            <div>
              <h2>模型库</h2>
              <p>只管理可复用模型块、API Key、接口地址和模型参数，不处理执行步骤。</p>
            </div>
            <div className="debug-drawer__actions">
              <button type="button" onClick={() => void refreshModelSettings()} title="刷新">
                <RefreshCw size={16} />
              </button>
              <button type="button" onClick={() => setModelLibraryOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
          </header>

          <section className="model-settings">
            {modelSettings ? (
              <>
                <ModelBlockGallery
                  blocks={modelSettings.modelBlocks}
                  onChange={(block) => updateModelBlock(block)}
                  onSaveKey={() => void saveModelSettings("已保存模型块 API Key 到 config/model-runtime.local.json")}
                />
                <div className="model-settings__actions">
                  <button type="button" onClick={() => void saveModelSettings()}>
                    保存模型库
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

      {workflowOpen ? (
        <aside className="debug-drawer model-drawer workflow-drawer" aria-label="流程编排面板">
          <header>
            <div>
              <h2>流程编排</h2>
              <p>只管理 Agent 执行节点和每个节点绑定哪个模型块，模型 Key 在模型库中维护。</p>
            </div>
            <div className="debug-drawer__actions">
              <button type="button" onClick={() => void refreshModelSettings()} title="刷新">
                <RefreshCw size={16} />
              </button>
              <button type="button" onClick={() => setWorkflowOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
          </header>

          <section className="model-settings">
            {modelSettings ? (
              <>
                <ModelSchemePanel
                  onApply={(settings, label) => {
                    setModelSettings(settings);
                    setSettingsStatus(`已套用 ${label}，请确认流程绑定后保存。`);
                  }}
                  settings={modelSettings}
                />
                <section className="model-step-panel" aria-label="步骤模型绑定">
                  <header>
                    <span>执行流程</span>
                    <strong>节点只绑定模型块，不保存 API Key</strong>
                  </header>
                  <WorkflowOverview settings={modelSettings} />
                  {MODEL_RUNTIME_ROLES.map((role) => (
                    <ModelStepBindingEditor
                      config={modelSettings[role]}
                      key={role}
                      onChange={(config) => {
                        setModelSettings((current) => current ? { ...current, [role]: config } : current);
                      }}
                      settings={modelSettings}
                    />
                  ))}
                </section>
                <div className="model-settings__actions">
                  <button type="button" onClick={() => void saveModelSettings("已保存流程绑定到 config/model-runtime.local.json")}>
                    保存流程
                  </button>
                  <button type="button" onClick={() => applyMiMoNativePreset()}>
                    Execution 使用 MiMo 原生
                  </button>
                  <button type="button" onClick={() => applyDeepSeekPreset()}>
                    全流程 DeepSeek
                  </button>
                </div>
                {settingsStatus ? <p className="model-settings__status">{settingsStatus}</p> : null}
              </>
            ) : (
              <p className="debug-empty">正在读取流程配置...</p>
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

  async function saveModelSettings(status = "已保存到 config/model-runtime.local.json"): Promise<void> {
    if (!modelSettings) {
      return;
    }

    const saved = await window.workbench.saveModelRuntimeSettings(modelSettings);
    setModelSettings(saved);
    setSettingsStatus(status);
  }

  function updateModelBlock(block: ModelBlockConfig): void {
    setModelSettings((current) => {
      if (!current) {
        return current;
      }

      const modelBlocks = current.modelBlocks.map((item) => item.id === block.id ? block : item);
      const next = {
        ...current,
        modelBlocks
      };

      return {
        ...next,
        router: applyModelBlockToMatchingStep(next.router, block),
        planner: applyModelBlockToMatchingStep(next.planner, block),
        main: applyModelBlockToMatchingStep(next.main, block),
        evaluator: applyModelBlockToMatchingStep(next.evaluator, block),
        compression: applyModelBlockToMatchingStep(next.compression, block)
      };
    });
  }

  function applyDeepSeekPreset(): void {
    setModelSettings((current) => {
      if (!current) {
        return current;
      }

      return applyModelScheme(current, {
        router: "deepseek-flash",
        planner: "deepseek-pro",
        main: "deepseek-pro",
        evaluator: "deepseek-flash",
        compression: "deepseek-flash"
      });
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
        main: applyModelBlockToRole(current.main, getModelBlock(current, "mimo-openai-native"))
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

function ProfileView(props: {
  readonly events: readonly AgentEventRecord[];
  readonly sessionId?: ChatSessionId;
}): JSX.Element {
  if (!props.sessionId) {
    return <p className="debug-empty">发送消息后，Router 会开始建立用户、项目和环境画像。</p>;
  }

  const profile = buildProfileOverview(props.events);

  if (profile.totalObservations === 0) {
    return <p className="debug-empty">当前会话还没有画像观察。继续对话后，这里会显示 Router 的画像快照和候选更新。</p>;
  }

  return (
    <div className="profile-panel">
      <section className="profile-overview" aria-label="画像总览">
        <header>
          <span>画像总览</span>
          <strong>{profile.totalObservations} 次观察</strong>
        </header>
        <dl>
          <div>
            <dt>候选更新</dt>
            <dd>{profile.totalUpdates}</dd>
          </div>
          <div>
            <dt>路由影响</dt>
            <dd>{profile.routingInfluences.length}</dd>
          </div>
          <div>
            <dt>最近观察</dt>
            <dd>{profile.latestObservedAt ? formatTime(profile.latestObservedAt) : "-"}</dd>
          </div>
        </dl>
      </section>

      <div className="profile-grid">
        {profile.sections.map((section) => (
          <article className="profile-card" data-target={section.target} key={section.target}>
            <header>
              <div>
                <span>{section.kind}</span>
                <h3>{section.title}</h3>
              </div>
              <strong>{section.updates.length} 更新</strong>
            </header>
            <p>{section.description}</p>

            <section className="profile-card__block">
              <h4>当前使用的画像快照</h4>
              {section.snapshot.length > 0 ? (
                <ul>
                  {section.snapshot.map((item, index) => (
                    <li key={`${section.target}-snapshot-${index}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p>暂无快照。</p>
              )}
            </section>

            <section className="profile-card__block">
              <h4>候选更新</h4>
              {section.updates.length > 0 ? (
                <ol className="profile-update-list">
                  {section.updates.map((update, index) => (
                    <li key={`${section.target}-update-${index}`}>
                      <strong>{update.field || "未命名字段"}</strong>
                      <span>{update.value || "-"}</span>
                      <small>{compactText(joinNonEmpty([update.reason, update.evidence], " / "), 160) || "无说明"}</small>
                      <em>confidence {formatNumber(update.confidence)}</em>
                    </li>
                  ))}
                </ol>
              ) : (
                <p>暂无候选更新。</p>
              )}
            </section>
          </article>
        ))}
      </div>

      <details className="trace-audit-panel profile-influence-panel">
        <summary>
          <span>路由影响</span>
          <strong>画像如何影响 Router 判断</strong>
        </summary>
        <div className="trace-audit-panel__body">
          {profile.routingInfluences.length > 0 ? (
            <ul className="profile-influence-list">
              {profile.routingInfluences.map((item, index) => (
                <li key={`profile-influence-${index}`}>{item}</li>
              ))}
            </ul>
          ) : (
            <p className="debug-empty">暂无路由影响记录。</p>
          )}
        </div>
      </details>
    </div>
  );
}

interface ProfileOverview {
  readonly totalObservations: number;
  readonly totalUpdates: number;
  readonly latestObservedAt?: string;
  readonly routingInfluences: readonly string[];
  readonly sections: readonly ProfileSection[];
}

interface ProfileSection {
  readonly target: "user" | "project" | "environment";
  readonly kind: string;
  readonly title: string;
  readonly description: string;
  readonly snapshot: readonly string[];
  readonly updates: readonly ProfileUpdateView[];
}

interface ProfileUpdateView {
  readonly field: string;
  readonly value: string;
  readonly reason: string;
  readonly evidence: string;
  readonly confidence: number;
}

function buildProfileOverview(events: readonly AgentEventRecord[]): ProfileOverview {
  const routerEvents = events.filter((event) => event.type === "router_result");
  const snapshots: Record<ProfileSection["target"], string[]> = {
    user: [],
    project: [],
    environment: []
  };
  const updates: Record<ProfileSection["target"], ProfileUpdateView[]> = {
    user: [],
    project: [],
    environment: []
  };
  const routingInfluences: string[] = [];

  for (const event of routerEvents) {
    const payload = asRecord(event.payload);
    const observation = asRecord(payload.profile_observation);
    const snapshot = asRecord(observation.profile_snapshot_used);

    for (const target of ["user", "project", "environment"] as const) {
      snapshots[target].push(...toUniqueAppendItems(snapshots[target], stringArrayValues(snapshot[target])));
    }

    routingInfluences.push(...toUniqueAppendItems(routingInfluences, stringArrayValues(observation.routing_influences)));

    for (const item of arrayField(observation, "profile_updates")) {
      const record = asRecord(item);
      const target = normalizeProfileTarget(stringField(record, "target"));
      if (!target) {
        continue;
      }

      updates[target].push({
        field: stringField(record, "field"),
        value: stringField(record, "value"),
        reason: stringField(record, "reason"),
        evidence: stringField(record, "evidence"),
        confidence: Number(record.confidence ?? 0)
      });
    }
  }

  return {
    totalObservations: routerEvents.length,
    totalUpdates: updates.user.length + updates.project.length + updates.environment.length,
    latestObservedAt: routerEvents.at(-1)?.createdAt,
    routingInfluences,
    sections: [
      {
        target: "user",
        kind: "User",
        title: "用户画像",
        description: "你的偏好、沟通方式、确认规则、工作习惯和长期目标。",
        snapshot: snapshots.user,
        updates: updates.user
      },
      {
        target: "project",
        kind: "Project",
        title: "项目画像",
        description: "当前 Agent 项目的目标、架构、技术选型、阶段状态和约束。",
        snapshot: snapshots.project,
        updates: updates.project
      },
      {
        target: "environment",
        kind: "Environment",
        title: "环境画像",
        description: "本机路径、工具、运行环境、外部软件和可用资源。",
        snapshot: snapshots.environment,
        updates: updates.environment
      }
    ]
  };
}

function normalizeProfileTarget(value: string): ProfileSection["target"] | undefined {
  return value === "user" || value === "project" || value === "environment" ? value : undefined;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  return value.toFixed(2);
}

function toUniqueAppendItems(existing: readonly string[], incoming: readonly string[]): string[] {
  const seen = new Set(existing);
  return incoming.filter((item) => {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) {
      return false;
    }
    seen.add(trimmed);
    return true;
  });
}

interface ModelProfilePreset {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly description: string;
  readonly supports: readonly ModelRuntimeRole[];
  readonly config: Omit<ModelRuntimeConfig, "role">;
}

const MODEL_RUNTIME_ROLES: readonly ModelRuntimeRole[] = ["router", "planner", "main", "evaluator", "compression"];

const MODEL_PROFILE_PRESETS: readonly ModelProfilePreset[] = [
  {
    id: "deepseek-flash",
    label: "DeepSeek Flash",
    provider: "DeepSeek",
    description: "适合 Router、Evaluator、压缩和轻量执行。",
    supports: ["router", "planner", "main", "evaluator", "compression"],
    config: {
      label: "DeepSeek Flash",
      providerKind: "openai-compatible",
      baseURL: DEEPSEEK_BASE_URL,
      model: "deepseek-v4-flash",
      apiKey: "",
      temperature: 0.2,
      maxTokens: 1024,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    }
  },
  {
    id: "deepseek-pro",
    label: "DeepSeek Pro",
    provider: "DeepSeek",
    description: "适合主模型和复杂任务规划。",
    supports: ["planner", "main"],
    config: {
      label: "DeepSeek Pro",
      providerKind: "openai-compatible",
      baseURL: DEEPSEEK_BASE_URL,
      model: "deepseek-v4-pro",
      apiKey: "",
      temperature: 0.7,
      maxTokens: 8192,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    }
  },
  {
    id: "mimo-anthropic-pro",
    label: "MiMo Pro Anthropic",
    provider: "MiMo",
    description: "当前稳定主模型路径，走 Anthropic-compatible。",
    supports: ["planner", "main"],
    config: {
      label: "MiMo Pro Anthropic",
      providerKind: "anthropic-compatible",
      baseURL: MIMO_ANTHROPIC_BASE_URL,
      model: MIMO_MODEL,
      apiKey: "",
      temperature: 1,
      maxTokens: 8192,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    }
  },
  {
    id: "mimo-openai-native",
    label: "MiMo Native Tools",
    provider: "MiMo",
    description: "原生 OpenAI tools/thinking 路径，需要 /v1 Key 可用。",
    supports: ["planner", "main"],
    config: {
      label: "MiMo Native Tools",
      providerKind: "openai-compatible",
      baseURL: MIMO_OPENAI_BASE_URL,
      model: MIMO_MODEL,
      apiKey: "",
      temperature: 1,
      maxTokens: 8192,
      toolCallingMode: "native-openai",
      thinkingEnabled: true
    }
  },
  {
    id: "local-qwen",
    label: "Local Qwen",
    provider: "Ollama",
    description: "本地小模型，适合离线 Router 和压缩。",
    supports: ["router", "evaluator", "compression"],
    config: {
      label: "Local Qwen",
      providerKind: "ollama",
      baseURL: OLLAMA_BASE_URL,
      model: LOCAL_QWEN_MODEL,
      apiKey: "",
      temperature: 0.2,
      maxTokens: 1024,
      toolCallingMode: "text-json",
      thinkingEnabled: false
    }
  }
];

const MODEL_SCHEMES: readonly {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly bindings: Record<ModelRuntimeRole, string>;
}[] = [
  {
    id: "deepseek-router-mimo-main",
    label: "DeepSeek 前置 + MiMo 主模型",
    description: "Router 用 Flash，主回复走当前稳定 MiMo Anthropic，压缩也用 Flash。",
    bindings: {
      router: "deepseek-flash",
      planner: "deepseek-pro",
      main: "mimo-anthropic-pro",
      evaluator: "deepseek-flash",
      compression: "deepseek-flash"
    }
  },
  {
    id: "all-deepseek",
    label: "全 DeepSeek",
    description: "Router/压缩用 Flash，主模型用 Pro，切换成本最低。",
    bindings: {
      router: "deepseek-flash",
      planner: "deepseek-pro",
      main: "deepseek-pro",
      evaluator: "deepseek-flash",
      compression: "deepseek-flash"
    }
  },
  {
    id: "local-router-mimo-main",
    label: "本地前置 + MiMo 主模型",
    description: "Router/压缩走 Ollama，本地成本低，主回复走 MiMo。",
    bindings: {
      router: "local-qwen",
      planner: "mimo-anthropic-pro",
      main: "mimo-anthropic-pro",
      evaluator: "local-qwen",
      compression: "local-qwen"
    }
  }
];

function ModelSchemePanel(props: {
  readonly settings: ModelRuntimeSettings;
  readonly onApply: (settings: ModelRuntimeSettings, label: string) => void;
}): JSX.Element {
  return (
    <section className="model-schemes" aria-label="模型方案">
      <header>
        <span>一键方案</span>
        <strong>先选工作模式，再按角色微调</strong>
      </header>
      <div className="model-scheme-grid">
        {MODEL_SCHEMES.map((scheme) => (
          <button
            key={scheme.id}
            onClick={() => props.onApply(applyModelScheme(props.settings, scheme.bindings), scheme.label)}
            type="button"
          >
            <span>{scheme.label}</span>
            <small>{scheme.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function applyModelScheme(
  settings: ModelRuntimeSettings,
  bindings: Record<ModelRuntimeRole, string>
): ModelRuntimeSettings {
  return {
    modelBlocks: settings.modelBlocks,
    router: applyModelProfileToRole(settings.router, getModelPreset(bindings.router), settings),
    planner: applyModelProfileToRole(settings.planner, getModelPreset(bindings.planner), settings),
    main: applyModelProfileToRole(settings.main, getModelPreset(bindings.main), settings),
    evaluator: applyModelProfileToRole(settings.evaluator, getModelPreset(bindings.evaluator), settings),
    compression: applyModelProfileToRole(settings.compression, getModelPreset(bindings.compression), settings)
  };
}

function getModelPreset(id: string): ModelProfilePreset {
  return MODEL_PROFILE_PRESETS.find((preset) => preset.id === id) ?? MODEL_PROFILE_PRESETS[0];
}

function getModelBlock(settings: ModelRuntimeSettings, id: string): ModelBlockConfig {
  return settings.modelBlocks.find((block) => block.id === id) ?? modelPresetToBlock(getModelPreset(id));
}

function modelPresetToBlock(preset: ModelProfilePreset): ModelBlockConfig {
  return {
    id: preset.id,
    label: preset.label,
    provider: preset.provider,
    description: preset.description,
    providerKind: preset.config.providerKind,
    baseURL: preset.config.baseURL,
    model: preset.config.model,
    apiKey: preset.config.apiKey,
    temperature: preset.config.temperature,
    maxTokens: preset.config.maxTokens,
    toolCallingMode: preset.config.toolCallingMode,
    thinkingEnabled: preset.config.thinkingEnabled
  };
}

function ModelBlockGallery(props: {
  readonly blocks: readonly ModelBlockConfig[];
  readonly onChange: (block: ModelBlockConfig) => void;
  readonly onSaveKey: () => void;
}): JSX.Element {
  return (
    <section className="model-block-panel" aria-label="模型块">
      <header>
        <span>模型块</span>
        <strong>可复用模型档案</strong>
      </header>
      <div className="model-block-grid">
        {props.blocks.map((block) => (
          <article className="model-block-card" key={block.id}>
            <header>
              <span>{block.provider}</span>
              <h3>{block.label}</h3>
            </header>
            <p>{block.description}</p>
            <dl>
              <div>
                <dt>模型</dt>
                <dd>{block.model}</dd>
              </div>
              <div>
                <dt>接口</dt>
                <dd>{block.baseURL}</dd>
              </div>
              <div>
                <dt>模式</dt>
                <dd>{block.toolCallingMode}</dd>
              </div>
            </dl>
            <div className="model-block-card__key-row">
              <label>
                <span>
                  API Key
                  <strong data-ready={Boolean(block.apiKey)}>
                    {block.apiKey ? `已保存 ${maskApiKey(block.apiKey)}` : "未配置"}
                  </strong>
                </span>
                <input
                  type="password"
                  value={block.apiKey}
                  onChange={(event) => props.onChange({ ...block, apiKey: event.target.value })}
                  placeholder={block.providerKind === "ollama" ? "Ollama 可留空" : "输入或替换模型块 Key"}
                />
              </label>
              <button type="button" onClick={props.onSaveKey}>
                保存 Key
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function WorkflowOverview(props: {
  readonly settings: ModelRuntimeSettings;
}): JSX.Element {
  return (
    <ol className="workflow-overview" aria-label="Agent 执行流程概览">
      {MODEL_RUNTIME_ROLES.map((role, index) => {
        const config = props.settings[role];
        const block = props.settings.modelBlocks.find((item) => item.id === config.modelBlockId);

        return (
          <li key={role}>
            <span>{index + 1}</span>
            <div>
              <strong>{workflowRoleTitle(role)}</strong>
              <small>{workflowRoleSummary(role)}</small>
            </div>
            <em>{block?.label ?? config.label}</em>
          </li>
        );
      })}
    </ol>
  );
}

function workflowRoleTitle(role: ModelRuntimeRole): string {
  const labels: Record<ModelRuntimeRole, string> = {
    router: "Router",
    planner: "Planning",
    main: "Execution",
    evaluator: "Evaluator",
    compression: "Compression"
  };

  return labels[role];
}

function workflowRoleSummary(role: ModelRuntimeRole): string {
  const summaries: Record<ModelRuntimeRole, string> = {
    router: "理解用户输入和任务类型",
    planner: "规划目标、步骤、风险和执行指令",
    main: "按计划执行、调用工具并生成回复",
    evaluator: "检查输出是否满足成功条件",
    compression: "长会话摘要和上下文压缩"
  };

  return summaries[role];
}

function ModelStepBindingEditor(props: {
  readonly config: ModelRuntimeConfig;
  readonly onChange: (config: ModelRuntimeConfig) => void;
  readonly settings: ModelRuntimeSettings;
}): JSX.Element {
  const roleLabels: Record<ModelRuntimeRole, string> = {
    router: "前置 Router",
    planner: "规划模型",
    main: "主对话模型",
    evaluator: "输出验收模型",
    compression: "会话压缩模型"
  };
  const roleDescriptions: Record<ModelRuntimeRole, string> = {
    router: "负责任务分析、流程路由、上下文需求、画像观察和验收种子。",
    planner: "负责在执行前拆解目标、步骤、风险和执行指令。",
    main: "负责面向用户的正式回复、工具请求和工具结果整理。",
    evaluator: "负责检查主模型输出是否满足本轮成功条件。",
    compression: "负责长会话摘要和上下文压缩。"
  };

  function update(patch: Partial<ModelRuntimeConfig>): void {
    const next = normalizeLinkedModelConfig({
      ...props.config,
      ...patch
    });
    props.onChange(next);
  }

  function applyProfile(profileId: string): void {
    const preset = MODEL_PROFILE_PRESETS.find((item) => item.id === profileId);
    if (!preset) {
      return;
    }

    props.onChange(applyModelBlockToRole(props.config, getModelBlock(props.settings, preset.id)));
  }

  const canUseNativeOpenAiTools = props.config.role === "main" && props.config.providerKind === "openai-compatible";
  const availableProfiles = MODEL_PROFILE_PRESETS;
  const selectedProfileId = matchModelProfilePreset(props.config)?.id ?? "custom";

  return (
    <article className="model-card">
      <header>
        <div>
          <span>{roleLabels[props.config.role]}</span>
          <h3>{props.config.label}</h3>
        </div>
        <strong>{providerLabel(props.config.providerKind)}</strong>
      </header>
      <p className="model-card__role-desc">{roleDescriptions[props.config.role]}</p>
      <label>
        <span>绑定模型块</span>
        <select value={selectedProfileId} onChange={(event) => applyProfile(event.target.value)}>
          <option value="custom">自定义：{props.config.label || props.config.model}</option>
          {availableProfiles.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label} · {preset.provider}
            </option>
          ))}
        </select>
      </label>
      <dl className="model-card__summary">
        <div>
          <dt>模型</dt>
          <dd>{props.config.model}</dd>
        </div>
        <div>
          <dt>地址</dt>
          <dd>{props.config.baseURL}</dd>
        </div>
        <div>
          <dt>工具</dt>
          <dd>{props.config.toolCallingMode}</dd>
        </div>
      </dl>
      <details className="model-card__advanced">
        <summary>高级参数</summary>
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
      </details>
      {props.config.role === "main" ? (
        <p className="model-card__hint">
          Native OpenAI 会自动绑定 OpenAI Compatible 和 Thinking；切到其他 Provider 时会回到 Text JSON。
        </p>
      ) : null}
    </article>
  );
}

function applyModelProfileToRole(config: ModelRuntimeConfig, preset: ModelProfilePreset, settings: ModelRuntimeSettings): ModelRuntimeConfig {
  return applyModelBlockToRole(config, getModelBlock(settings, preset.id));
}

function applyModelBlockToRole(config: ModelRuntimeConfig, block: ModelBlockConfig): ModelRuntimeConfig {
  return normalizeLinkedModelConfig({
    ...config,
    modelBlockId: block.id,
    label: block.label,
    providerKind: block.providerKind,
    baseURL: block.baseURL,
    model: block.model,
    apiKey: block.apiKey,
    temperature: block.temperature,
    maxTokens: block.maxTokens,
    toolCallingMode: block.toolCallingMode,
    thinkingEnabled: block.thinkingEnabled,
    role: config.role
  });
}

function applyModelBlockToMatchingStep(config: ModelRuntimeConfig, block: ModelBlockConfig): ModelRuntimeConfig {
  if (config.modelBlockId !== block.id) {
    return config;
  }

  return normalizeLinkedModelConfig({
    ...config,
    label: block.label,
    providerKind: block.providerKind,
    baseURL: block.baseURL,
    model: block.model,
    apiKey: block.apiKey,
    temperature: block.temperature,
    maxTokens: block.maxTokens,
    toolCallingMode: block.toolCallingMode,
    thinkingEnabled: block.thinkingEnabled,
    role: config.role,
  });
}

function matchModelProfilePreset(config: ModelRuntimeConfig): ModelProfilePreset | undefined {
  return MODEL_PROFILE_PRESETS.find((preset) =>
    preset.config.providerKind === config.providerKind
    && trimTrailingSlash(preset.config.baseURL) === trimTrailingSlash(config.baseURL)
    && preset.config.model === config.model
    && preset.config.toolCallingMode === config.toolCallingMode
  );
}

function providerLabel(providerKind: ModelProviderKind): string {
  if (providerKind === "openai-compatible") {
    return "OpenAI";
  }

  if (providerKind === "anthropic-compatible") {
    return "Anthropic";
  }

  return "Ollama";
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 6) {
    return "******";
  }

  return `****${trimmed.slice(-4)}`;
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
  const runtimeFlow = buildRuntimeFlow(visibleEvents, visibleLogs);
  const executionLanes = buildExecutionLanes(visibleEvents, visibleLogs);
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

      <section className="runtime-flow-panel" aria-label="本轮数据流转">
        <header>
          <span>本轮数据流转</span>
          <strong>每个节点独立显示，跳过也保留位置</strong>
        </header>
        <ol className="runtime-flow-list">
          {runtimeFlow.map((node, index) => (
            <li className="runtime-flow-item" data-kind={node.kind} data-status={node.status} key={node.id}>
              <span className="runtime-flow-item__index">{index + 1}</span>
              <article>
                <header>
                  <div>
                    <span>{node.kindLabel}</span>
                    <h3>{node.title}</h3>
                  </div>
                  <strong>{node.badge}</strong>
                </header>
                <p>{node.summary}</p>
                <dl>
                  <div>
                    <dt>接收数据</dt>
                    <dd>{node.input}</dd>
                  </div>
                  <div>
                    <dt>节点产出</dt>
                    <dd>{node.output}</dd>
                  </div>
                </dl>
              </article>
            </li>
          ))}
        </ol>
      </section>

      <details className="trace-audit-panel">
        <summary>
          <span>审计详情</span>
          <strong>关键信息、执行链路、节点产物</strong>
        </summary>
        <div className="trace-audit-panel__body">
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

          <section className="execution-lanes" aria-label="执行链路">
            <header>
              <span>执行链路</span>
              <strong>区分判断、思考、执行和最终产出</strong>
            </header>
            <div className="execution-lane-grid">
              {executionLanes.map((lane) => (
                <article className="execution-lane-card" data-kind={lane.kind} data-status={lane.status} key={lane.id}>
                  <header>
                    <span>{lane.badge}</span>
                    <h3>{lane.title}</h3>
                  </header>
                  <p>{lane.summary}</p>
                  <dl>
                    {lane.fields.map((field) => (
                      <div key={field.label}>
                        <dt>{field.label}</dt>
                        <dd>{field.value}</dd>
                      </div>
                    ))}
                  </dl>
                  {lane.details.length > 0 ? (
                    <div className="execution-lane-details">
                      {lane.details.map((item) => (
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

          {nodeOutputs.length > 0 ? (
            <section className="node-output-panel">
              <header>
                <span>系统节点产物</span>
                <strong>记忆、工具策略、上下文和审计明细</strong>
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
        </div>
      </details>

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
        <details className="trace-audit-panel" aria-label="输出信息">
          <summary>
            <span>输出信息</span>
            <strong>原始输入输出明细</strong>
          </summary>
          <div className="trace-audit-panel__body">
            <section className="info-flow-panel">
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
          </div>
        </details>
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

interface RunSummaryItem {
  readonly label: string;
  readonly value: string;
  readonly tone?: "default" | "success" | "warning" | "danger";
}

interface RuntimeFlowNode {
  readonly id: string;
  readonly kind: "input" | "router" | "core" | "planning" | "execution" | "tool" | "evaluator" | "final";
  readonly kindLabel: string;
  readonly title: string;
  readonly badge: string;
  readonly status: "done" | "pending" | "failed" | "skipped";
  readonly summary: string;
  readonly input: string;
  readonly output: string;
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

interface ExecutionLane {
  readonly id: string;
  readonly kind: "router" | "thinking" | "execution" | "final";
  readonly title: string;
  readonly badge: string;
  readonly status: "done" | "pending" | "failed" | "skipped";
  readonly summary: string;
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
  const planningPayload = asRecord(findLastEvent(events, "planning_result")?.payload);
  const toolPayload = asRecord(findLastEvent(events, "tool_selection")?.payload);
  const evaluationPayload = asRecord(findLastEvent(events, "output_evaluation")?.payload);
  const errorEvent = findLastEvent(events, "error");
  const mainModelLog = findMainModelLog(logs);
  const evaluationDisplay = Object.keys(evaluationPayload).length > 0 ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
  const items: TraceHighlight[] = [];

  if (userMessage?.content) {
    items.push({
      label: "用户输入",
      value: compactText(userMessage.content, 80)
    });
  }

  if (Object.keys(routerPayload).length > 0) {
    const turnAnalysis = asRecord(routerPayload.turn_analysis);
    const workflowDecision = asRecord(routerPayload.workflow_decision);
    const contextDecision = asRecord(routerPayload.context_decision);
    const profileObservation = asRecord(routerPayload.profile_observation);
    const profileUpdates = arrayField(profileObservation, "profile_updates");
    items.push(
      {
        label: "路由",
        value: joinNonEmpty([
          formatWorkflowRoute(stringField(workflowDecision, "workflow_route") || stringField(routerPayload, "execution_mode")),
          booleanRaw(workflowDecision, "planning_required") ? "需要 Planning" : "跳过 Planning"
        ], " / ") || "-"
      },
      {
        label: "任务分析",
        value: compactText(joinNonEmpty([
          stringField(turnAnalysis, "task_goal") || stringField(routerPayload, "task_goal"),
          stringField(turnAnalysis, "task_type") || stringField(routerPayload, "task_type"),
          stringField(turnAnalysis, "complexity") || stringField(routerPayload, "complexity")
        ], " / ") || stringField(routerPayload, "rewritten_input") || "-", 100)
      },
      {
        label: "上下文",
        value: compactText(joinNonEmpty([
          stringArrayField(contextDecision, "context_needs"),
          stringField(contextDecision, "time_context_mode"),
          booleanRaw(contextDecision, "needs_tools") ? "需要工具" : ""
        ], " / ") || "-", 100)
      },
      {
        label: "画像观察",
        value: compactText(profileUpdates.length > 0 ? `${profileUpdates.length} 项候选更新` : stringArrayField(profileObservation, "routing_influences") || "-", 100)
      },
      {
        label: "置信度",
        value: numberField(routerPayload, "confidence"),
        tone: confidenceTone(routerPayload)
      }
    );
  }

  if (Object.keys(planningPayload).length > 0) {
    items.push({
      label: "规划",
      value: compactText(stringField(planningPayload, "plan_summary") || stringField(planningPayload, "goal") || "-", 100),
      tone: booleanRaw(planningPayload, "needs_user_confirmation") ? "warning" : "success"
    });
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

function buildRuntimeFlow(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly RuntimeFlowNode[] {
  const userMessage = events.find((event) => event.type === "chat_message" && event.actor === "user");
  const routerEvent = findLastEvent(events, "router_result");
  const toolSelectionEvent = findLastEvent(events, "tool_selection");
  const planningEvent = findLastEvent(events, "planning_result");
  const evaluationEvent = findLastEvent(events, "output_evaluation");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const assistantMessage = findLast(events, (event) => event.type === "chat_message" && event.actor === "assistant");
  const errorEvent = findLastEvent(events, "error");
  const routerPayload = asRecord(routerEvent?.payload);
  const turnAnalysis = asRecord(routerPayload.turn_analysis);
  const workflowDecision = asRecord(routerPayload.workflow_decision);
  const contextDecision = asRecord(routerPayload.context_decision);
  const evaluationSeed = asRecord(routerPayload.evaluation_seed);
  const toolPayload = asRecord(toolSelectionEvent?.payload);
  const planningPayload = asRecord(planningEvent?.payload);
  const evaluationPayload = asRecord(evaluationEvent?.payload);
  const workflowRoute = stringField(workflowDecision, "workflow_route") || stringField(routerPayload, "execution_mode") || "";
  const planningRequired = booleanRaw(workflowDecision, "planning_required");
  const routerLog = findRouterLog(logs);
  const plannerLog = findPlannerLog(logs);
  const mainModelLog = findMainModelLog(logs);
  const evaluatorLog = findEvaluatorLog(logs);
  const toolNames = toolCallEvents.map((event) => {
    const payload = asRecord(event.payload);
    return stringField(payload, "type") || stringField(payload, "tool") || stringField(payload, "name") || "tool";
  });
  const evaluationDisplay = evaluationEvent ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
  const mainOutput = mainModelLog?.response
    ? compactText(formatModelResponseSummary(mainModelLog.response), 120)
    : mainModelLog?.error ? compactText(mainModelLog.error, 120) : "-";

  return [
    {
      id: "flow-input",
      kind: "input",
      kindLabel: "User",
      title: "用户输入",
      badge: userMessage ? "已接收" : "等待",
      status: userMessage ? "done" : "pending",
      summary: userMessage?.content ? compactText(userMessage.content, 120) : "等待本轮用户消息。",
      input: "用户在对话框输入的原始内容",
      output: userMessage?.content ? compactText(userMessage.content, 120) : "-"
    },
    {
      id: "flow-router",
      kind: "router",
      kindLabel: "Model",
      title: "Router 任务分析",
      badge: routerLog ? providerFlowBadge(routerLog) : routerEvent ? "已完成" : "等待",
      status: routerLog?.status === "failed" ? "failed" : routerEvent ? "done" : "pending",
      summary: routerEvent
        ? compactText(joinNonEmpty([
            formatWorkflowRoute(workflowRoute),
            stringField(turnAnalysis, "intent") || stringField(routerPayload, "intent"),
            stringField(turnAnalysis, "task_goal") || stringField(routerPayload, "task_goal")
          ], " / "), 140)
        : "前置模型分析用户诉求、任务类型、路由、上下文需求和画像线索。",
      input: "用户输入 + 简短历史",
      output: routerEvent
        ? compactText(joinNonEmpty([
            `route=${workflowRoute || "-"}`,
            `planning=${booleanField(workflowDecision, "planning_required")}`,
            stringField(routerPayload, "main_model_brief")
          ], "；"), 140)
        : "-"
    },
    {
      id: "flow-tool-policy",
      kind: "core",
      kindLabel: "Core",
      title: "工具开放策略",
      badge: toolSelectionEvent ? "已决策" : routerEvent ? "等待" : "未开始",
      status: toolSelectionEvent ? "done" : routerEvent ? "pending" : "skipped",
      summary: toolSelectionEvent
        ? compactText(stringField(toolPayload, "reason") || formatToolHighlight(routerPayload, toolPayload), 140)
        : "Core 根据 Router 结果决定本轮给 Execution 开放哪些工具。",
      input: "Router 结构化结果",
      output: toolSelectionEvent
        ? compactText(joinNonEmpty([
            stringField(toolPayload, "access_mode"),
            stringArrayField(toolPayload, "selected_tools")
          ], " / "), 120)
        : "-"
    },
    {
      id: "flow-planning",
      kind: "planning",
      kindLabel: "Model",
      title: "Planning 执行前规划",
      badge: planningEvent ? providerFlowBadge(plannerLog) : planningRequired ? "应执行" : "已跳过",
      status: planningEvent ? "done" : planningRequired ? "pending" : "skipped",
      summary: planningEvent
        ? compactText(stringField(planningPayload, "plan_summary") || stringField(planningPayload, "goal") || "Planning 已返回执行计划。", 140)
        : planningRequired
          ? "Router 判断需要规划，但本轮尚未看到 Planning 输出。"
          : `Router 路由为 ${formatWorkflowRoute(workflowRoute || "answer_only")}，本轮不进入规划模型。`,
      input: "Router 结果 + 工具策略 + 记忆/历史摘要",
      output: planningEvent
        ? compactText(joinNonEmpty([
            stringField(planningPayload, "goal"),
            stringArrayField(planningPayload, "required_tools")
          ], " / "), 140)
        : planningRequired ? "-" : "跳过，Execution 直接接收 Router 上下文"
    },
    {
      id: "flow-execution",
      kind: "execution",
      kindLabel: "Model",
      title: "Execution 主模型",
      badge: mainModelLog ? providerFlowBadge(mainModelLog) : "等待",
      status: mainModelLog?.status === "failed" ? "failed" : mainModelLog ? "done" : "pending",
      summary: mainModelLog
        ? mainOutput
        : "主模型接收上下文包，生成正式回复或工具调用请求。",
      input: planningEvent ? "Planning 计划 + 上下文包" : "Router 摘要 + 上下文包",
      output: mainOutput
    },
    {
      id: "flow-tool-run",
      kind: "tool",
      kindLabel: "Tool",
      title: "工具真实执行",
      badge: toolCallEvents.length > 0 ? `${toolResultEvents.length}/${toolCallEvents.length}` : "已跳过",
      status: toolResultEvents.some((event) => stringField(asRecord(event.payload), "status") === "failed")
        ? "failed"
        : toolCallEvents.length > 0 ? "done" : "skipped",
      summary: toolCallEvents.length > 0
        ? compactText(formatToolEventsSummary(toolCallEvents, toolResultEvents), 140)
        : "Execution 没有产生真实工具调用，本轮不执行工具。",
      input: toolCallEvents.length > 0 ? compactText(toolNames.join(" / "), 120) : "无工具调用",
      output: toolResultEvents.length > 0 ? `${toolResultEvents.length} 个工具结果` : "跳过"
    },
    {
      id: "flow-evaluator",
      kind: "evaluator",
      kindLabel: "Model",
      title: "Evaluator 输出验收",
      badge: evaluationEvent ? evaluationDisplay?.badge ?? "已验收" : "已跳过",
      status: evaluatorLog?.status === "failed" ? "failed" : evaluationEvent ? "done" : "skipped",
      summary: evaluationEvent
        ? compactText(evaluationDisplay?.summary || formatJson(evaluationPayload), 140)
        : "本轮没有触发输出验收模型。",
      input: compactText(stringArrayField(evaluationSeed, "success_criteria") || "最终回复 + 成功条件", 120),
      output: evaluationEvent
        ? compactText(joinNonEmpty([
            stringField(evaluationPayload, "status"),
            stringField(evaluationPayload, "next_action"),
            compactText(stringArrayField(evaluationPayload, "missing_criteria"), 80)
          ], " / "), 140)
        : "跳过"
    },
    {
      id: "flow-final",
      kind: "final",
      kindLabel: "UI",
      title: "最终显示",
      badge: errorEvent ? "错误" : assistantMessage ? "已显示" : "等待",
      status: errorEvent ? "failed" : assistantMessage ? "done" : "pending",
      summary: assistantMessage?.content
        ? compactText(assistantMessage.content, 140)
        : errorEvent?.content ? compactText(errorEvent.content, 140) : "等待最终消息写入对话区。",
      input: "Execution 返回 + 工具结果 + 验收结果",
      output: assistantMessage?.content ? compactText(assistantMessage.content, 140) : errorEvent?.content ? compactText(errorEvent.content, 140) : "-"
    }
  ];
}

function providerFlowBadge(log?: ProviderDebugLog): string {
  if (!log) {
    return "已完成";
  }

  if (log.status === "failed") {
    return "失败";
  }

  return log.status === "pending" ? "请求中" : "已返回";
}

function buildRunSummary(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly RunSummaryItem[] {
  const routerEvent = findLastEvent(events, "router_result");
  const planningEvent = findLastEvent(events, "planning_result");
  const evaluationEvent = findLastEvent(events, "output_evaluation");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const routerPayload = asRecord(routerEvent?.payload);
  const workflowDecision = asRecord(routerPayload.workflow_decision);
  const route = stringField(workflowDecision, "workflow_route") || stringField(routerPayload, "execution_mode") || "-";
  const planningRequired = booleanRaw(workflowDecision, "planning_required");
  const modelCalls = logs.filter((log) =>
    log.providerId.includes("router") ||
    log.providerId.includes("planner") ||
    log.providerId.includes("main") ||
    log.providerId.includes("evaluator") ||
    log.providerId.includes("compression")
  );

  return [
    {
      label: "路由",
      value: formatWorkflowRoute(route),
      tone: route === "answer_only" ? "success" : route === "planning" ? "warning" : "default"
    },
    {
      label: "模型调用",
      value: String(modelCalls.length),
      tone: modelCalls.length <= 2 ? "success" : "warning"
    },
    {
      label: "Planning",
      value: planningEvent ? "已执行" : planningRequired ? "等待/缺失" : "已跳过",
      tone: planningEvent ? "warning" : planningRequired ? "danger" : "success"
    },
    {
      label: "工具",
      value: toolCallEvents.length > 0 ? `${toolResultEvents.length}/${toolCallEvents.length}` : "未执行",
      tone: toolCallEvents.length > 0 ? "warning" : "success"
    },
    {
      label: "验收",
      value: evaluationEvent ? "已触发" : "已跳过",
      tone: evaluationEvent ? "warning" : "success"
    }
  ];
}

function formatWorkflowRoute(route: string): string {
  const labels: Record<string, string> = {
    answer_only: "直接回答",
    planning: "进入规划",
    ask_user: "需要追问",
    reject: "拒绝"
  };

  return labels[route] ?? route;
}

function buildExecutionLanes(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly ExecutionLane[] {
  const routerEvent = findLastEvent(events, "router_result");
  const planningEvent = findLastEvent(events, "planning_result");
  const toolSelectionEvent = findLastEvent(events, "tool_selection");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const assistantMessage = findLast(events, (event) => event.type === "chat_message" && event.actor === "assistant");
  const errorEvent = findLastEvent(events, "error");
  const routerPayload = asRecord(routerEvent?.payload);
  const turnAnalysis = asRecord(routerPayload.turn_analysis);
  const workflowDecision = asRecord(routerPayload.workflow_decision);
  const contextDecision = asRecord(routerPayload.context_decision);
  const profileObservation = asRecord(routerPayload.profile_observation);
  const inputRisk = asRecord(workflowDecision.input_risk);
  const planningRequired = booleanRaw(workflowDecision, "planning_required");
  const workflowRoute = stringField(workflowDecision, "workflow_route");
  const planningPayload = asRecord(planningEvent?.payload);
  const toolPayload = asRecord(toolSelectionEvent?.payload);
  const routerLog = findRouterLog(logs);
  const plannerLog = findPlannerLog(logs);
  const mainModelLog = findMainModelLog(logs);
  const mainResponse = mainModelLog?.response;
  const nativeResponse = mainResponse ? parseNativeModelResponse(mainResponse.content) : undefined;
  const failedToolResults = toolResultEvents.filter((event) => stringField(asRecord(event.payload), "status") === "failed").length;
  const confirmToolResults = toolResultEvents.filter((event) => stringField(asRecord(event.payload), "decision") === "confirm").length;
  const requestedToolNames = toolCallEvents.map((event) => {
    const payload = asRecord(event.payload);
    return stringField(payload, "type") || stringField(payload, "tool") || stringField(payload, "name") || event.type;
  });
  const nativeToolNames = nativeResponse?.toolCalls.map((call) => {
    const fn = asRecord(call.function);
    return stringField(fn, "name") || stringField(call, "id") || "tool_call";
  }) ?? [];
  const mainModelMode = nativeResponse ? "Native reasoning/tool_calls" : mainModelLog ? "Text JSON / 普通文本" : "-";
  const mainModelSummary = mainResponse
    ? nativeResponse
      ? compactText(joinNonEmpty([
          nativeResponse.reasoningContent ? `思考：${nativeResponse.reasoningContent}` : "",
          nativeToolNames.length > 0 ? `请求工具：${nativeToolNames.join(" / ")}` : "",
          nativeResponse.content ? `正式产出：${nativeResponse.content}` : ""
        ], "；"), 180)
      : compactText(formatModelResponseSummary(mainResponse), 180)
    : mainModelLog?.error ? compactText(mainModelLog.error, 180) : "等待主模型返回。";

  return [
    {
      id: "router-lane",
      kind: "router",
      title: "前置模型 Router",
      badge: routerEvent ? "判断完成" : "等待判断",
      status: routerEvent ? "done" : "pending",
      summary: routerEvent
        ? compactText(joinNonEmpty([
            `路由 ${formatWorkflowRoute(stringField(workflowDecision, "workflow_route"))}`,
            `任务 ${stringField(turnAnalysis, "task_type") || stringField(routerPayload, "task_type") || "-"}`,
            stringField(turnAnalysis, "task_goal") || stringField(routerPayload, "task_goal") || stringField(routerPayload, "rewritten_input")
          ], " / "), 180)
        : "Router v2 负责任务分析、流程路由、上下文需求、画像观察和验收种子，不是给用户的最终回复。",
      fields: [
        { label: "性质", value: "任务分析/流程路由/画像观察，不直接执行" },
        { label: "route", value: stringField(workflowDecision, "workflow_route") || "-" },
        { label: "planning", value: booleanField(workflowDecision, "planning_required") },
        { label: "intent", value: stringField(turnAnalysis, "intent") || stringField(routerPayload, "intent") || "-" },
        { label: "taskType", value: stringField(turnAnalysis, "task_type") || stringField(routerPayload, "task_type") || "-" },
        { label: "scope", value: joinNonEmpty([stringField(turnAnalysis, "task_scope"), stringField(turnAnalysis, "complexity")], " / ") || "-" },
        { label: "risk", value: joinNonEmpty([stringField(inputRisk, "level"), booleanField(inputRisk, "requires_confirmation")], " / ") || "-" },
        { label: "context", value: compactText(stringArrayField(contextDecision, "context_needs") || "-", 120) },
        { label: "profile", value: compactText(stringArrayField(profileObservation, "routing_influences") || "-", 120) },
        { label: "needsTools", value: booleanField(contextDecision, "needs_tools") },
        { label: "brief", value: compactText(stringField(routerPayload, "main_model_brief") || "-", 120) },
        { label: "confidence", value: numberField(routerPayload, "confidence") }
      ],
      details: [
        ...(routerEvent ? [{ label: "Router 输出 JSON", content: formatJson(routerPayload) }] : []),
        ...(routerLog ? modelLogDetails(routerLog) : [])
      ]
    },
    {
      id: "planning-lane",
      kind: "thinking",
      title: "规划模型 Planning",
      badge: planningEvent ? "规划完成" : planningRequired ? "应执行" : "已跳过",
      status: planningEvent ? "done" : planningRequired ? "pending" : "skipped",
      summary: planningEvent
        ? compactText(stringField(planningPayload, "plan_summary") || stringField(planningPayload, "goal") || "Planning 已产出执行计划。", 180)
        : planningRequired
          ? "Router 判断本轮需要 Planning，但当前回合尚未看到 Planning 产物。"
          : `Router 路由为 ${workflowRoute || "answer_only"}，本轮跳过 Planning，直接进入 Execution。`,
      fields: [
        { label: "性质", value: "执行前计划，不直接执行" },
        { label: "route", value: workflowRoute || "-" },
        { label: "required", value: booleanField(workflowDecision, "planning_required") },
        { label: "goal", value: compactText(stringField(planningPayload, "goal") || "-", 120) },
        { label: "tools", value: stringArrayField(planningPayload, "required_tools") || "none" },
        { label: "confirm", value: booleanField(planningPayload, "needs_user_confirmation") },
        { label: "confidence", value: numberField(planningPayload, "confidence") }
      ],
      details: [
        ...(planningEvent ? [{ label: "Planning 输出 JSON", content: formatJson(planningPayload) }] : []),
        ...(plannerLog ? modelLogDetails(plannerLog) : [])
      ]
    },
    {
      id: "main-thinking-lane",
      kind: "thinking",
      title: "执行模型 Execution",
      badge: nativeResponse?.reasoningContent ? "含思考" : mainModelLog ? "模型返回" : "等待",
      status: mainModelLog?.status === "failed" ? "failed" : mainModelLog ? "done" : "pending",
      summary: mainModelSummary,
      fields: [
        { label: "性质", value: "模型生成/工具请求，不等于已执行" },
        { label: "Provider", value: mainModelLog?.providerId ?? "-" },
        { label: "Mode", value: mainModelMode },
        { label: "ToolCalls", value: String(nativeToolNames.length) },
        { label: "Stop", value: mainResponse?.stopReason ?? "-" }
      ],
      details: mainModelLog ? modelLogDetails(mainModelLog) : []
    },
    {
      id: "tool-execution-lane",
      kind: "execution",
      title: "工具真实执行",
      badge: toolCallEvents.length > 0 ? `${toolResultEvents.length}/${toolCallEvents.length}` : "未执行",
      status: failedToolResults > 0 ? "failed" : toolCallEvents.length > 0 ? "done" : "skipped",
      summary: toolCallEvents.length > 0
        ? compactText(formatToolEventsSummary(toolCallEvents, toolResultEvents), 180)
        : "本轮没有真实读写文件或运行命令。主模型文字里出现工具计划，也要等这里出现结果才算执行。",
      fields: [
        { label: "性质", value: "这里才是真实工具 I/O" },
        { label: "开放工具", value: stringArrayField(toolPayload, "selected_tools") || "none" },
        { label: "请求数", value: String(toolCallEvents.length) },
        { label: "结果数", value: String(toolResultEvents.length) },
        { label: "需确认", value: String(confirmToolResults) }
      ],
      details: toolCallEvents.length > 0 || toolResultEvents.length > 0
        ? [{ label: "工具调用与执行结果", content: formatJson({ requestedTools: requestedToolNames, calls: toolCallEvents, results: toolResultEvents }) }]
        : toolSelectionEvent ? [{ label: "工具开放策略", content: formatJson(toolPayload) }] : []
    },
    {
      id: "final-lane",
      kind: "final",
      title: "最终展示给用户",
      badge: errorEvent ? "错误" : assistantMessage ? "已展示" : "等待",
      status: errorEvent ? "failed" : assistantMessage ? "done" : "pending",
      summary: assistantMessage?.content
        ? compactText(assistantMessage.content, 180)
        : errorEvent?.content ? compactText(errorEvent.content, 180) : "等待 Core 汇总模型返回、工具结果和验收后写入对话。",
      fields: [
        { label: "性质", value: "用户真正看到的正式产出" },
        { label: "message", value: assistantMessage?.messageId ?? "-" },
        { label: "time", value: assistantMessage ? formatTime(assistantMessage.createdAt) : "-" }
      ],
      details: assistantMessage
        ? [{ label: "最终回复完整内容", content: assistantMessage.content ?? "" }]
        : errorEvent ? [{ label: "错误事件", content: formatJson(errorEvent) }] : []
    }
  ];
}

function buildNodeOutputs(events: readonly AgentEventRecord[], logs: readonly ProviderDebugLog[]): readonly NodeOutput[] {
  const routerEvent = findLastEvent(events, "router_result");
  const planningEvent = findLastEvent(events, "planning_result");
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
  const turnAnalysis = asRecord(routerPayload.turn_analysis);
  const workflowDecision = asRecord(routerPayload.workflow_decision);
  const contextDecision = asRecord(routerPayload.context_decision);
  const profileObservation = asRecord(routerPayload.profile_observation);
  const evaluationSeed = asRecord(routerPayload.evaluation_seed);
  const inputRisk = asRecord(workflowDecision.input_risk);
  const profileUpdates = arrayField(profileObservation, "profile_updates");
  const planningPayload = asRecord(planningEvent?.payload);
  const memoryWritePayload = asRecord(memoryWriteEvent?.payload);
  const memoryRecallPayload = asRecord(memoryRecallEvent?.payload);
  const toolPayload = asRecord(toolSelectionEvent?.payload);
  const evaluationPayload = asRecord(evaluationEvent?.payload);
  const promptIterationPayload = asRecord(promptIterationEvent?.payload);
  const evaluationDisplay = evaluationEvent ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
  const routerLog = findRouterLog(logs);
  const plannerLog = findPlannerLog(logs);
  const mainModelLog = findMainModelLog(logs);
  const evaluatorLog = findEvaluatorLog(logs);
  const nodes: NodeOutput[] = [];

  nodes.push({
    id: "router",
    kind: "Router",
    title: "Router v2 任务分析产物",
    badge: routerEvent ? "完成" : "等待",
    status: routerEvent ? "done" : "pending",
    output: routerEvent
      ? compactText(joinNonEmpty([
          stringField(workflowDecision, "workflow_route") ? `route=${stringField(workflowDecision, "workflow_route")}` : "",
          stringField(turnAnalysis, "task_goal") || stringField(routerPayload, "task_goal"),
          stringField(turnAnalysis, "reasoning_brief") || stringField(routerPayload, "reasoning_brief"),
          stringArrayField(profileObservation, "routing_influences")
        ], " | "), 150) || "Router 已产出结构化结果"
      : "等待 Router 产出任务分析、流程路由、上下文需求、画像观察和验收种子。",
    fields: [
      { label: "route", value: stringField(workflowDecision, "workflow_route") || "-" },
      { label: "planning", value: booleanField(workflowDecision, "planning_required") },
      { label: "intent", value: stringField(turnAnalysis, "intent") || stringField(routerPayload, "intent") || "-" },
      { label: "taskType", value: stringField(turnAnalysis, "task_type") || stringField(routerPayload, "task_type") || "-" },
      { label: "scope", value: joinNonEmpty([stringField(turnAnalysis, "task_scope"), stringField(turnAnalysis, "complexity")], " / ") || "-" },
      { label: "risk", value: joinNonEmpty([stringField(inputRisk, "level"), booleanField(inputRisk, "requires_confirmation")], " / ") || "-" },
      { label: "contextNeeds", value: compactText(stringArrayField(contextDecision, "context_needs") || "-", 96) },
      { label: "time", value: stringField(contextDecision, "time_context_mode") || "-" },
      { label: "profileUpdates", value: String(profileUpdates.length) },
      { label: "influences", value: compactText(stringArrayField(profileObservation, "routing_influences") || "-", 96) },
      { label: "brief", value: compactText(stringField(routerPayload, "main_model_brief") || "-", 96) },
      { label: "output", value: compactText(stringField(turnAnalysis, "expected_output") || stringField(routerPayload, "expected_output") || "-", 96) },
      { label: "confidence", value: numberField(routerPayload, "confidence") },
      { label: "criteria", value: compactText(stringArrayField(evaluationSeed, "success_criteria") || stringArrayField(routerPayload, "success_criteria") || "-", 96) }
    ],
    details: [
      ...(routerEvent ? [
        { label: "turn_analysis", content: formatJson(turnAnalysis) },
        { label: "workflow_decision", content: formatJson(workflowDecision) },
        { label: "context_decision", content: formatJson(contextDecision) },
        { label: "profile_observation", content: formatJson(profileObservation) },
        { label: "evaluation_seed", content: formatJson(evaluationSeed) }
      ] : []),
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
    id: "planning",
    kind: "Planning",
    title: "规划产物",
    badge: planningEvent ? "完成" : "等待",
    status: planningEvent ? "done" : "pending",
    output: planningEvent
      ? compactText(joinNonEmpty([
          stringField(planningPayload, "goal"),
          stringField(planningPayload, "plan_summary"),
          stringField(planningPayload, "expected_result")
        ], " | "), 180)
      : "等待 Planning 模型产出执行计划。Planning 不执行工具，只给 Execution 提供目标、步骤和风险。",
    fields: [
      { label: "tools", value: stringArrayField(planningPayload, "required_tools") || "none" },
      { label: "inspect", value: compactText(stringArrayField(planningPayload, "files_to_inspect") || "-", 96) },
      { label: "modify", value: compactText(stringArrayField(planningPayload, "files_to_modify") || "-", 96) },
      { label: "confirm", value: booleanField(planningPayload, "needs_user_confirmation") },
      { label: "risks", value: compactText(stringArrayField(planningPayload, "risks") || "-", 96) },
      { label: "confidence", value: numberField(planningPayload, "confidence") }
    ],
    details: [
      ...(planningEvent ? [{ label: "Planning 结构化产物", content: formatJson(planningPayload) }] : []),
      ...(plannerLog ? modelLogDetails(plannerLog) : [])
    ]
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
      purpose: "前置模型用于任务分析、流程路由、上下文需求、画像观察和验收种子。",
      template: {
        name: "router.task-analysis.v2",
        version: "v2",
        files: [
          "packages/memorizes/router/01-system.md",
          "packages/memorizes/router/02-input.md"
        ],
        variables: ["recent_messages", "input"]
      }
    }),
    promptViewFromLog(findPlannerLog(logs), {
      id: "planning-prompt",
      title: "Planning 提示词",
      purpose: "规划模型用于在执行前拆目标、步骤、工具需求、风险和确认项。",
      template: {
        name: "main.planning.v1",
        version: "v1",
        files: [
          "packages/memorizes/planning/01-system.md",
          "packages/memorizes/planning/02-input.md"
        ],
        variables: ["user_input", "router_result", "tool_selection", "memories", "conversation_summary", "recent_messages"]
      }
    }),
    promptViewFromLog(findMainModelLog(logs), {
      id: "main-prompt",
      title: "Execution 提示词",
      purpose: "执行模型用于按 Planning 结果请求工具、整理结果并生成正式回复。",
      template: {
        name: "main.agent.v1",
        version: "v1",
        files: [
          "packages/memorizes/system/01-role.md",
          "packages/memorizes/system/02-goals.md",
          "packages/memorizes/system/03-style.md",
          "packages/memorizes/context/router-runtime.md"
        ],
        variables: ["router_context", "messages"]
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
  const planningEvent = findLastEvent(events, "planning_result");
  const toolSelectionEvent = findLastEvent(events, "tool_selection");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const evaluationEvent = findLastEvent(events, "output_evaluation");
  const assistantMessage = findLast(events, (event) => event.type === "chat_message" && event.actor === "assistant");
  const routerLog = findRouterLog(logs);
  const plannerLog = findPlannerLog(logs);
  const mainModelLog = findMainModelLog(logs);
  const evaluatorLog = findEvaluatorLog(logs);
  const flows: InfoFlowItem[] = [];

  if (userMessage?.content) {
    flows.push({
      id: "user-to-router",
      from: "User",
      to: "Router",
      title: "用户输入进入 Router 任务分析",
      content: compactText(userMessage.content, 140),
      rawLabel: "用户输入",
      raw: userMessage.content
    });
  }

  if (routerLog) {
    flows.push({
      id: "router-request",
      from: "Core",
      to: "Router",
      title: "Router 模型请求",
      content: compactText(routerLog.request.latestUserMessage ?? readModelRequestMessages(routerLog).at(-1)?.content ?? "已发送 Router 请求。", 140),
      rawLabel: "Router 请求",
      raw: formatModelRequest(routerLog)
    });
  }

  if (routerEvent) {
    const routerPayload = asRecord(routerEvent.payload);
    const workflowDecision = asRecord(routerPayload.workflow_decision);
    const turnAnalysis = asRecord(routerPayload.turn_analysis);
    flows.push({
      id: "router-output",
      from: "Router",
      to: "Core",
      title: "Router 返回结构化产物",
      content: compactText(joinNonEmpty([
        formatWorkflowRoute(stringField(workflowDecision, "workflow_route")),
        stringField(turnAnalysis, "task_type") || stringField(routerPayload, "task_type"),
        stringField(turnAnalysis, "task_goal") || stringField(routerPayload, "task_goal")
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

  if (plannerLog) {
    flows.push({
      id: "planning-request",
      from: "Core",
      to: "Planning",
      title: "规划模型请求",
      content: compactText(plannerLog.request.latestUserMessage ?? readModelRequestMessages(plannerLog).at(-1)?.content ?? "已发送 Planning 请求。", 140),
      rawLabel: "Planning 请求",
      raw: formatModelRequest(plannerLog)
    });
  }

  if (planningEvent) {
    const planningPayload = asRecord(planningEvent.payload);
    flows.push({
      id: "planning-output",
      from: "Planning",
      to: "Execution",
      title: "Planning 返回执行计划",
      content: compactText(stringField(planningPayload, "plan_summary") || stringField(planningPayload, "goal") || "Planning 已返回。", 150),
      rawLabel: "Planning 输出 JSON",
      raw: formatJson(planningPayload),
      tone: booleanRaw(planningPayload, "needs_user_confirmation") ? "warning" : "success"
    });
  }

  if (mainModelLog) {
    flows.push({
      id: "main-request",
      from: "Core",
      to: "Execution",
      title: "Execution 上下文包",
      content: compactText(formatModelMessagesSummary(mainModelLog), 150),
      rawLabel: "大模型请求",
      raw: formatModelRequest(mainModelLog)
    });
  }

  if (mainModelLog?.response?.content) {
    flows.push({
      id: "main-response",
      from: "Execution",
      to: "Core",
      title: "Execution 返回",
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
  const planningEvent = findLastEvent(events, "planning_result");
  const toolSelectionEvent = findLastEvent(events, "tool_selection");
  const toolCallEvents = events.filter((event) => event.type === "tool_call");
  const toolResultEvents = events.filter((event) => event.type === "tool_result");
  const modelReturnEvents = events.filter((event) => event.type === "model_return");
  const evaluationEvent = findLastEvent(events, "output_evaluation");
  const assistantMessage = findLast(events, (event) => event.type === "chat_message" && event.actor === "assistant");
  const errorEvent = findLastEvent(events, "error");
  const routerPayload = asRecord(routerEvent?.payload);
  const planningPayload = asRecord(planningEvent?.payload);
  const toolPayload = asRecord(toolSelectionEvent?.payload);
  const evaluationPayload = asRecord(evaluationEvent?.payload);
  const evaluationDisplay = evaluationEvent ? evaluationDisplayFromPayload(evaluationPayload) : undefined;
  const mainModelLog = findMainModelLog(logs);
  const routerLog = findRouterLog(logs);
  const plannerLog = findPlannerLog(logs);
  const evaluatorLog = findEvaluatorLog(logs);

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
      title: "Router 任务分析",
      summary: routerEvent
        ? compactText(joinNonEmpty([
            formatWorkflowRoute(stringField(asRecord(routerPayload.workflow_decision), "workflow_route")),
            stringField(asRecord(routerPayload.turn_analysis), "task_type") || stringField(routerPayload, "task_type"),
            stringField(asRecord(routerPayload.turn_analysis), "task_goal") || stringField(routerPayload, "task_goal")
          ], " / "), 120)
        : "等待 Router 结果",
      badge: routerEvent ? "完成" : "等待",
      present: Boolean(routerEvent),
      status: "done",
      fields: [
        { label: "路由", value: formatWorkflowRoute(stringField(asRecord(routerPayload.workflow_decision), "workflow_route")) },
        { label: "Planning", value: booleanField(asRecord(routerPayload.workflow_decision), "planning_required") },
        { label: "类型", value: stringField(asRecord(routerPayload.turn_analysis), "task_type") || stringField(routerPayload, "task_type") },
        { label: "任务范围", value: joinNonEmpty([stringField(asRecord(routerPayload.turn_analysis), "task_scope"), stringField(asRecord(routerPayload.turn_analysis), "complexity")], " / ") || "-" },
        { label: "置信度", value: numberField(routerPayload, "confidence") },
        { label: "验收问题", value: compactText(stringField(routerPayload, "verification_question"), 120) },
        { label: "成功条件", value: stringArrayField(routerPayload, "success_criteria") }
      ],
      rawLabel: "router_result event",
      raw: routerEvent ? formatJson(routerPayload) : undefined,
      related: routerLog ? modelLogDetails(routerLog) : []
    },
    {
      id: "planning",
      title: "Planning 规划",
      summary: planningEvent ? compactText(stringField(planningPayload, "plan_summary") || stringField(planningPayload, "goal"), 110) : "等待规划结果",
      badge: planningEvent ? "完成" : "等待",
      present: Boolean(planningEvent),
      status: planningEvent ? "done" : "pending",
      fields: [
        { label: "目标", value: compactText(stringField(planningPayload, "goal"), 120) },
        { label: "工具", value: stringArrayField(planningPayload, "required_tools") || "none" },
        { label: "需确认", value: booleanField(planningPayload, "needs_user_confirmation") },
        { label: "预期结果", value: compactText(stringField(planningPayload, "expected_result"), 120) }
      ],
      rawLabel: "planning_result event",
      raw: planningEvent ? formatJson(planningPayload) : undefined,
      related: plannerLog ? modelLogDetails(plannerLog) : []
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
  return findLast(logs, (log) => log.providerId === "main" || log.providerId.startsWith("main-"));
}

function findPlannerLog(logs: readonly ProviderDebugLog[]): ProviderDebugLog | undefined {
  return findLast(logs, (log) => log.providerId.includes("planner"));
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
  return stringArrayValues(value).join(" / ");
}

function stringArrayValues(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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
