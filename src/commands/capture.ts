import { loadPokoConfig, type PokoConfig } from "../core/config.ts";
import type { Logger } from "../core/logger.ts";
import {
  getHistoryImporter,
  HISTORY_IMPORTERS,
} from "../history/importers/index.ts";
import { writeHistorySessions } from "../history/storage.ts";
import {
  type HistoryAgent,
  type HistoryStore,
  type RawHistorySession,
  resolveHistoryAgent,
  supportedHistoryAgents,
} from "../history/types.ts";

export type CaptureOptions = {
  cwd: string;
  agent?: string;
  all?: boolean;
  store?: string;
  dryRun?: boolean;
  includePrevious?: boolean;
  logger: Logger;
};

export const runCapture = async (options: CaptureOptions): Promise<number> => {
  const config = await loadPokoConfig(options.cwd);
  const store = parseStore(options.store ?? config.history.defaultStore);
  const importers = selectImporters(options, config.history.agents);
  let captured = 0;

  for (const importer of importers) {
    options.logger.info(`checking ${importer.displayName} history...`);
    const importedSessions = await importer.capture(options.cwd);
    const { sessions, skipped } = filterProjectIncarnation(
      importedSessions,
      config,
      Boolean(options.includePrevious),
    );
    const stampedSessions = stampProjectIdentity(sessions, config);
    captured += sessions.length;

    if (options.dryRun) {
      options.logger.info(
        `would capture ${sessions.length} ${importer.displayName} session(s).`,
      );
      reportSessions(sessions, options.logger);
      reportSkippedSessions(skipped, options.logger);
      continue;
    }

    await writeHistorySessions(
      options.cwd,
      store,
      stampedSessions,
      config.project.id,
    );
    options.logger.success(
      `captured ${sessions.length} ${importer.displayName} session(s).`,
    );
    reportSkippedSessions(skipped, options.logger);
  }

  if (captured === 0) {
    options.logger.warn("no matching history found for this project.");
  }

  return captured;
};

const stampProjectIdentity = (
  sessions: RawHistorySession[],
  config: PokoConfig,
): RawHistorySession[] =>
  sessions.map((session) => ({
    ...session,
    projectId: config.project.id || session.projectId,
  }));

const filterProjectIncarnation = (
  sessions: RawHistorySession[],
  config: PokoConfig,
  includePrevious: boolean,
): { sessions: RawHistorySession[]; skipped: RawHistorySession[] } => {
  if (includePrevious || config.history.includePreviousProjectIncarnations) {
    return { sessions, skipped: [] };
  }

  const projectCreatedAt = Date.parse(config.project.createdAt);

  if (!Number.isFinite(projectCreatedAt)) {
    return { sessions, skipped: [] };
  }

  const current: RawHistorySession[] = [];
  const skipped: RawHistorySession[] = [];

  for (const session of sessions) {
    const timestamp = Date.parse(session.updatedAt ?? session.createdAt ?? "");

    if (Number.isFinite(timestamp) && timestamp < projectCreatedAt) {
      skipped.push(session);
      continue;
    }

    current.push(session);
  }

  return { sessions: current, skipped };
};

const reportSessions = (
  sessions: RawHistorySession[],
  logger: Logger,
): void => {
  for (const session of sessions) {
    logger.plain(
      [
        `- ${session.title}`,
        `  id: ${session.id}`,
        `  messages: ${session.messages.length}`,
        session.updatedAt ? `  updated: ${session.updatedAt}` : undefined,
        session.sourcePath ? `  source: ${session.sourcePath}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
};

const reportSkippedSessions = (
  sessions: RawHistorySession[],
  logger: Logger,
): void => {
  if (sessions.length === 0) {
    return;
  }

  logger.info(
    `skipped ${sessions.length} older same-path session(s) from before this .poko project was initialized.`,
  );
  logger.info("use `--include-previous` to include them anyway.");

  for (const session of sessions) {
    logger.plain(
      [
        `- skipped ${session.title}`,
        `  id: ${session.id}`,
        session.updatedAt ? `  updated: ${session.updatedAt}` : undefined,
        session.sourcePath ? `  source: ${session.sourcePath}` : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
};

const selectImporters = (
  options: CaptureOptions,
  enabledAgents: Record<HistoryAgent, boolean>,
) => {
  if (options.agent && !options.all) {
    const agent = parseHistoryAgent(options.agent);
    const importer = getHistoryImporter(agent);

    if (!importer) {
      throw new Error(`No history importer found for "${agent}".`);
    }

    return [importer];
  }

  return HISTORY_IMPORTERS.filter((importer) => enabledAgents[importer.id]);
};

const parseHistoryAgent = (value: string): HistoryAgent => {
  const agent = resolveHistoryAgent(value);

  if (agent) {
    return agent;
  }

  throw new Error(
    `Unknown history agent "${value}". Supported history agents: ${supportedHistoryAgents()}.`,
  );
};

const parseStore = (value: string): HistoryStore => {
  if (value === "local" || value === "repo" || value === "both") {
    return value;
  }

  throw new Error('History store must be one of "local", "repo", or "both".');
};
