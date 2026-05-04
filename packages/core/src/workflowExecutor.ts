import type { AgentNode, NodeRun, WorkflowDefinition, WorkflowRun } from "@xiaomi/shared";
import { getRole } from "./roles";

export interface WorkflowExecutorOptions {
  readonly initialInput: string;
}

type NodeRunDraft = Omit<NodeRun, "completedAt"> & { completedAt?: string };

export async function runWorkflow(
  workflow: WorkflowDefinition,
  options: WorkflowExecutorOptions
): Promise<WorkflowRun> {
  const startedAt = new Date().toISOString();
  const incoming = buildIncomingMap(workflow);
  const outgoing = buildOutgoingMap(workflow);
  const completed = new Set<string>();
  const running = new Set<string>();
  const outputs = new Map<string, string>();
  const runs = new Map<string, NodeRunDraft>();

  for (const node of workflow.nodes) {
    runs.set(node.id, { nodeId: node.id, status: "idle" });
  }

  while (completed.size < workflow.nodes.length) {
    const readyNodes = workflow.nodes.filter((node) => {
      if (completed.has(node.id) || running.has(node.id)) {
        return false;
      }

      const upstream = incoming.get(node.id) ?? [];
      return upstream.every((nodeId) => completed.has(nodeId));
    });

    if (readyNodes.length === 0) {
      throw new Error("Workflow cannot continue. Check for cycles or unresolved dependencies.");
    }

    await Promise.all(
      readyNodes.map(async (node) => {
        running.add(node.id);
        const input = collectInput(node, incoming, outputs, options.initialInput);
        runs.set(node.id, {
          nodeId: node.id,
          status: "running",
          startedAt: new Date().toISOString(),
          input
        });

        try {
          const output = await executeNode(node, input);
          outputs.set(node.id, output);
          completed.add(node.id);
          runs.set(node.id, {
            nodeId: node.id,
            status: "succeeded",
            startedAt: runs.get(node.id)?.startedAt,
            completedAt: new Date().toISOString(),
            input,
            output
          });
        } catch (error) {
          runs.set(node.id, {
            nodeId: node.id,
            status: "failed",
            startedAt: runs.get(node.id)?.startedAt,
            completedAt: new Date().toISOString(),
            input,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        } finally {
          running.delete(node.id);
        }
      })
    );

    for (const node of readyNodes) {
      const targets = outgoing.get(node.id) ?? [];
      for (const target of targets) {
        if (!workflow.nodes.some((candidate) => candidate.id === target)) {
          throw new Error(`Workflow edge points to unknown node: ${target}`);
        }
      }
    }
  }

  return {
    id: `run-${Date.now()}`,
    workflowId: workflow.id,
    status: "succeeded",
    startedAt,
    completedAt: new Date().toISOString(),
    nodes: workflow.nodes.map((node) => runs.get(node.id) as NodeRun)
  };
}

function buildIncomingMap(workflow: WorkflowDefinition): Map<string, string[]> {
  const incoming = new Map<string, string[]>();
  for (const node of workflow.nodes) {
    incoming.set(node.id, []);
  }
  for (const edge of workflow.edges) {
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  }
  return incoming;
}

function buildOutgoingMap(workflow: WorkflowDefinition): Map<string, string[]> {
  const outgoing = new Map<string, string[]>();
  for (const node of workflow.nodes) {
    outgoing.set(node.id, []);
  }
  for (const edge of workflow.edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  }
  return outgoing;
}

function collectInput(
  node: AgentNode,
  incoming: Map<string, string[]>,
  outputs: Map<string, string>,
  initialInput: string
): string {
  const upstream = incoming.get(node.id) ?? [];
  if (upstream.length === 0) {
    return initialInput;
  }

  return upstream.map((nodeId) => outputs.get(nodeId) ?? "").join("\n\n---\n\n");
}

async function executeNode(node: AgentNode, input: string): Promise<string> {
  await wait(220);

  if (node.kind === "start") {
    return `项目输入已接收：\n\n${input}`;
  }

  if (node.kind === "role-agent") {
    const role = node.data.roleId ? getRole(node.data.roleId) : undefined;
    const roleName = role?.name ?? node.data.label;
    return [
      `## ${roleName}产出`,
      "",
      `职责：${role?.responsibility ?? "根据节点提示完成任务。"}`,
      `节点任务：${node.data.prompt ?? "处理上游输入。"}`,
      "",
      "上游摘要：",
      summarize(input),
      "",
      "下一步建议：",
      "- 明确交付物。",
      "- 补齐风险和验收标准。",
      "- 将结果交回项目角色汇总。"
    ].join("\n");
  }

  if (node.kind === "merge") {
    return [`## 汇总结果`, "", input, "", "项目角色可基于以上内容形成最终交付物。"].join("\n");
  }

  if (node.kind === "artifact-output") {
    return [`## 产出物`, "", "已生成可保存的项目协作结果。", "", input].join("\n");
  }

  return `${node.data.label} 已处理：\n\n${summarize(input)}`;
}

function summarize(input: string): string {
  return input.length > 420 ? `${input.slice(0, 420)}...` : input;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
