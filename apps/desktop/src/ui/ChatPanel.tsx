import { useMemo, useState } from "react";
import { Bot, BrainCircuit, FilePlus2, GitBranch, Play, Send, UserRoundCog } from "lucide-react";
import type { ChatMessage, ChatSessionId, ModelProfile, WorkflowDefinition, WorkflowRun } from "@xiaomi/shared";

const initialMessages: readonly ChatMessage[] = [
  {
    id: "welcome",
    sender: "assistant",
    roleLabel: "项目角色",
    content: "我会作为项目协作入口接收你的目标，后续可以生成角色编排、触发工作流、总结节点产出，并把关键信息写入项目记忆。",
    createdAt: new Date().toISOString()
  },
  {
    id: "scope",
    sender: "assistant",
    roleLabel: "系统提示",
    content: "当前已接入 Core ChatService，默认使用本地 Mock Provider。真实模型 Provider 会在下一阶段接入。",
    createdAt: new Date().toISOString()
  }
];

const quickActions = [
  { id: "draft-workflow", label: "生成流程草案", icon: GitBranch },
  { id: "run-current", label: "运行当前流程", icon: Play },
  { id: "save-memory", label: "记录到项目记忆", icon: FilePlus2 }
];

interface ChatPanelProps {
  readonly modelProfiles: readonly ModelProfile[];
  readonly workflow: WorkflowDefinition | null;
  readonly latestRun: WorkflowRun | null;
}

export function ChatPanel({ modelProfiles, workflow, latestRun }: ChatPanelProps): JSX.Element {
  const [messages, setMessages] = useState<readonly ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState("mock-project-role");
  const [sessionId, setSessionId] = useState<ChatSessionId | undefined>();
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = draft.trim().length > 0 && !isSending;
  const selectedProfile = modelProfiles.find((profile) => profile.id === model);

  const providerStatus = useMemo(() => {
    if (!selectedProfile || selectedProfile.status === "missing-config") {
      return "待配置";
    }
    if (selectedProfile.status === "mock") {
      return "Mock";
    }
    return "可用";
  }, [selectedProfile]);

  async function sendMessage(): Promise<void> {
    const content = draft.trim();
    if (!content) {
      return;
    }

    const optimisticUserMessage: ChatMessage = {
      id: `pending-user-${Date.now()}`,
      sender: "user",
      roleLabel: "你",
      content,
      createdAt: new Date().toISOString()
    };
    setMessages((current) => [...current, optimisticUserMessage]);
    setDraft("");
    setIsSending(true);
    setError(null);

    try {
      const response = await window.workbench.sendChatMessage({
        sessionId,
        projectId: "local-project",
        modelProfileId: selectedProfile?.id ?? "mock-project-role",
        message: content,
        context: {
          workflow: workflow ?? undefined,
          latestRun
        }
      });
      setSessionId(response.session.id);
      setMessages(response.session.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          sender: "assistant",
          roleLabel: "系统",
          content: "发送失败，请检查 Core ChatService 或 Provider 配置。",
          createdAt: new Date().toISOString()
        }
      ]);
    } finally {
      setIsSending(false);
    }
  }

  function insertActionPrompt(actionId: string): void {
    const prompts: Record<string, string> = {
      "draft-workflow": "请根据当前项目目标生成一个多角色 Agent 编排流程草案。",
      "run-current": "请运行当前工作流，并解释每个角色节点的产出。",
      "save-memory": "请把这次对话中的关键项目决策整理后写入中文项目记忆。"
    };
    setDraft(prompts[actionId] ?? "");
  }

  return (
    <section className="chat-panel">
      <header className="chat-panel__header">
        <div>
          <h3>项目 Chatbot</h3>
          <p>自然语言入口，后续接入 Provider 与角色运行时</p>
        </div>
        <span className="provider-pill">{providerStatus}</span>
      </header>

      <section className="model-strip">
        <label htmlFor="model-select">
          <BrainCircuit size={15} />
          模型
        </label>
        <select id="model-select" value={model} onChange={(event) => setModel(event.target.value)}>
          {modelProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.label}
            </option>
          ))}
        </select>
      </section>

      <section className="quick-actions" aria-label="Chat 快捷动作">
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.id} type="button" onClick={() => insertActionPrompt(action.id)}>
              <Icon size={15} />
              {action.label}
            </button>
          );
        })}
      </section>

      <section className="message-list" aria-label="聊天消息">
        {error ? <div className="chat-error">{error}</div> : null}
        {messages.map((message) => (
          <article className={`message message--${message.sender}`} key={message.id}>
            <div className="message__avatar">
              {message.sender === "assistant" ? <Bot size={15} /> : <UserRoundCog size={15} />}
            </div>
            <div className="message__body">
              <div className="message__meta">{message.roleLabel}</div>
              <p>{message.content}</p>
            </div>
          </article>
        ))}
      </section>

      <footer className="composer">
        <textarea
          aria-label="输入消息"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              sendMessage();
            }
          }}
          placeholder="向项目角色描述目标，或让它生成/调整编排流程..."
        />
        <button className="send-button" type="button" disabled={!canSend} onClick={sendMessage} title="发送">
          {isSending ? <span className="send-button__dot" /> : <Send size={17} />}
        </button>
      </footer>
    </section>
  );
}
