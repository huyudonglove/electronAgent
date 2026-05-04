import fs from "node:fs";
import path from "node:path";

interface LocalSecrets {
  readonly mimoApiKey?: string;
}

export function getMimoApiKey(): string | undefined {
  return readLocalSecrets().mimoApiKey || process.env.MIMO_API_KEY;
}

function readLocalSecrets(): LocalSecrets {
  const secretsPath = findSecretsPath();
  if (!fs.existsSync(secretsPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(secretsPath, "utf8");
    return JSON.parse(raw) as LocalSecrets;
  } catch {
    return {};
  }
}

function findSecretsPath(): string {
  let currentDir = process.cwd();

  while (true) {
    const candidate = path.join(currentDir, "config", "secrets.local.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return path.resolve(process.cwd(), "config", "secrets.local.json");
    }

    currentDir = parentDir;
  }
}
