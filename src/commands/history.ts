import { loadPokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import { loadHistoryIndex } from "../history/storage.ts";
import type { HistoryStore } from "../history/types.ts";

export type HistoryOptions = {
  cwd: string;
  store?: string;
  logger: Logger;
};

export const runHistory = async (options: HistoryOptions): Promise<number> => {
  const config = await loadPokoConfig(options.cwd);
  const store = parseStore(options.store ?? config.history.defaultStore);
  const entries = await loadHistoryIndex(options.cwd, store, config.project.id);

  if (entries.length === 0) {
    options.logger.warn("no captured history yet. Try `poko capture --all`.");
    return 0;
  }

  for (const entry of entries) {
    options.logger.plain(
      `${entry.updatedAt ?? entry.createdAt ?? "unknown"}  ${entry.sourceAgent}  ${entry.messageCount} msg  ${entry.title}`,
    );
  }

  return entries.length;
};

const parseStore = (value: string): HistoryStore => {
  if (value === "local" || value === "repo" || value === "both") {
    return value;
  }

  throw new Error('History store must be one of "local", "repo", or "both".');
};
