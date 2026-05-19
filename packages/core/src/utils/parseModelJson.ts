export function parseModelJson<T>(content: string, label: string): T {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error(`${label} 返回空内容，期望一个 JSON 对象。`);
  }

  const candidate = extractJsonCandidate(trimmed);
  const normalized = normalizeLooseJson(candidate);

  try {
    return JSON.parse(normalized) as T;
  } catch (error) {
    const repaired = normalizeLooseJson(repairLooseJson(normalized));
    if (repaired !== normalized) {
      try {
        return JSON.parse(repaired) as T;
      } catch {
        // Fall through to the clearer error below.
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${label} 返回的 JSON 无法解析：${message}\n原始内容：${compactText(trimmed, 280)}\n出错附近：${extractErrorSnippet(normalized, message)}`
    );
  }
}

function extractJsonCandidate(value: string): string {
  const withoutFence = stripMarkdownCodeFence(value);
  const objectCandidate = sliceBalancedObject(withoutFence);
  return objectCandidate ?? withoutFence;
}

function stripMarkdownCodeFence(value: string): string {
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() || value;
}

function sliceBalancedObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) {
    return undefined;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = true;
        continue;
      }

      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return undefined;
}

function repairInvalidJsonStringEscapes(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      result += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      if (isValidJsonEscape(char)) {
        result += char;
      } else {
        result += `\\${char}`;
      }
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += "\\";
      escaped = true;
      continue;
    }

    result += char;
    if (char === "\"") {
      inString = false;
    }
  }

  return result;
}

function normalizeLooseJson(value: string): string {
  return removeTrailingCommas(value);
}

function repairLooseJson(value: string): string {
  return repairUnescapedInnerQuotes(repairInvalidJsonStringEscapes(value));
}

function removeTrailingCommas(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      result += char;
      continue;
    }

    if (char === ",") {
      const nextNonWhitespace = findNextNonWhitespace(value, index + 1);
      if (nextNonWhitespace === "}" || nextNonWhitespace === "]") {
        continue;
      }
    }

    result += char;
  }

  return result;
}

function repairUnescapedInnerQuotes(value: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (!inString) {
      result += char;
      if (char === "\"") {
        inString = true;
      }
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      if (isLikelyStringTerminator(value, index)) {
        result += char;
        inString = false;
      } else {
        result += "\\\"";
      }
      continue;
    }

    result += char;
  }

  return result;
}

function isLikelyStringTerminator(value: string, quoteIndex: number): boolean {
  const nextNonWhitespace = findNextNonWhitespace(value, quoteIndex + 1);
  return nextNonWhitespace === "," || nextNonWhitespace === "}" || nextNonWhitespace === "]" || nextNonWhitespace === ":";
}

function isValidJsonEscape(char: string): boolean {
  return char === "\"" || char === "\\" || char === "/" || char === "b" || char === "f" || char === "n" || char === "r" || char === "t" || char === "u";
}

function findNextNonWhitespace(value: string, start: number): string {
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (!/\s/.test(char)) {
      return char;
    }
  }

  return "";
}

function extractErrorSnippet(value: string, message: string): string {
  const match = message.match(/position\s+(\d+)/i);
  const position = match ? Number.parseInt(match[1] ?? "", 10) : Number.NaN;
  if (!Number.isFinite(position)) {
    return compactText(value, 160);
  }

  const start = Math.max(0, position - 80);
  const end = Math.min(value.length, position + 80);
  return value.slice(start, end).replace(/\s+/g, " ").trim();
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, " ").trim();
  return compacted.length > maxLength ? `${compacted.slice(0, maxLength - 1)}...` : compacted;
}
