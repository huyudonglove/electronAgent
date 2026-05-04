import { useEffect, useState } from "react";
import type { ModelProfile, WorkflowDefinition, WorkflowRun } from "@xiaomi/shared";
import { MinimalChatPage } from "./MinimalChatPage";

export function App(): JSX.Element {
  const [modelProfiles, setModelProfiles] = useState<readonly ModelProfile[]>([]);
  const [workflow, setWorkflow] = useState<WorkflowDefinition | null>(null);
  const [run, setRun] = useState<WorkflowRun | null>(null);

  useEffect(() => {
    window.workbench.getInitialState().then((state) => {
      setModelProfiles(state.modelProfiles);
      setWorkflow(state.workflow);
    }).catch(() => {
      setModelProfiles([]);
      setWorkflow(null);
    });
  }, []);

  return <MinimalChatPage modelProfiles={modelProfiles} workflow={workflow} latestRun={run} />;
}
