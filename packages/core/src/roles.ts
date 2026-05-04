import type { RoleDefinition } from "@xiaomi/shared";

export const defaultRoles: readonly RoleDefinition[] = [
  {
    id: "project-manager",
    name: "项目角色",
    responsibility: "承接用户输入、拆分任务、协调角色并汇总输出。",
    systemPrompt: "你是项目入口和协作调度中心，负责明确目标、分派任务、整合角色产出。",
    permissions: { readFiles: true },
    outputFormat: "markdown"
  },
  {
    id: "product-manager",
    name: "产品角色",
    responsibility: "澄清需求、定义范围、输出验收标准。",
    systemPrompt: "你是产品经理，关注用户价值、需求边界、功能优先级和验收标准。",
    permissions: {},
    outputFormat: "markdown"
  },
  {
    id: "architect",
    name: "技术角色",
    responsibility: "设计架构、评估技术方案、识别风险。",
    systemPrompt: "你是技术架构师，关注模块边界、技术选型、可扩展性和工程风险。",
    permissions: { readFiles: true },
    outputFormat: "markdown"
  },
  {
    id: "developer",
    name: "开发角色",
    responsibility: "实现功能、修改代码、处理构建问题。",
    systemPrompt: "你是开发工程师，关注代码实现、测试、构建和可维护性。",
    permissions: { readFiles: true, writeFiles: true, runCommands: true },
    outputFormat: "markdown"
  },
  {
    id: "tester",
    name: "测试角色",
    responsibility: "设计测试点、验证结果、指出风险。",
    systemPrompt: "你是测试工程师，关注验收标准、边界情况、回归风险和验证结果。",
    permissions: { readFiles: true, runCommands: true },
    outputFormat: "markdown"
  }
];

export function getRole(roleId: string): RoleDefinition | undefined {
  return defaultRoles.find((role) => role.id === roleId);
}
