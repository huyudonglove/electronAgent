import { useState } from "react";
import { Bug, RefreshCw, Send, X } from "lucide-react";
import type {
  ChatMessage,
  ChatSessionId,
  ModelProfile,
  ProviderDebugLog,
  WorkflowDefinition,
  WorkflowRun
} from "@xiaomi/shared";

const initialMessage: ChatMessage = {
  id: "minimal-welcome",
  sender: "assistant",
  roleLabel: "项目角色",
  content: "说出你想做什么，我会从对话中帮你组建 Agent、生成编排、记录记忆，并继续推进项目。",
  createdAt: new Date().toISOString()
};

interface MinimalChatPageProps {
  readonly modelProfiles: readonly ModelProfile[];
  readonly workflow: WorkflowDefinition | null;
  readonly latestRun: WorkflowRun | null;
}

export function MinimalChatPage({ modelProfiles, workflow, latestRun }: MinimalChatPageProps): JSX.Element {
  const [messages, setMessages] = useState<readonly ChatMessage[]>([initialMessage]);
  const [draft, setDraft] = useState("");
  const [sessionId, setSessionId] = useState<ChatSessionId | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugLogs, setDebugLogs] = useState<readonly ProviderDebugLog[]>([]);

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

    try {
      const response = await window.workbench.sendChatMessage({
        sessionId,
        projectId: "local-project",
        modelProfileId: modelProfiles.find((profile) => profile.id === "mimo-v2-5-pro")?.id ?? "mimo-v2-5-pro",
        message: content,
        context: {
          workflow: workflow ?? undefined,
          latestRun
        }
      });

      setSessionId(response.session.id);
      setMessages(response.session.messages);
      await refreshDebugLogs();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refreshDebugLogs();
    } finally {
      setIsSending(false);
    }
  }

  async function refreshDebugLogs(): Promise<void> {
    const logs = await window.workbench.listProviderDebugLogs();
    setDebugLogs(logs);
  }

  return (
    <main className="minimal-chat">
      <button
        className="debug-toggle"
        type="button"
        onClick={async () => {
          const nextOpen = !debugOpen;
          setDebugOpen(nextOpen);
          if (nextOpen) {
            await refreshDebugLogs();
          }
        }}
      >
        <Bug size={16} />
        调试
      </button>

      <section className="minimal-chat__messages" aria-label="对话消息">
        {messages.map((message) => (
          <article className={`minimal-message minimal-message--${message.sender}`} key={message.id}>
            <div className="minimal-message__meta">{message.roleLabel}</div>
            <p>{message.content}</p>
          </article>
        ))}
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
              <p>最近模型请求与返回，不展示 API Key。</p>
            </div>
            <div className="debug-drawer__actions">
              <button type="button" onClick={() => void refreshDebugLogs()} title="刷新">
                <RefreshCw size={16} />
              </button>
              <button type="button" onClick={() => setDebugOpen(false)} title="关闭">
                <X size={16} />
              </button>
            </div>
          </header>

          <section className="debug-log-list">
            {debugLogs.length > 0 ? (
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
                      <pre>{log.response.content}</pre>
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
            )}
          </section>
        </aside>
      ) : null}
    </main>
  );
}

function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
