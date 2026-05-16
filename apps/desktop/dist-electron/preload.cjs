"use strict";
const electron = require("electron");
const api = {
  getInitialState: () => electron.ipcRenderer.invoke("workbench:get-initial-state"),
  sendChatMessage: (request) => electron.ipcRenderer.invoke("workbench:send-chat-message", request),
  streamChatMessage: (request) => electron.ipcRenderer.invoke("workbench:stream-chat-message", request),
  onChatStreamEvent: (handler) => {
    const listener = (_event, streamEvent) => {
      handler(streamEvent);
    };
    electron.ipcRenderer.on("workbench:chat-stream-event", listener);
    return () => {
      electron.ipcRenderer.removeListener("workbench:chat-stream-event", listener);
    };
  },
  listProviderDebugLogs: () => electron.ipcRenderer.invoke("workbench:list-provider-debug-logs"),
  listSessionEvents: (request) => electron.ipcRenderer.invoke("workbench:list-session-events", request),
  getModelRuntimeSettings: () => electron.ipcRenderer.invoke("workbench:get-model-runtime-settings"),
  saveModelRuntimeSettings: (settings) => electron.ipcRenderer.invoke("workbench:save-model-runtime-settings", settings)
};
electron.contextBridge.exposeInMainWorld("workbench", api);
