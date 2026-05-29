import path from "node:path";
import type {
  HistoryImporter,
  RawHistoryMessage,
  RawHistorySession,
} from "../types.ts";
import {
  dedupeMessages,
  homePath,
  isRecord,
  makeMessage,
  readJsonl,
  textFromContent,
  titleFrom,
  walkFiles,
} from "./common.ts";

export const codexImporter: HistoryImporter = {
  id: "codex",
  displayName: "Codex",
  async capture(projectRoot) {
    const codexHome = process.env.CODEX_HOME ?? homePath(".codex");
    const sessionFiles = [
      ...(await walkFiles(path.join(codexHome, "sessions"), (filePath) =>
        filePath.endsWith(".jsonl"),
      )),
      ...(await walkFiles(
        path.join(codexHome, "archived_sessions"),
        (filePath) => filePath.endsWith(".jsonl"),
      )),
    ];
    const titleById = await loadCodexTitles(codexHome);
    const sessions: RawHistorySession[] = [];

    for (const filePath of sessionFiles) {
      const events = await readJsonl(filePath);
      const meta = events.find(isCodexMeta);

      if (meta?.payload.cwd !== projectRoot) {
        continue;
      }

      if (isPokoCodexImport(meta) || isCodexSubagentSession(meta)) {
        continue;
      }

      const messages = dedupeAdjacentMessages(
        dedupeMessages(events.flatMap(extractCodexMessage)),
      );
      const id = meta.payload.id;

      sessions.push({
        schemaVersion: 1,
        id,
        sourceAgent: "codex",
        title: titleById.get(id) ?? titleFrom("Codex session", messages),
        projectRoot,
        createdAt: meta.payload.timestamp,
        updatedAt: latestTimestamp(messages) ?? meta.payload.timestamp,
        sourcePath: filePath,
        messages,
        rawEvents: messages.map((message) => message.raw),
      });
    }

    return sessions;
  },
};

const loadCodexTitles = async (
  codexHome: string,
): Promise<Map<string, string>> => {
  const rows = await readJsonl(path.join(codexHome, "session_index.jsonl"));
  const titles = new Map<string, string>();

  for (const row of rows) {
    if (
      isRecord(row) &&
      typeof row.id === "string" &&
      typeof row.thread_name === "string"
    ) {
      titles.set(row.id, row.thread_name);
    }
  }

  return titles;
};

const extractCodexMessage = (event: unknown): RawHistoryMessage[] => {
  if (!isRecord(event)) {
    return [];
  }

  const timestamp =
    typeof event.timestamp === "string" ? event.timestamp : undefined;

  if (event.type === "event_msg" && isRecord(event.payload)) {
    const payload = event.payload;
    const text = typeof payload.message === "string" ? payload.message : "";

    if (isInternalCodexText(text)) {
      return [];
    }

    if (payload.type === "user_message") {
      return compact([makeMessage("user", text, timestamp, event)]);
    }

    if (payload.type === "agent_message") {
      return compact([makeMessage("assistant", text, timestamp, event)]);
    }
  }

  if (event.type === "response_item" && isRecord(event.payload)) {
    const payload = event.payload;

    if (payload.type === "message") {
      if (payload.role !== "user" && payload.role !== "assistant") {
        return [];
      }

      const text = textFromContent(payload.content);

      if (isInternalCodexText(text)) {
        return [];
      }

      return compact([makeMessage(payload.role, text, timestamp, event)]);
    }
  }

  return [];
};

const isCodexMeta = (
  event: unknown,
): event is {
  type: "session_meta";
  payload: {
    id: string;
    timestamp: string;
    cwd: string;
    originator?: string;
    cli_version?: string;
    thread_source?: string;
    source?: unknown;
  };
} =>
  isRecord(event) &&
  event.type === "session_meta" &&
  isRecord(event.payload) &&
  typeof event.payload.id === "string" &&
  typeof event.payload.timestamp === "string" &&
  typeof event.payload.cwd === "string";

const isPokoCodexImport = (event: {
  payload: { originator?: string; cli_version?: string };
}): boolean =>
  event.payload.originator === "poko" ||
  event.payload.cli_version === "poko-import";

const isCodexSubagentSession = (event: {
  payload: { thread_source?: string; source?: unknown };
}): boolean =>
  event.payload.thread_source === "subagent" ||
  (isRecord(event.payload.source) && isRecord(event.payload.source.subagent));

const dedupeAdjacentMessages = (
  messages: RawHistoryMessage[],
): RawHistoryMessage[] => {
  const unique: RawHistoryMessage[] = [];

  for (const message of messages) {
    const previous = unique.at(-1);

    if (
      previous &&
      previous.role === message.role &&
      normalizeText(previous.text) === normalizeText(message.text)
    ) {
      continue;
    }

    unique.push(message);
  }

  return unique;
};

const normalizeText = (value: string): string =>
  value.trim().replace(/\s+/g, " ");

const isInternalCodexText = (value: string): boolean => {
  const trimmed = value.trimStart();

  return (
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<permissions instructions>") ||
    trimmed.startsWith("<app-context>") ||
    trimmed.startsWith("<skills_instructions>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("<turn_aborted>")
  );
};

const latestTimestamp = (messages: RawHistoryMessage[]): string | undefined =>
  messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(-1);

const compact = <T>(values: (T | undefined)[]): T[] =>
  values.filter((value): value is T => value !== undefined);
