import { contextBridge, ipcRenderer } from "electron";
import type { ChatRequest, ChatResponse, ModelProfile, ProviderDebugLog, RoleDefinition, WorkflowDefinition, WorkflowRun } from "@xiaomi/shared";

export interface WorkbenchInitialState {
  readonly roles: readonly RoleDefinition[];
  readonly workflow: WorkflowDefinition;
  readonly modelProfiles: readonly ModelProfile[];
}

export interface WorkbenchApi {
  readonly getInitialState: () => Promise<WorkbenchInitialState>;
  readonly runWorkflow: (initialInput: string) => Promise<WorkflowRun>;
  readonly sendChatMessage: (request: ChatRequest) => Promise<ChatResponse>;
  readonly listProviderDebugLogs: () => Promise<readonly ProviderDebugLog[]>;
}

const api: WorkbenchApi = {
  getInitialState: () => ipcRenderer.invoke("workbench:get-initial-state"),
  runWorkflow: (initialInput: string) => ipcRenderer.invoke("workbench:run-workflow", initialInput),
  sendChatMessage: (request: ChatRequest) => ipcRenderer.invoke("workbench:send-chat-message", request),
  listProviderDebugLogs: () => ipcRenderer.invoke("workbench:list-provider-debug-logs")
};

contextBridge.exposeInMainWorld("workbench", api);
