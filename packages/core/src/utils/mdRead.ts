import fs from "node:fs";
import path from "node:path";

const ROOT_MARKERS = ["pnpm-workspace.yaml", "package.json"] as const;

export function readMarkdown(filePath: string, fallback = ""): string {
  const markdownPath = resolveMarkdownPath(filePath);

  if (!markdownPath) {
    return fallback;
  }

  try {
    return fs.readFileSync(markdownPath, "utf8");
  } catch {
    return fallback;
  }
}

export function readMarkdownFiles(filePaths: readonly string[], fallback = ""): string {
  const content = filePaths
    .map((filePath) => readMarkdown(filePath))
    .filter((item) => item.trim().length > 0)
    .join("\n\n");

  return content || fallback;
}

function resolveMarkdownPath(filePath: string): string | undefined {
  if (path.isAbsolute(filePath)) {
    return fs.existsSync(filePath) ? filePath : undefined;
  }

  const rootDir = findProjectRoot();
  const normalizedPath = normalizeRelativePath(filePath);
  const candidatePaths = new Set<string>();

  candidatePaths.add(path.resolve(process.cwd(), filePath));

  if (rootDir) {
    candidatePaths.add(path.resolve(rootDir, filePath));
    candidatePaths.add(path.resolve(rootDir, normalizedPath));
    candidatePaths.add(path.resolve(rootDir, "packages", normalizedPath));
  }

  for (const candidatePath of candidatePaths) {
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^(\.\.\/)+/, "").replace(/^(\.\/)+/, "");
}

function findProjectRoot(): string | undefined {
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
