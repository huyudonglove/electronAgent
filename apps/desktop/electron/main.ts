import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getEnvironmentFingerprint,
  getMemoryPanelData,
  getModelRuntimeSettings,
  listRuntimeLogs,
  listModelProfiles,
  listProviderDebugLogs,
  listSessionEvents,
  saveModelRuntimeSettings,
  sendChatMessage,
  streamChatMessage
} from "@xiaomi/core";
import type { ChatRequest, ModelRuntimeSettings } from "@xiaomi/shared";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

process.env.APP_ROOT = path.join(currentDir, "..");

const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;
const rendererDist = path.join(process.env.APP_ROOT, "dist");
const preloadPath = path.join(currentDir, "preload.cjs");
const shouldOpenDevTools = process.env.OPEN_DEVTOOLS === "true";

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: "huydAgent",
    width: 1380,
    height: 880,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#0f1316",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  if (viteDevServerUrl) {
    await mainWindow.loadURL(viteDevServerUrl);
    if (shouldOpenDevTools) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    await mainWindow.loadFile(path.join(rendererDist, "index.html"));
  }
}

app.whenReady().then(async () => {
  process.env.APP_USER_DATA = app.getPath("userData");
  registerIpcHandlers();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function registerIpcHandlers(): void {
  ipcMain.handle("workbench:get-initial-state", () => ({
    modelProfiles: listModelProfiles()
  }));

  ipcMain.handle("workbench:send-chat-message", async (_event, request: ChatRequest) => {
    return sendChatMessage(request);
  });

  ipcMain.handle("workbench:stream-chat-message", async (event, request: ChatRequest) => {
    await streamChatMessage(request, (streamEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("workbench:chat-stream-event", streamEvent);
      }
    });
    return { ok: true };
  });

  ipcMain.handle("workbench:list-provider-debug-logs", () => {
    return listProviderDebugLogs();
  });

  ipcMain.handle("workbench:list-runtime-logs", (_event, request?: { projectId?: string; sessionId?: string; limit?: number }) => {
    return listRuntimeLogs(request);
  });

  ipcMain.handle("workbench:list-session-events", (_event, request: { projectId: string; sessionId: string }) => {
    return listSessionEvents({
      projectId: request.projectId,
      sessionId: request.sessionId,
      limit: 100
    });
  });

  ipcMain.handle("workbench:get-memory-panel-data", (_event, request: { projectId: string; sessionId?: string }) => {
    return getMemoryPanelData({
      projectId: request.projectId,
      sessionId: request.sessionId
    });
  });

  ipcMain.handle("workbench:get-environment-fingerprint", () => {
    return getEnvironmentFingerprint();
  });

  ipcMain.handle("workbench:get-model-runtime-settings", () => {
    return getModelRuntimeSettings();
  });

  ipcMain.handle("workbench:save-model-runtime-settings", (_event, settings: ModelRuntimeSettings) => {
    return saveModelRuntimeSettings(settings);
  });
}
