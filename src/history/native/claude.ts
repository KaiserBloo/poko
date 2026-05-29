import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
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
  truncate,
  writeAtomic,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

export const claudeNativeSyncer: NativeHistorySyncer = {
  id: "claude",
  sync: syncClaudeNativeHistory,
};

export async function syncClaudeNativeHistory(
  options: NativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const claudeHome = resolveClaudeHome();
  const projectRoot = await resolveRealProjectRoot(options.root);
  const projectDir = path.join(
    claudeHome,
    "projects",
    encodeClaudeProjectPath(projectRoot),
  );
  const sessions = nativeTargetSessions(options.sessions, "claude");
  const messageCount = countConversationMessages(sessions);

  if (options.dryRun) {
    return {
      target: "claude",
      location: projectDir,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        sessionFilesWritten: sessions.length,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "claude",
        ),
      },
    };
  }

  const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
  let sessionFilesWritten = 0;
  const desiredSessionIds = new Set<string>();

  for (const session of sessions) {
    const sessionId = claudeSessionId(session);
    desiredSessionIds.add(sessionId);
    await writeAtomic(
      path.join(projectDir, `${sessionId}.jsonl`),
      renderClaudeSession(session, sessionId, projectRoot, fallbackDate),
    );
    sessionFilesWritten += 1;
  }

  const staleSessionFilesRemoved = await cleanupStalePokoClaudeImports(
    projectDir,
    desiredSessionIds,
  );

  return {
    target: "claude",
    location: projectDir,
    sessions: sessions.length,
    messages: messageCount,
    dryRun: false,
    skipped: false,
    details: {
      sessionFilesWritten,
      staleSessionFilesRemoved,
      sessionsSkippedFromSameAgent: countSameAgentSessions(
        options.sessions,
        "claude",
      ),
    },
  };
}

const resolveClaudeHome = (): string =>
  process.env.CLAUDE_CONFIG_DIR ??
  process.env.CLAUDE_HOME ??
  homePath(".claude");

export const encodeClaudeProjectPath = (projectRoot: string): string =>
  projectRoot.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");

const claudeSessionId = (session: RawHistorySession): string =>
  deterministicUuid(`poko:claude:session:${session.sourceAgent}:${session.id}`);

const renderClaudeSession = (
  session: RawHistorySession,
  sessionId: string,
  projectRoot: string,
  fallbackDate: Date,
): string => {
  const created = sessionCreatedDate(session, fallbackDate);
  const rows: unknown[] = [
    {
      type: "custom-title",
      customTitle: truncate(session.title || "Conversation", 80),
      sessionId,
      timestamp: created.toISOString(),
    },
  ];
  let parentUuid: string | null = null;

  for (const [index, message] of conversationMessages(session).entries()) {
    const uuid = deterministicUuid(
      `poko:claude:message:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
    );
    const timestamp = messageDate(message, created).toISOString();
    rows.push(
      renderClaudeMessage({
        sessionId,
        uuid,
        parentUuid,
        message,
        timestamp,
        projectRoot,
      }),
    );
    parentUuid = uuid;
  }

  const lastUserMessage = [...conversationMessages(session)]
    .reverse()
    .find((message) => message.role === "user");

  if (lastUserMessage) {
    rows.push({
      type: "last-prompt",
      lastPrompt: truncate(lastUserMessage.text.split("\n")[0] ?? "", 160),
      sessionId,
      timestamp: messageDate(lastUserMessage, created).toISOString(),
    });
  }

  return renderJsonl(rows);
};

const renderClaudeMessage = (input: {
  sessionId: string;
  uuid: string;
  parentUuid: string | null;
  message: RawHistoryMessage;
  timestamp: string;
  projectRoot: string;
}): unknown => {
  const common = {
    parentUuid: input.parentUuid,
    isSidechain: false,
    uuid: input.uuid,
    timestamp: input.timestamp,
    userType: "external",
    entrypoint: "cli",
    cwd: input.projectRoot,
    sessionId: input.sessionId,
    version: "poko-import",
    gitBranch: "main",
  };

  if (input.message.role === "user") {
    return {
      ...common,
      type: "user",
      message: {
        role: "user",
        content: input.message.text,
      },
    };
  }

  return {
    ...common,
    type: "assistant",
    message: {
      id: `msg_${input.uuid.replaceAll("-", "")}`,
      type: "message",
      role: "assistant",
      model: "poko-import",
      content: [{ type: "text", text: input.message.text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
    requestId: null,
  };
};

const cleanupStalePokoClaudeImports = async (
  projectDir: string,
  desiredSessionIds: Set<string>,
): Promise<number> => {
  let entries: Array<{ isFile(): boolean; name: string }>;

  try {
    entries = await readdir(projectDir, { withFileTypes: true });
  } catch {
    return 0;
  }

  let removed = 0;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }

    const sessionId = entry.name.replace(/\.jsonl$/, "");

    if (desiredSessionIds.has(sessionId)) {
      continue;
    }

    const filePath = path.join(projectDir, entry.name);

    if (!(await isPokoClaudeImportFile(filePath))) {
      continue;
    }

    await rm(filePath, { force: true });
    removed += 1;
  }

  return removed;
};

const isPokoClaudeImportFile = async (filePath: string): Promise<boolean> => {
  try {
    const rows = (await readFile(filePath, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as unknown);

    return rows.some(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        "version" in row &&
        row.version === "poko-import",
    );
  } catch {
    return false;
  }
};
