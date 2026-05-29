import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathExists } from "../core/config.ts";
import type {
  HistoryIndex,
  HistoryIndexEntry,
  HistoryStore,
  RawHistoryMessage,
  RawHistorySession,
} from "./types.ts";

export type HistoryRoot = {
  kind: Exclude<HistoryStore, "both">;
  path: string;
};

export const getHistoryRoots = (
  projectRoot: string,
  store: HistoryStore,
  projectId?: string,
): HistoryRoot[] => {
  const roots: HistoryRoot[] = [];

  if (store === "repo" || store === "both") {
    roots.push({
      kind: "repo",
      path: path.join(projectRoot, ".poko", "history"),
    });
  }

  if (store === "local" || store === "both") {
    roots.push({
      kind: "local",
      path: path.join(
        os.homedir(),
        ".poko",
        "history",
        "projects",
        projectKey(projectRoot, projectId),
      ),
    });
  }

  return roots;
};

export const writeHistorySessions = async (
  projectRoot: string,
  store: HistoryStore,
  sessions: RawHistorySession[],
  projectId?: string,
): Promise<HistoryIndexEntry[]> => {
  const roots = getHistoryRoots(projectRoot, store, projectId);
  const written: HistoryIndexEntry[] = [];

  for (const root of roots) {
    await mkdir(path.join(root.path, "sessions"), { recursive: true });
    const index = await readIndex(root.path, projectRoot);
    const entries = new Map(
      index.sessions.map((entry) => [
        `${entry.sourceAgent}:${entry.id}`,
        entry,
      ]),
    );

    for (const session of sessions) {
      const relativePath = sessionFilePath(session);
      const destination = path.join(root.path, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeAtomic(destination, renderSessionJsonl(session));

      const entry: HistoryIndexEntry = {
        id: session.id,
        projectId: session.projectId,
        sourceAgent: session.sourceAgent,
        title: session.title,
        projectRoot,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        path: relativePath,
      };
      entries.set(`${entry.sourceAgent}:${entry.id}`, entry);
      written.push(entry);
    }

    await writeIndex(root.path, {
      schemaVersion: 1,
      projectId: projectId || undefined,
      projectRoot,
      updatedAt: new Date().toISOString(),
      sessions: [...entries.values()].sort(compareEntries),
    });
  }

  return written;
};

export const loadHistoryIndex = async (
  projectRoot: string,
  store: HistoryStore,
  projectId?: string,
): Promise<HistoryIndexEntry[]> => {
  const roots = getHistoryRoots(projectRoot, store, projectId);
  const entries = new Map<string, HistoryIndexEntry>();

  for (const root of roots) {
    const index = await readIndex(root.path, projectRoot);

    for (const entry of index.sessions) {
      if (projectId && entry.projectId && entry.projectId !== projectId) {
        continue;
      }

      entries.set(`${entry.sourceAgent}:${entry.id}`, entry);
    }
  }

  return [...entries.values()].sort(compareEntries);
};

export const loadHistorySessions = async (
  projectRoot: string,
  store: HistoryStore,
  limit = 5,
  projectId?: string,
): Promise<RawHistorySession[]> => {
  const roots = getHistoryRoots(projectRoot, store, projectId);
  const rootByKind = new Map(roots.map((root) => [root.kind, root]));
  const entries = await loadHistoryIndex(projectRoot, store, projectId);
  const selected = entries.slice(0, limit);
  const sessions: RawHistorySession[] = [];

  for (const entry of selected) {
    for (const root of [rootByKind.get("repo"), rootByKind.get("local")]) {
      if (!root) {
        continue;
      }

      const filePath = path.join(root.path, entry.path);

      if (await pathExists(filePath)) {
        sessions.push(await readSessionJsonl(filePath));
        break;
      }
    }
  }

  return sessions;
};

const readIndex = async (
  root: string,
  projectRoot: string,
): Promise<HistoryIndex> => {
  const indexPath = path.join(root, "index.json");

  if (!(await pathExists(indexPath))) {
    return {
      schemaVersion: 1,
      projectRoot,
      updatedAt: new Date(0).toISOString(),
      sessions: [],
    };
  }

  return JSON.parse(await readFile(indexPath, "utf8")) as HistoryIndex;
};

const writeIndex = async (root: string, index: HistoryIndex): Promise<void> => {
  await mkdir(root, { recursive: true });
  await writeAtomic(
    path.join(root, "index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
};

const renderSessionJsonl = (session: RawHistorySession): string => {
  const { messages, rawEvents, ...metadata } = session;
  const lines = [
    JSON.stringify({ type: "session", session: metadata }),
    ...messages.map((message) => JSON.stringify({ type: "message", message })),
    ...(rawEvents ?? []).map((event) => JSON.stringify({ type: "raw", event })),
  ];

  return `${lines.join("\n")}\n`;
};

const readSessionJsonl = async (
  filePath: string,
): Promise<RawHistorySession> => {
  const lines = (await readFile(filePath, "utf8")).trim().split("\n");
  const first = JSON.parse(lines[0] ?? "{}") as {
    session?: Omit<RawHistorySession, "messages" | "rawEvents">;
  };
  const messages: RawHistoryMessage[] = [];
  const rawEvents: unknown[] = [];

  for (const line of lines.slice(1)) {
    const parsed = JSON.parse(line) as {
      type?: string;
      message?: RawHistoryMessage;
      event?: unknown;
    };

    if (parsed.type === "message" && parsed.message) {
      messages.push(parsed.message);
    }

    if (parsed.type === "raw") {
      rawEvents.push(parsed.event);
    }
  }

  if (!first.session) {
    throw new Error(`${filePath} is not a valid Poko history session.`);
  }

  return {
    ...first.session,
    messages,
    rawEvents,
  };
};

const sessionFilePath = (session: RawHistorySession): string =>
  path.join(
    "sessions",
    session.sourceAgent,
    `${session.sourceAgent}-${sanitizeFilePart(session.id)}.jsonl`,
  );

const projectKey = (projectRoot: string, projectId?: string): string =>
  projectId
    ? sanitizeFilePart(projectId)
    : createHash("sha256")
        .update(path.resolve(projectRoot))
        .digest("hex")
        .slice(0, 16);

const sanitizeFilePart = (value: string): string =>
  value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") || "session";

const compareEntries = (
  left: HistoryIndexEntry,
  right: HistoryIndexEntry,
): number =>
  (right.updatedAt ?? right.createdAt ?? "").localeCompare(
    left.updatedAt ?? left.createdAt ?? "",
  );

const writeAtomic = async (
  destination: string,
  content: string,
): Promise<void> => {
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );

  await writeFile(temporary, content, "utf8");
  await rename(temporary, destination);
};
