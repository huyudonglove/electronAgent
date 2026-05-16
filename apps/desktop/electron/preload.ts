import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentEventRecord,
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
  ModelRuntimeSettings,
  ModelProfile,
  ProviderDebugLog,
} from "@xiaomi/shared";

export interface WorkbenchInitialState {
  readonly modelProfiles: readonly ModelProfile[];
}

export interface WorkbenchApi {
  readonly getInitialState: () => Promise<WorkbenchInitialState>;
  readonly sendChatMessage: (request: ChatRequest) => Promise<ChatResponse>;
  readonly streamChatMessage: (request: ChatRequest) => Promise<void>;
  readonly onChatStreamEvent: (handler: (event: ChatStreamEvent) => void) => () => void;
  readonly listProviderDebugLogs: () => Promise<readonly ProviderDebugLog[]>;
  readonly listSessionEvents: (request: {
    readonly projectId: string;
    readonly sessionId: string;
  }) => Promise<readonly AgentEventRecord[]>;
  readonly getModelRuntimeSettings: () => Promise<ModelRuntimeSettings>;
  readonly saveModelRuntimeSettings: (settings: ModelRuntimeSettings) => Promise<ModelRuntimeSettings>;
}

const api: WorkbenchApi = {
  getInitialState: () => ipcRenderer.invoke("workbench:get-initial-state"),
  sendChatMessage: (request: ChatRequest) => ipcRenderer.invoke("workbench:send-chat-message", request),
  streamChatMessage: (request: ChatRequest) => ipcRenderer.invoke("workbench:stream-chat-message", request),
  onChatStreamEvent: (handler: (event: ChatStreamEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, streamEvent: ChatStreamEvent) => {
      handler(streamEvent);
    };
    ipcRenderer.on("workbench:chat-stream-event", listener);
    return () => {
      ipcRenderer.removeListener("workbench:chat-stream-event", listener);
    };
  },
  listProviderDebugLogs: () => ipcRenderer.invoke("workbench:list-provider-debug-logs"),
  listSessionEvents: (request) => ipcRenderer.invoke("workbench:list-session-events", request),
  getModelRuntimeSettings: () => ipcRenderer.invoke("workbench:get-model-runtime-settings"),
  saveModelRuntimeSettings: (settings) => ipcRenderer.invoke("workbench:save-model-runtime-settings", settings)
};

contextBridge.exposeInMainWorld("workbench", api);
