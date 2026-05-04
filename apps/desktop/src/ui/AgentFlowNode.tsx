import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Box, CheckCircle2, GitMerge, Play, UserRoundCog } from "lucide-react";
import type { FlowNodeData } from "./workflowViewModel";

const iconMap = {
  start: Play,
  "role-agent": UserRoundCog,
  merge: GitMerge,
  "artifact-output": CheckCircle2
};

export function AgentFlowNode({ data }: NodeProps): JSX.Element {
  const typedData = data as FlowNodeData;
  const Icon = iconMap[typedData.kind as keyof typeof iconMap] ?? Box;

  return (
    <div className="flow-node">
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="flow-node__top">
        <span className="flow-node__icon">
          <Icon size={16} />
        </span>
        <span className="flow-node__kind">{formatKind(typedData.kind)}</span>
      </div>
      <div className="flow-node__label">{typedData.label}</div>
      {typedData.roleName ? <div className="flow-node__role">{typedData.roleName}</div> : null}
      {typedData.description ? <div className="flow-node__description">{typedData.description}</div> : null}
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

function formatKind(kind: string): string {
  switch (kind) {
    case "role-agent":
      return "Role Agent";
    case "artifact-output":
      return "Artifact";
    default:
      return kind;
  }
}
