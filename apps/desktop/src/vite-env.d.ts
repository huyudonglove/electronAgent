/// <reference types="vite/client" />

import type { WorkbenchApi } from "../electron/preload";

declare global {
  interface Window {
    readonly workbench: WorkbenchApi;
  }
}
