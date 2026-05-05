import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatRequest,
  ChatResponse,
  ChatStreamEvent,
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
  listProviderDebugLogs: () => ipcRenderer.invoke("workbench:list-provider-debug-logs")
};

contextBridge.exposeInMainWorld("workbench", api);
