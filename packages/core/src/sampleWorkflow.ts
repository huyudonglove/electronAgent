import type { WorkflowDefinition } from "@xiaomi/shared";

export const sampleWorkflow: WorkflowDefinition = {
  id: "role-collaboration-mvp",
  name: "角色协作 MVP",
  nodes: [
    {
      id: "start",
      kind: "start",
      data: {
        label: "项目输入",
        prompt: "创建一个支持角色编排的 Electron Agent 工作台。"
      }
    },
    {
      id: "product",
      kind: "role-agent",
      data: {
        label: "产品角色",
        roleId: "product-manager",
        prompt: "整理功能范围、用户流程和验收标准。"
      }
    },
    {
      id: "architecture",
      kind: "role-agent",
      data: {
        label: "技术角色",
        roleId: "architect",
        prompt: "设计模块边界、数据模型和技术风险。"
      }
    },
    {
      id: "development",
      kind: "role-agent",
      data: {
        label: "开发角色",
        roleId: "developer",
        prompt: "根据产品与技术输入给出实现计划。"
      }
    },
    {
      id: "testing",
      kind: "role-agent",
      data: {
        label: "测试角色",
        roleId: "tester",
        prompt: "根据前序输入给出测试计划和风险清单。"
      }
    },
    {
      id: "merge",
      kind: "merge",
      data: {
        label: "项目汇总"
      }
    },
    {
      id: "artifact",
      kind: "artifact-output",
      data: {
        label: "保存产出"
      }
    }
  ],
  edges: [
    { id: "start-product", source: "start", target: "product" },
    { id: "start-architecture", source: "start", target: "architecture" },
    { id: "product-development", source: "product", target: "development" },
    { id: "architecture-development", source: "architecture", target: "development" },
    { id: "development-testing", source: "development", target: "testing" },
    { id: "development-merge", source: "development", target: "merge" },
    { id: "testing-merge", source: "testing", target: "merge" },
    { id: "merge-artifact", source: "merge", target: "artifact" }
  ]
};
