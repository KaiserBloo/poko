import path from "node:path";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  appendJsonLineIfMissing,
  conversationMessages,
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  deterministicUuid,
  homePath,
  messageDate,
  nativeTargetSessions,
  renderJsonl,
  resolveRealProjectRoot,
  sessionCreatedDate,
  sessionUpdatedDate,
  truncate,
  writeAtomic,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

export const codexNativeSyncer: NativeHistorySyncer = {
  id: "codex",
  sync: syncCodexNativeHistory,
};

export async function syncCodexNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const codexHome = resolveCodexHome();
  const sessionsRoot = path.join(codexHome, "sessions");
  const sessions = nativeTargetSessions(options.sessions, "codex");
  const messageCount = countConversationMessages(sessions);
  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());

  if (options.dryRun) {
    return {
      target: "codex",
      location: sessionsRoot,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        rolloutsWritten: sessions.length,
        titlesIndexed: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "codex",
        ),
      },
    };
  }

  const projectRoot = await resolveRealProjectRoot(options.root);
  let rolloutsWritten = 0;
  let titlesIndexed = 0;

  for (const session of sessions) {
    const created = sessionCreatedDate(session, fallbackDate);
    const sessionId = codexSessionId(session);
    const rolloutPath = codexRolloutPath(sessionsRoot, created, sessionId);

    await writeAtomic(
      rolloutPath,
      renderCodexRollout(session, sessionId, projectRoot, created),
    );
    rolloutsWritten += 1;

    const indexed = await appendJsonLineIfMissing(
      path.join(codexHome, "session_index.jsonl"),
      {
        id: sessionId,
        thread_name: truncate(session.title || "Poko import", 80),
        updated_at: sessionUpdatedDate(session, created).toISOString(),
      },
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "id" in row &&
        row.id === sessionId,
    );

    if (indexed) {
      titlesIndexed += 1;
    }
  }

  return {
    target: "codex",
    location: sessionsRoot,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      rolloutsWritten,
      titlesIndexed,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "codex",
      ),
    },
  };
}

const resolveCodexHome = (): string =>
  process.env.CODEX_HOME ?? homePath(".codex");

const codexSessionId = (session: RawHistorySession): string =>
  deterministicUuid(`poko:codex:session:${session.sourceAgent}:${session.id}`);

const codexRolloutPath = (
  sessionsRoot: string,
  created: Date,
  sessionId: string,
): string =>
  path.join(
    sessionsRoot,
    String(created.getFullYear()),
    pad(created.getMonth() + 1),
    pad(created.getDate()),
    `rollout-${rolloutTimestamp(created)}-${sessionId}.jsonl`,
  );

const renderCodexRollout = (
  session: RawHistorySession,
  sessionId: string,
  projectRoot: string,
  created: Date,
): string => {
  const rows: unknown[] = [
    {
      timestamp: created.toISOString(),
      type: "session_meta",
      payload: {
        id: sessionId,
        timestamp: created.toISOString(),
        cwd: projectRoot,
        originator: "poko",
        cli_version: "poko-import",
        source: "cli",
        thread_source: "user",
        model_provider: null,
        base_instructions: null,
        memory_mode: "disabled",
      },
    },
  ];

  for (const message of conversationMessages(session)) {
    const timestamp = messageDate(message, created).toISOString();
    rows.push(renderCodexResponseItem(message, timestamp));
    rows.push(renderCodexPreviewEvent(message, timestamp));
  }

  return renderJsonl(rows);
};

const renderCodexResponseItem = (
  message: RawHistoryMessage,
  timestamp: string,
): unknown => ({
  timestamp,
  type: "response_item",
  payload: {
    type: "message",
    role: message.role,
    content: [
      {
        type: message.role === "user" ? "input_text" : "output_text",
        text: message.text,
      },
    ],
  },
});

const renderCodexPreviewEvent = (
  message: RawHistoryMessage,
  timestamp: string,
): unknown => ({
  timestamp,
  type: "event_msg",
  payload: {
    type: message.role === "user" ? "user_message" : "agent_message",
    message: message.text,
  },
});

const rolloutTimestamp = (date: Date): string =>
  [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
      date.getSeconds(),
    )}`,
  ].join("T");

const pad = (value: number): string => String(value).padStart(2, "0");
