import { MessageSquareText, Sparkles } from "lucide-react";
import type { ModelProfile, WorkflowDefinition, WorkflowRun } from "@xiaomi/shared";
import { ChatPanel } from "./ChatPanel";

interface ChatHomePageProps {
  readonly modelProfiles: readonly ModelProfile[];
  readonly workflow: WorkflowDefinition | null;
  readonly latestRun: WorkflowRun | null;
}

export function ChatHomePage({ modelProfiles, workflow, latestRun }: ChatHomePageProps): JSX.Element {
  return (
    <section className="chat-home">
      <header className="chat-home__header">
        <div className="chat-home__mark">
          <MessageSquareText size={24} />
        </div>
        <p className="eyebrow">Project Chat</p>
        <h2>通过对话组建 Agent，并继续完成整个项目</h2>
        <p>
          你只需要描述目标、补充约束或发起下一步。系统后续会通过项目角色理解意图，生成角色团队、编排任务、运行 Agent，并沉淀项目记忆。
        </p>
        <div className="chat-home__hint">
          <Sparkles size={16} />
          <span>当前先接入 Core Mock Provider，真实模型接入后这里会成为主要操作入口。</span>
        </div>
      </header>

      <div className="chat-home__panel">
        <ChatPanel modelProfiles={modelProfiles} workflow={workflow} latestRun={latestRun} />
      </div>
    </section>
  );
}
