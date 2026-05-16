import fs from "node:fs";
import path from "node:path";

const ROOT_MARKERS = ["pnpm-workspace.yaml", "package.json"] as const;

export function findProjectRoot(): string | undefined {
  let currentDir = process.cwd();

  while (true) {
    if (ROOT_MARKERS.every((marker) => fs.existsSync(path.join(currentDir, marker)))) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return undefined;
    }

    currentDir = parentDir;
  }
}

export function resolveProjectPath(...parts: readonly string[]): string {
  return path.resolve(findProjectRoot() ?? process.cwd(), ...parts);
}
