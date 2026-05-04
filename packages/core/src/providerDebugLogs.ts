import type { ProviderDebugLog } from "@xiaomi/shared";

const logs: ProviderDebugLog[] = [];

export function addProviderDebugLog(log: ProviderDebugLog): void {
  logs.unshift(log);
  logs.splice(50);
}

export function listProviderDebugLogs(): readonly ProviderDebugLog[] {
  return logs;
}

export function createDebugLogBase(input: Omit<ProviderDebugLog, "id" | "startedAt" | "status">): ProviderDebugLog {
  return {
    ...input,
    id: `provider-log-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "pending",
    startedAt: new Date().toISOString()
  };
}
