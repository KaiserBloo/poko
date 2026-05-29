import type { RawHistoryMessage } from "../types.ts";

export type NativeToolUse = {
  id?: string;
  name: string;
  input: Record<string, unknown>;
};

export type NativeMessageAnnotations = {
  visibleText: string;
  thinkingText?: string;
  toolResult?: string;
  toolUses: NativeToolUse[];
};

export const nativeMessageAnnotations = (
  message: RawHistoryMessage,
): NativeMessageAnnotations => {
  const rawParts = rawMessageContent(message.raw);
  const rawToolUses = rawParts.flatMap(toolUseFromPart);
  const rawThinking = rawParts
    .map(thinkingTextFromPart)
    .filter((text): text is string => Boolean(text));
  const visibleLines: string[] = [];
  let thinkingText = rawThinking.join("\n") || undefined;
  let toolResult: string | undefined;
  const textToolUses: NativeToolUse[] = [];

  for (const line of message.text.split("\n")) {
    const thinkingMatch = line.match(/^\[thinking\]\s*(.+)$/i);

    if (thinkingMatch?.[1]) {
      thinkingText = appendAnnotationText(thinkingText, thinkingMatch[1]);
      continue;
    }

    const toolResultMatch = line.match(/^Tool result:\s*(.+)$/i);

    if (toolResultMatch?.[1]) {
      toolResult = appendAnnotationText(toolResult, toolResultMatch[1]);
      continue;
    }

    const toolUseMatch = line.match(/^\[(?:tool_use|tool_call):([^\]]+)\]$/i);

    if (toolUseMatch?.[1]) {
      textToolUses.push({
        name: toolUseMatch[1],
        input: {},
      });
      continue;
    }

    visibleLines.push(line);
  }

  return {
    visibleText: visibleLines.join("\n").trim(),
    thinkingText,
    toolResult,
    toolUses: rawToolUses.length > 0 ? rawToolUses : textToolUses,
  };
};

const toolUseFromPart = (part: unknown): NativeToolUse[] => {
  if (
    !isRecord(part) ||
    (part.type !== "tool_use" && part.type !== "toolCall") ||
    typeof part.name !== "string"
  ) {
    return [];
  }

  return [
    {
      id: typeof part.id === "string" ? part.id : undefined,
      name: part.name,
      input: isRecord(part.input) ? part.input : {},
    },
  ];
};

const thinkingTextFromPart = (part: unknown): string | undefined => {
  if (!isRecord(part) || part.type !== "thinking") {
    return undefined;
  }

  if (typeof part.thinking === "string") {
    return part.thinking;
  }

  if (typeof part.text === "string") {
    return part.text;
  }

  return undefined;
};

const rawMessageContent = (raw: unknown): unknown[] => {
  if (!isRecord(raw)) {
    return [];
  }

  if (isRecord(raw.payload) && Array.isArray(raw.payload.content)) {
    return raw.payload.content;
  }

  if (isRecord(raw.message) && Array.isArray(raw.message.content)) {
    return raw.message.content;
  }

  return [];
};

const appendAnnotationText = (
  existing: string | undefined,
  next: string,
): string => (existing ? `${existing}\n${next.trim()}` : next.trim());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
