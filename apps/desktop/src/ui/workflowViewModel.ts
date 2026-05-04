import type { AgentNode, RoleDefinition, WorkflowDefinition, WorkflowEdge } from "@xiaomi/shared";
import type { Edge, Node } from "@xyflow/react";

const positions: Record<string, { x: number; y: number }> = {
  start: { x: 40, y: 170 },
  product: { x: 330, y: 40 },
  architecture: { x: 330, y: 300 },
  development: { x: 650, y: 170 },
  testing: { x: 960, y: 300 },
  merge: { x: 960, y: 40 },
  artifact: { x: 1250, y: 170 }
};

export interface FlowNodeData extends Record<string, unknown> {
  readonly label: string;
  readonly kind: string;
  readonly roleName?: string;
  readonly description?: string;
}

export function toFlowNodes(workflow: WorkflowDefinition, roles: readonly RoleDefinition[]): Node<FlowNodeData>[] {
  return workflow.nodes.map((node) => ({
    id: node.id,
    type: "agentNode",
    position: positions[node.id] ?? { x: 80, y: 80 },
    data: toNodeData(node, roles)
  }));
}

export function toFlowEdges(edges: readonly WorkflowEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.source === "start" || edge.target === "merge",
    style: { strokeWidth: 2, stroke: "#68737d" }
  }));
}

function toNodeData(node: AgentNode, roles: readonly RoleDefinition[]): FlowNodeData {
  const role = node.data.roleId ? roles.find((candidate) => candidate.id === node.data.roleId) : undefined;
  return {
    label: node.data.label,
    kind: node.kind,
    roleName: role?.name,
    description: node.data.prompt ?? node.data.description
  };
}
