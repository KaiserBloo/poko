import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentId } from "../../adapters/types.ts";
import { pathExists } from "../../core/config.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";

export const homePath = (...parts: string[]): string =>
  path.join(os.homedir(), ...parts);

export const deterministicUuid = (value: string): string => {
  const hash = createHash("sha256").update(value).digest("hex").slice(0, 32);
  const chars = hash.split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16,
  );
  const hex = chars.join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
};

export const deterministicHex = (value: string, length = 26): string =>
  createHash("sha256").update(value).digest("hex").slice(0, length);

export const deterministicPrefixedId = (
  prefix: string,
  value: string,
): string => `${prefix}_${deterministicHex(value, 26)}`;

export const isConversationMessage = (message: RawHistoryMessage): boolean =>
  (message.role === "user" || message.role === "assistant") &&
  message.text.trim().length > 0;

export const conversationMessages = (
  session: RawHistorySession,
): RawHistoryMessage[] => session.messages.filter(isConversationMessage);

export const nativeTargetSessions = (
  sessions: RawHistorySession[],
  target: AgentId,
): RawHistorySession[] =>
  sessions
    .filter((session) => session.sourceAgent !== target)
    .filter((session) => conversationMessages(session).length > 0);

export const countConversationMessages = (
  sessions: RawHistorySession[],
): number =>
  sessions.reduce(
    (count, session) => count + conversationMessages(session).length,
    0,
  );

export const countSameAgentSessions = (
  sessions: RawHistorySession[],
  target: AgentId,
): number =>
  sessions.filter(
    (session) =>
      session.sourceAgent === target &&
      conversationMessages(session).length > 0,
  ).length;

export const resolveRealProjectRoot = async (root: string): Promise<string> => {
  try {
    return (await realpath(root)).normalize("NFC");
  } catch {
    return path.resolve(root).normalize("NFC");
  }
};

export const dateFrom = (value: string | undefined, fallback: Date): Date => {
  if (!value) {
    return fallback;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp) : fallback;
};

export const sessionCreatedDate = (
  session: RawHistorySession,
  fallback: Date,
): Date =>
  dateFrom(
    session.createdAt ?? conversationMessages(session)[0]?.timestamp,
    fallback,
  );

export const sessionUpdatedDate = (
  session: RawHistorySession,
  fallback: Date,
): Date =>
  dateFrom(
    session.updatedAt ?? conversationMessages(session).at(-1)?.timestamp,
    fallback,
  );

export const messageDate = (message: RawHistoryMessage, fallback: Date): Date =>
  dateFrom(message.timestamp, fallback);

export const timestampMs = (date: Date, offset = 0): number =>
  Math.max(0, Math.floor(date.getTime()) + offset);

export const truncate = (value: string, length: number): string =>
  value.length > length ? `${value.slice(0, length - 1)}...` : value;

export const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "poko-import";
};

export const writeAtomic = async (
  destination: string,
  content: string,
): Promise<void> => {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );

  await writeFile(temporary, ensureTrailingNewline(content), "utf8");
  await rename(temporary, destination);
};

export const appendJsonLineIfMissing = async (
  filePath: string,
  row: Record<string, unknown>,
  isMatch: (row: unknown) => boolean,
): Promise<boolean> => {
  const existing = await readJsonlIfExists(filePath);

  if (existing.some(isMatch)) {
    return false;
  }

  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(row)}\n`, "utf8");
  return true;
};

export const renderJsonl = (rows: unknown[]): string =>
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

export const readJsonlIfExists = async (
  filePath: string,
): Promise<unknown[]> => {
  if (!(await pathExists(filePath))) {
    return [];
  }

  return (await readFile(filePath, "utf8"))
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as unknown);
};

export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const ensureTrailingNewline = (content: string): string =>
  content.endsWith("\n") ? content : `${content}\n`;
