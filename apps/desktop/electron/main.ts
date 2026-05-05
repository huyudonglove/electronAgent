import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listModelProfiles,
  listProviderDebugLogs,
  sendChatMessage,
  streamChatMessage
} from "@xiaomi/core";
import type { ChatRequest } from "@xiaomi/shared";

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

process.env.APP_ROOT = path.join(currentDir, "..");

const viteDevServerUrl = process.env.VITE_DEV_SERVER_URL;
const rendererDist = path.join(process.env.APP_ROOT, "dist");
const preloadPath = path.join(currentDir, "preload.cjs");

let mainWindow: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: "XiaoMi Agent Workbench",
    width: 1380,
    height: 880,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: "#f6f3ee",
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false
    }
  });

  if (viteDevServerUrl) {
    await mainWindow.loadURL(viteDevServerUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(rendererDist, "index.html"));
  }
}

app.whenReady().then(async () => {
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
      event.sender.send("workbench:chat-stream-event", streamEvent);
    });
  });

  ipcMain.handle("workbench:list-provider-debug-logs", () => {
    return listProviderDebugLogs();
  });
}
