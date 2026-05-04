import { useMemo, useState } from "react";
import { Boxes, Check, Code2, FlaskConical, GitBranch, Layers3, ShieldCheck, Sparkles, UserRoundPlus } from "lucide-react";
import type { ModelProfile, RoleDefinition } from "@xiaomi/shared";

const projectStages = [
  { id: "discovery", label: "需求澄清", owner: "产品角色", detail: "确认目标、用户场景、范围和验收标准。" },
  { id: "architecture", label: "技术方案", owner: "技术角色", detail: "确定模块、数据模型、工具权限和风险。" },
  { id: "implementation", label: "功能实现", owner: "开发角色", detail: "拆任务、改代码、补测试、处理构建。" },
  { id: "verification", label: "质量验证", owner: "测试角色", detail: "验证流程、检查边界情况、输出风险。" },
  { id: "delivery", label: "项目交付", owner: "项目角色", detail: "汇总产出物，记录项目记忆，安排下一轮。" }
];

const suggestedAgents = [
  { roleId: "project-manager", level: "核心", icon: Layers3 },
  { roleId: "product-manager", level: "核心", icon: Sparkles },
  { roleId: "architect", level: "核心", icon: Boxes },
  { roleId: "developer", level: "核心", icon: Code2 },
  { roleId: "tester", level: "核心", icon: FlaskConical }
];

interface AgentBuilderPageProps {
  readonly roles: readonly RoleDefinition[];
  readonly modelProfiles: readonly ModelProfile[];
}

export function AgentBuilderPage({ roles, modelProfiles }: AgentBuilderPageProps): JSX.Element {
  const [selectedRoleIds, setSelectedRoleIds] = useState<readonly string[]>(
    suggestedAgents.map((agent) => agent.roleId)
  );
  const [defaultModelId, setDefaultModelId] = useState("mock-project-role");

  const selectedRoles = useMemo(
    () => roles.filter((role) => selectedRoleIds.includes(role.id)),
    [roles, selectedRoleIds]
  );

  function toggleRole(roleId: string): void {
    setSelectedRoleIds((current) =>
      current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId]
    );
  }

  return (
    <section className="builder-page">
      <header className="builder-hero">
        <div>
          <p className="eyebrow">Agent Builder</p>
          <h2>组建你的项目开发 Agent 团队</h2>
          <p>
            先确定角色、模型、权限和协作阶段。后续这里会生成工作流，并让这些 Agent 一起推进整个项目开发。
          </p>
        </div>
        <button className="primary-button" type="button">
          <GitBranch size={18} />
          生成编排草案
        </button>
      </header>

      <section className="builder-grid">
        <div className="builder-main">
          <section className="builder-section">
            <div className="section-heading">
              <div>
                <h3>选择角色</h3>
                <p>第一版建议先保留项目、产品、技术、开发、测试五个核心角色。</p>
              </div>
              <span>{selectedRoles.length} 个已选择</span>
            </div>

            <div className="agent-card-grid">
              {roles.map((role) => {
                const suggested = suggestedAgents.find((agent) => agent.roleId === role.id);
                const Icon = suggested?.icon ?? UserRoundPlus;
                const selected = selectedRoleIds.includes(role.id);
                return (
                  <button
                    className={selected ? "agent-card agent-card--selected" : "agent-card"}
                    key={role.id}
                    type="button"
                    onClick={() => toggleRole(role.id)}
                  >
                    <span className="agent-card__check">{selected ? <Check size={15} /> : null}</span>
                    <span className="agent-card__icon">
                      <Icon size={19} />
                    </span>
                    <strong>{role.name}</strong>
                    <small>{suggested?.level ?? "可选"}</small>
                    <p>{role.responsibility}</p>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="builder-section">
            <div className="section-heading">
              <div>
                <h3>开发阶段</h3>
                <p>按项目推进过程组织角色，而不是让多个 Agent 各说各话。</p>
              </div>
            </div>

            <div className="stage-list">
              {projectStages.map((stage, index) => (
                <article className="stage-item" key={stage.id}>
                  <span className="stage-index">{index + 1}</span>
                  <div>
                    <strong>{stage.label}</strong>
                    <p>{stage.detail}</p>
                  </div>
                  <em>{stage.owner}</em>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="builder-side">
          <section className="builder-section">
            <div className="section-heading">
              <div>
                <h3>默认模型</h3>
                <p>真实 Provider 接入前，先用 Mock 模型跑通协作体验。</p>
              </div>
            </div>
            <select value={defaultModelId} onChange={(event) => setDefaultModelId(event.target.value)}>
              {modelProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.label}
                </option>
              ))}
            </select>
          </section>

          <section className="builder-section">
            <div className="section-heading">
              <div>
                <h3>权限策略</h3>
                <p>开发前先把风险边界摆在明处。</p>
              </div>
            </div>
            <div className="policy-list">
              <div>
                <ShieldCheck size={16} />
                <span>产品/项目角色默认只读</span>
              </div>
              <div>
                <ShieldCheck size={16} />
                <span>开发角色可申请写文件和命令执行</span>
              </div>
              <div>
                <ShieldCheck size={16} />
                <span>高风险工具必须人工确认</span>
              </div>
            </div>
          </section>

          <section className="builder-section builder-summary">
            <h3>团队摘要</h3>
            <p>
              当前团队会以项目角色为入口，由 {selectedRoles.map((role) => role.name).join("、") || "待选择角色"} 协作推进。
            </p>
          </section>
        </aside>
      </section>
    </section>
  );
}
