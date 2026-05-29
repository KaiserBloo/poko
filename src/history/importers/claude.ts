import { realpath } from "node:fs/promises";
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

export const claudeImporter: HistoryImporter = {
  id: "claude",
  displayName: "Claude Code",
  async capture(projectRoot) {
    const canonicalProjectRoot = await resolveCanonicalProjectRoot(projectRoot);
    const claudeHome =
      process.env.CLAUDE_CONFIG_DIR ??
      process.env.CLAUDE_HOME ??
      homePath(".claude");
    const projectsDir = path.join(claudeHome, "projects");
    const encoded = encodeClaudeProjectPath(canonicalProjectRoot);
    const preferredDir = path.join(projectsDir, encoded);
    const files = await walkFiles(preferredDir, (filePath) =>
      filePath.endsWith(".jsonl"),
    );
    const fallbackFiles =
      files.length > 0
        ? []
        : await walkFiles(projectsDir, (filePath) =>
            filePath.endsWith(".jsonl"),
          );

    return captureClaudeFiles(
      projectRoot,
      [projectRoot, canonicalProjectRoot],
      [...files, ...fallbackFiles],
    );
  },
};

const captureClaudeFiles = async (
  projectRoot: string,
  acceptedProjectRoots: string[],
  files: string[],
): Promise<RawHistorySession[]> => {
  const sessions = new Map<string, RawHistorySession>();
  const acceptedRootSet = new Set(acceptedProjectRoots);

  for (const filePath of files) {
    const rows = await readJsonl(filePath);
    const matchingRows = rows.filter(
      (row) =>
        isRecord(row) &&
        typeof row.cwd === "string" &&
        acceptedRootSet.has(row.cwd) &&
        typeof row.sessionId === "string",
    );

    if (matchingRows.length === 0) {
      continue;
    }

    if (matchingRows.some(isPokoClaudeImportRow)) {
      continue;
    }

    const sessionId = String(
      (matchingRows[0] as { sessionId: string }).sessionId,
    );
    const messages = dedupeMessages(matchingRows.flatMap(extractClaudeMessage));

    sessions.set(sessionId, {
      schemaVersion: 1,
      id: sessionId,
      sourceAgent: "claude",
      title: titleFrom("Claude Code session", messages),
      projectRoot,
      createdAt: firstTimestamp(messages),
      updatedAt: latestTimestamp(messages),
      sourcePath: filePath,
      messages,
      rawEvents: messages.map((message) => message.raw),
    });
  }

  return [...sessions.values()];
};

const extractClaudeMessage = (row: unknown): RawHistoryMessage[] => {
  if (!isRecord(row) || !isRecord(row.message)) {
    return [];
  }

  const type = row.type;
  const timestamp =
    typeof row.timestamp === "string" ? row.timestamp : undefined;
  const id = typeof row.uuid === "string" ? row.uuid : undefined;
  const message = row.message;

  if (type === "user") {
    return compact([
      makeMessage("user", textFromContent(message.content), timestamp, row, id),
    ]);
  }

  if (type === "assistant") {
    return compact([
      makeMessage(
        "assistant",
        textFromContent(message.content),
        timestamp,
        row,
        id,
      ),
    ]);
  }

  return [];
};

const isPokoClaudeImportRow = (row: unknown): boolean =>
  isRecord(row) && row.version === "poko-import";

const encodeClaudeProjectPath = (projectRoot: string): string =>
  projectRoot.normalize("NFC").replace(/[^a-zA-Z0-9]/g, "-");

const resolveCanonicalProjectRoot = async (
  projectRoot: string,
): Promise<string> => {
  try {
    return (await realpath(projectRoot)).normalize("NFC");
  } catch {
    return path.resolve(projectRoot).normalize("NFC");
  }
};

const firstTimestamp = (messages: RawHistoryMessage[]): string | undefined =>
  messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(0);

const latestTimestamp = (messages: RawHistoryMessage[]): string | undefined =>
  messages
    .map((message) => message.timestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort()
    .at(-1);

const compact = <T>(values: (T | undefined)[]): T[] =>
  values.filter((value): value is T => value !== undefined);
