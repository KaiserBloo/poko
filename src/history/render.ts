import type { RawHistoryMessage, RawHistorySession } from "./types.ts";

export const renderHandoff = (
  targetAgent: string,
  sessions: RawHistorySession[],
  includeRaw: boolean,
): string => {
  const parts = [
    `# Poko Handoff for ${targetAgent}`,
    "This handoff was generated from captured Poko history. Use it to recover project continuity before making changes.",
    ...sessions.map((session) => renderSession(session, includeRaw)),
  ];

  return `${parts.join("\n\n").trim()}\n`;
};

const renderSession = (
  session: RawHistorySession,
  includeRaw: boolean,
): string => {
  const messages = session.messages
    .map((message) => renderMessage(message, includeRaw))
    .filter(Boolean)
    .join("\n\n");

  return [
    `## ${session.title}`,
    `Source: ${session.sourceAgent}`,
    session.updatedAt ? `Updated: ${session.updatedAt}` : "",
    messages,
  ]
    .filter(Boolean)
    .join("\n\n");
};

const renderMessage = (
  message: RawHistoryMessage,
  includeRaw: boolean,
): string => {
  const text = message.text.trim();

  if (!text) {
    return "";
  }

  if (
    !includeRaw &&
    (message.role === "tool" ||
      message.role === "system" ||
      message.role === "unknown" ||
      isRuntimeInstructionSnapshot(text))
  ) {
    return "";
  }

  return `### ${message.role}${message.timestamp ? ` - ${message.timestamp}` : ""}\n\n${text}`;
};

const RUNTIME_INSTRUCTION_PREFIXES = [
  "<permissions instructions>",
  "<app-context>",
  "<collaboration_mode>",
  "<environment_context>",
  "<skills_instructions>",
  "<plugins_instructions>",
  "<system>",
  "<developer>",
];

const isRuntimeInstructionSnapshot = (text: string): boolean => {
  const trimmed = text.trimStart();

  return RUNTIME_INSTRUCTION_PREFIXES.some((prefix) =>
    trimmed.startsWith(prefix),
  );
};
