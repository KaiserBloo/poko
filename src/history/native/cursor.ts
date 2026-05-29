import { Database } from "bun:sqlite";
import path from "node:path";
import { pathExists } from "../../core/config.ts";
import {
  type CursorWorkspace,
  cursorFileUri,
  cursorWorkspaceIdentifier,
  ensureCursorStateDatabase,
  ensureCursorWorkspace,
  resolveCursorGlobalStateDbPath,
  resolveCursorWorkspaceStorageRoot,
} from "../cursor-storage.ts";
import type { RawHistoryMessage, RawHistorySession } from "../types.ts";
import {
  closeAppForNativeSync,
  type NativeAppController,
  type NativeAppLifecycle,
  reopenAppAfterNativeSync,
} from "./app-lifecycle.ts";
import {
  conversationMessages,
  countConversationMessages,
  countSameAgentSessions,
  dateFrom,
  deterministicUuid,
  messageDate,
  nativeTargetSessions,
  resolveRealProjectRoot,
  sessionCreatedDate,
  sessionUpdatedDate,
  timestampMs,
  truncate,
} from "./common.ts";
import type {
  NativeHistorySyncer,
  NativeHistorySyncOptions,
  NativeHistorySyncResult,
} from "./types.ts";

type CursorRenderedSession = {
  composerId: string;
  head: Record<string, unknown>;
  composerData: Record<string, unknown>;
  bubbles: Array<{ key: string; value: Record<string, unknown> }>;
};

type CursorWriteStats = {
  composerRecordsWritten: number;
  bubblesWritten: number;
  staleComposersRemoved: number;
};

type CursorNativeHistorySyncOptions = NativeHistorySyncOptions & {
  appController?: NativeAppController;
};

const CURSOR_IMPORT_MODEL = "composer-2.5";

export const cursorNativeSyncer: NativeHistorySyncer = {
  id: "cursor",
  sync: syncCursorNativeHistory,
};

export async function syncCursorNativeHistory(
  options: CursorNativeHistorySyncOptions,
): Promise<NativeHistorySyncResult> {
  const storageRoot = resolveCursorWorkspaceStorageRoot();
  const globalStateDbPath = resolveCursorGlobalStateDbPath();
  const sessions = nativeTargetSessions(options.sessions, "cursor");
  const messageCount = countConversationMessages(sessions);

  if (options.dryRun) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: true,
      skipped: false,
      details: {
        composerRecordsWritten: sessions.length,
        bubblesWritten: messageCount,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "cursor",
        ),
      },
    };
  }

  if (!(await pathExists(globalStateDbPath))) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason: "Cursor global state.vscdb was not found.",
    };
  }

  const projectRoot = await resolveRealProjectRoot(options.root);
  const lifecycle = await closeCursorForNativeSync(options);

  if (lifecycle.reason) {
    return {
      target: "cursor",
      location: globalStateDbPath,
      sessions: 0,
      messages: 0,
      dryRun: false,
      skipped: true,
      reason: lifecycle.reason,
      details: {
        cursorWasRunning: lifecycle.wasRunning,
        cursorClosed: lifecycle.closed,
        cursorReopened: lifecycle.reopened,
      },
    };
  }

  let globalDatabase: Database | undefined;
  let workspaceDatabase: Database | undefined;
  let result: NativeHistorySyncResult;

  try {
    const workspace = await ensureCursorWorkspace(storageRoot, projectRoot);
    ensureCursorStateDatabase(globalStateDbPath, ["ItemTable", "cursorDiskKV"]);
    ensureCursorStateDatabase(workspace.databasePath, ["ItemTable"]);

    globalDatabase = new Database(globalStateDbPath);
    workspaceDatabase = new Database(workspace.databasePath);
    globalDatabase.run("pragma busy_timeout = 5000");
    workspaceDatabase.run("pragma busy_timeout = 5000");

    const fallbackDate = dateFrom(options.config.project.createdAt, new Date());
    const rendered = sessions.map((session) =>
      renderCursorSession({
        session,
        workspace,
        projectRoot,
        projectId: options.config.project.id,
        fallbackDate,
      }),
    );

    const stats = writeCursorImports({
      globalDatabase,
      workspaceDatabase,
      workspace,
      projectRoot,
      rendered,
    });

    result = {
      target: "cursor",
      location: globalStateDbPath,
      sessions: sessions.length,
      messages: messageCount,
      dryRun: false,
      skipped: false,
      details: {
        ...stats,
        cursorWasRunning: lifecycle.wasRunning,
        cursorClosed: lifecycle.closed,
        cursorReopened: lifecycle.reopened,
        sessionsSkippedFromSameAgent: countSameAgentSessions(
          options.sessions,
          "cursor",
        ),
      },
    };
  } finally {
    workspaceDatabase?.close();
    globalDatabase?.close();
    await reopenCursorAfterNativeSync(options, lifecycle);
  }

  if (result.details) {
    result.details.cursorReopened = lifecycle.reopened;
  }

  return result;
}

const renderCursorSession = (input: {
  session: RawHistorySession;
  workspace: CursorWorkspace;
  projectRoot: string;
  projectId: string;
  fallbackDate: Date;
}): CursorRenderedSession => {
  const composerId = deterministicUuid(
    `poko:cursor:composer:${input.session.sourceAgent}:${input.session.id}`,
  );
  const created = sessionCreatedDate(input.session, input.fallbackDate);
  const updated = sessionUpdatedDate(input.session, created);
  const createdMs = timestampMs(created);
  const updatedMs = timestampMs(updated);
  const title = truncate(input.session.title || "Poko import", 80);
  const workspaceIdentifier = cursorWorkspaceIdentifier(
    input.workspace,
    input.projectRoot,
  );
  const pokoImport = {
    originator: "poko",
    sourceAgent: input.session.sourceAgent,
    sourceSessionId: input.session.id,
    projectId: input.projectId,
    projectRoot: input.projectRoot,
  };
  const messages = conversationMessages(input.session);
  const headers = messages.map((message, index) =>
    renderCursorHeader(input.session, message, index),
  );
  const bubbles = messages.map((message, index) => {
    const bubbleId = cursorBubbleId(input.session, message, index);

    return {
      key: `bubbleId:${composerId}:${bubbleId}`,
      value: renderCursorBubble({
        session: input.session,
        message,
        index,
        bubbleId,
        created,
        projectRoot: input.projectRoot,
        workspace: input.workspace,
        pokoImport,
      }),
    };
  });

  const head = {
    type: "head",
    composerId,
    name: title,
    lastUpdatedAt: updatedMs,
    conversationCheckpointLastUpdatedAt: updatedMs,
    createdAt: createdMs,
    unifiedMode: "agent",
    forceMode: "edit",
    hasUnreadMessages: false,
    contextUsagePercent: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    filesChangedCount: 0,
    hasBlockingPendingActions: false,
    hasPendingPlan: false,
    isArchived: false,
    isDraft: false,
    isWorktree: false,
    worktreeStartedReadOnly: false,
    isSpec: false,
    isProject: false,
    isBestOfNSubcomposer: false,
    numSubComposers: 0,
    referencedPlans: [],
    trackedGitRepos: [],
    workspaceIdentifier,
    agentLocation: {
      type: "local",
      environment: workspaceIdentifier,
      status: "active",
    },
    agentLocationHistory: [
      {
        id: deterministicUuid(`poko:cursor:location:${composerId}`),
        timestamp: createdMs,
        destination: { type: "local" },
        location: {
          type: "local",
          environment: workspaceIdentifier,
          status: "active",
        },
        reason: "created",
      },
    ],
    pokoImport,
  };

  return {
    composerId,
    head,
    composerData: {
      _v: 16,
      composerId,
      richText: emptyCursorRichText(),
      hasLoaded: true,
      text: "",
      fullConversationHeadersOnly: headers,
      conversationMap: {},
      status: "completed",
      context: emptyCursorContext(),
      gitGraphFileSuggestions: [],
      generatingBubbleIds: [],
      isReadingLongFile: false,
      codeBlockData: {},
      originalFileStates: {},
      newlyCreatedFiles: [],
      newlyCreatedFolders: [],
      lastUpdatedAt: updatedMs,
      createdAt: createdMs,
      hasChangedContext: false,
      activeTabsShouldBeReactive: true,
      capabilities: [],
      name: title,
      isFileListExpanded: false,
      browserChipManuallyDisabled: false,
      browserChipManuallyEnabled: false,
      unifiedMode: "agent",
      forceMode: "edit",
      usageData: {},
      contextUsagePercent: 0,
      contextTokensUsed: 0,
      contextTokenLimit: 0,
      allAttachedFileCodeChunksUris: [],
      modelConfig: {
        modelName: CURSOR_IMPORT_MODEL,
        maxMode: false,
        selectedModels: [
          {
            modelId: CURSOR_IMPORT_MODEL,
            parameters: [{ id: "fast", value: "true" }],
          },
        ],
      },
      subComposerIds: [],
      capabilityContexts: [],
      todos: [],
      isQueueExpanded: false,
      hasUnreadMessages: false,
      gitHubPromptDismissed: true,
      totalLinesAdded: 0,
      totalLinesRemoved: 0,
      addedFiles: [],
      removedFiles: [],
      isArchived: false,
      isDraft: false,
      isCreatingWorktree: false,
      isApplyingWorktree: false,
      isUndoingWorktree: false,
      applied: false,
      pendingCreateWorktree: false,
      isBestOfNSubcomposer: false,
      isBestOfNParent: false,
      isSpec: false,
      isSpecSubagentDone: false,
      stopHookLoopCount: 0,
      isNAL: false,
      planModeSuggestionUsed: false,
      latestChatGenerationUUID: "",
      isAgentic: true,
      subtitle: `${messages.length} imported message(s) from ${input.session.sourceAgent}`,
      filesChangedCount: 0,
      trackedGitRepos: [],
      workspaceIdentifier,
      pokoImport,
    },
    bubbles,
  };
};

const renderCursorHeader = (
  session: RawHistorySession,
  message: RawHistoryMessage,
  index: number,
): Record<string, unknown> => {
  const header: Record<string, unknown> = {
    bubbleId: cursorBubbleId(session, message, index),
    type: message.role === "user" ? 1 : 2,
  };

  if (message.role === "assistant") {
    header.grouping = {
      isRenderable: true,
      hasText: true,
      isShortPlainText: message.text.length <= 240,
      isKeptFinalAiVisibleOutsideWorkedForGroup: true,
    };
  }

  return header;
};

const renderCursorBubble = (input: {
  session: RawHistorySession;
  message: RawHistoryMessage;
  index: number;
  bubbleId: string;
  created: Date;
  projectRoot: string;
  workspace: CursorWorkspace;
  pokoImport: Record<string, unknown>;
}): Record<string, unknown> => {
  const timestamp = messageDate(input.message, input.created).toISOString();
  const common = {
    _v: 3,
    type: input.message.role === "user" ? 1 : 2,
    approximateLintErrors: [],
    lints: [],
    codebaseContextChunks: [],
    commits: [],
    pullRequests: [],
    attachedCodeChunks: [],
    assistantSuggestedDiffs: [],
    gitDiffs: [],
    interpreterResults: [],
    images: [],
    attachedFolders: [],
    attachedFoldersNew: [],
    bubbleId: input.bubbleId,
    userResponsesToSuggestedCodeBlocks: [],
    suggestedCodeBlocks: [],
    diffsForCompressingFiles: [],
    relevantFiles: [],
    toolResults: [],
    notepads: [],
    capabilities: [],
    capabilityStatuses: emptyCursorCapabilityStatuses(),
    multiFileLinterErrors: [],
    diffHistories: [],
    recentLocationsHistory: [],
    recentlyViewedFiles: [],
    isAgentic: true,
    fileDiffTrajectories: [],
    existedSubsequentTerminalCommand: false,
    existedPreviousTerminalCommand: false,
    docsReferences: [],
    webReferences: [],
    aiWebSearchResults: [],
    requestId: "",
    attachedFoldersListDirResults: [],
    humanChanges: [],
    summarizedComposers: [],
    cursorRules: [],
    contextPieces: [],
    editTrailContexts: [],
    allThinkingBlocks: [],
    diffsSinceLastApply: [],
    deletedFiles: [],
    supportedTools: [],
    tokenCount: {
      inputTokens: 0,
      outputTokens: 0,
    },
    attachedFileCodeChunksMetadataOnly: [],
    consoleLogs: [],
    uiElementPicked: [],
    isRefunded: false,
    knowledgeItems: [],
    documentationSelections: [],
    externalLinks: [],
    useWeb: false,
    projectLayouts: [],
    unifiedMode: 2,
    capabilityContexts: [],
    todos: [],
    createdAt: timestamp,
    isQuickSearchQuery: false,
    mcpDescriptors: [],
    workspaceUris: [cursorFileUri(input.projectRoot)],
    text: input.message.text,
    modelInfo: {
      modelName: CURSOR_IMPORT_MODEL,
    },
    workspaceProjectDir: cursorProjectDir(input.projectRoot),
    context: emptyCursorContext(),
    pokoImport: input.pokoImport,
  };

  if (input.message.role === "user") {
    return {
      ...common,
      richText: cursorRichText(input.message.text),
      editToolSupportsSearchAndReplace: false,
    };
  }

  return {
    ...common,
    codeBlocks: [],
    timingInfo: {
      clientRpcSendTime: timestampMs(new Date(timestamp), input.index),
      clientSettleTime: timestampMs(new Date(timestamp), input.index),
      clientEndTime: timestampMs(new Date(timestamp), input.index),
    },
  };
};

const writeCursorImports = (input: {
  globalDatabase: Database;
  workspaceDatabase: Database;
  workspace: CursorWorkspace;
  projectRoot: string;
  rendered: CursorRenderedSession[];
}): CursorWriteStats => {
  const desiredIds = new Set(
    input.rendered.map((session) => session.composerId),
  );
  const staleComposersRemoved = cleanupStalePokoCursorImports({
    database: input.globalDatabase,
    projectRoot: input.projectRoot,
    desiredIds,
  });

  for (const session of input.rendered) {
    input.globalDatabase
      .query("delete from cursorDiskKV where key like ?")
      .run(`bubbleId:${session.composerId}:%`);
  }

  mergeComposerHeads({
    database: input.workspaceDatabase,
    key: "composer.composerData",
    projectRoot: input.projectRoot,
    rendered: input.rendered,
    includeWorkspaceSelectionFields: true,
  });
  mergeComposerHeads({
    database: input.globalDatabase,
    key: "composer.composerHeaders",
    projectRoot: input.projectRoot,
    rendered: input.rendered,
    includeWorkspaceSelectionFields: false,
  });

  for (const session of input.rendered) {
    upsertKey(
      input.globalDatabase,
      "cursorDiskKV",
      `composerData:${session.composerId}`,
      JSON.stringify(session.composerData),
    );

    for (const bubble of session.bubbles) {
      upsertKey(
        input.globalDatabase,
        "cursorDiskKV",
        bubble.key,
        JSON.stringify(bubble.value),
      );
    }
  }

  mergeComposerPaneState(input.workspaceDatabase, input.rendered);

  return {
    composerRecordsWritten: input.rendered.length,
    bubblesWritten: input.rendered.reduce(
      (count, session) => count + session.bubbles.length,
      0,
    ),
    staleComposersRemoved,
  };
};

const mergeComposerHeads = (input: {
  database: Database;
  key: string;
  projectRoot: string;
  rendered: CursorRenderedSession[];
  includeWorkspaceSelectionFields: boolean;
}): void => {
  const desiredIds = new Set(
    input.rendered.map((session) => session.composerId),
  );
  const existing = parseJsonObject(
    queryKey(input.database, "ItemTable", input.key),
  );
  const existingHeads = Array.isArray(existing.allComposers)
    ? existing.allComposers.filter(isRecord)
    : [];
  const nextHeads = existingHeads.filter(
    (head) =>
      !isPokoImportForProject(head, input.projectRoot) ||
      (typeof head.composerId === "string" && desiredIds.has(head.composerId)),
  );

  for (const session of input.rendered) {
    const index = nextHeads.findIndex(
      (head) => head.composerId === session.composerId,
    );

    if (index >= 0) {
      nextHeads[index] = session.head;
    } else {
      nextHeads.push(session.head);
    }
  }

  nextHeads.sort(
    (left, right) =>
      numberValue(right.lastUpdatedAt) - numberValue(left.lastUpdatedAt),
  );

  const next: Record<string, unknown> = {
    ...existing,
    allComposers: nextHeads,
  };

  if (input.includeWorkspaceSelectionFields) {
    const firstDesired = input.rendered[0]?.composerId;
    next.selectedComposerIds = firstDesired
      ? [firstDesired]
      : (existing.selectedComposerIds ?? []);
    next.lastFocusedComposerIds = firstDesired
      ? [firstDesired]
      : (existing.lastFocusedComposerIds ?? []);
    next.hasMigratedComposerData = true;
    next.hasMigratedMultipleComposers = true;
  }

  upsertKey(input.database, "ItemTable", input.key, JSON.stringify(next));
};

const mergeComposerPaneState = (
  database: Database,
  rendered: CursorRenderedSession[],
): void => {
  if (rendered.length === 0) {
    return;
  }

  const key = "workbench.panel.composerChatViewPane";
  const existing = parseJsonObject(queryKey(database, "ItemTable", key));

  for (const session of rendered) {
    existing[`workbench.panel.aichat.view.${session.composerId}`] = {
      collapsed: false,
      isHidden: false,
      size: 800,
    };
  }

  upsertKey(database, "ItemTable", key, JSON.stringify(existing));
  upsertKey(
    database,
    "ItemTable",
    "workbench.panel.aichat.numberOfVisibleViews",
    String(rendered.length),
  );
};

const cleanupStalePokoCursorImports = (input: {
  database: Database;
  projectRoot: string;
  desiredIds: Set<string>;
}): number => {
  const rows = input.database
    .query(
      "select key, value from cursorDiskKV where key like 'composerData:%'",
    )
    .all() as Array<{ key: string; value: string }>;
  let removed = 0;

  for (const row of rows) {
    const data = parseJsonObject(row.value);

    if (!isPokoImportForProject(data, input.projectRoot)) {
      continue;
    }

    const composerId = String(
      data.composerId ?? row.key.replace("composerData:", ""),
    );

    if (input.desiredIds.has(composerId)) {
      continue;
    }

    input.database
      .query("delete from cursorDiskKV where key = ?")
      .run(`composerData:${composerId}`);
    input.database
      .query("delete from cursorDiskKV where key like ?")
      .run(`bubbleId:${composerId}:%`);
    removed += 1;
  }

  return removed;
};

const queryKey = (
  database: Database,
  table: "ItemTable" | "cursorDiskKV",
  key: string,
): string | undefined => {
  const row = database
    .query(`select value from ${table} where key = ?`)
    .get(key) as { value?: string } | undefined;

  return typeof row?.value === "string" ? row.value : undefined;
};

const upsertKey = (
  database: Database,
  table: "ItemTable" | "cursorDiskKV",
  key: string,
  value: string,
): void => {
  database
    .query(`insert or replace into ${table} (key, value) values (?, ?)`)
    .run(key, value);
};

const parseJsonObject = (
  value: string | undefined,
): Record<string, unknown> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const closeCursorForNativeSync = async (
  options: CursorNativeHistorySyncOptions,
): Promise<NativeAppLifecycle> =>
  closeAppForNativeSync({
    displayName: "Cursor",
    appNames: resolveCursorAppNames(),
    skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE",
    appController: options.appController,
    logger: options.logger,
  });

const reopenCursorAfterNativeSync = async (
  options: CursorNativeHistorySyncOptions,
  lifecycle: NativeAppLifecycle,
): Promise<void> =>
  reopenAppAfterNativeSync(
    {
      displayName: "Cursor",
      appNames: resolveCursorAppNames(),
      skipEnvVar: "POKO_CURSOR_SKIP_APP_LIFECYCLE",
      appController: options.appController,
      logger: options.logger,
    },
    lifecycle,
  );

const resolveCursorAppNames = (): string[] => {
  const names = [process.env.POKO_CURSOR_APP_NAME, "Cursor"].filter(
    (value): value is string => Boolean(value),
  );

  return [...new Set(names)];
};

const cursorBubbleId = (
  session: RawHistorySession,
  message: RawHistoryMessage,
  index: number,
): string =>
  deterministicUuid(
    `poko:cursor:bubble:${session.sourceAgent}:${session.id}:${message.id ?? index}:${message.role}`,
  );

const cursorRichText = (text: string): string =>
  JSON.stringify({
    root: {
      children: text.split("\n").map((line) => ({
        children: line
          ? [
              {
                detail: 0,
                format: 0,
                mode: "normal",
                style: "",
                text: line,
                type: "text",
                version: 1,
              },
            ]
          : [],
        direction: line ? "ltr" : null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      })),
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });

const emptyCursorRichText = (): string =>
  JSON.stringify({
    root: {
      children: [
        {
          children: [],
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  });

const emptyCursorContext = (): Record<string, unknown> => ({
  composers: [],
  selectedCommits: [],
  selectedPullRequests: [],
  selectedImages: [],
  selectedDocuments: [],
  selectedVideos: [],
  folderSelections: [],
  fileSelections: [],
  selections: [],
  terminalSelections: [],
  selectedDocs: [],
  externalLinks: [],
  cursorRules: [],
  cursorCommands: [],
  gitPRDiffSelections: [],
  subagentSelections: [],
  browserSelections: [],
  extraContext: [],
  mentions: {
    composers: {},
    selectedCommits: {},
    selectedPullRequests: {},
    gitDiff: [],
    gitDiffFromBranchToMain: [],
    selectedImages: {},
    folderSelections: {},
    fileSelections: {},
    terminalFiles: {},
    selections: {},
    terminalSelections: {},
    selectedDocs: {},
    externalLinks: {},
    diffHistory: [],
    cursorRules: {},
    cursorCommands: {},
    uiElementSelections: [],
    consoleLogs: [],
    ideEditorsState: [],
    gitPRDiffSelections: {},
    subagentSelections: {},
    browserSelections: {},
  },
});

const emptyCursorCapabilityStatuses = (): Record<string, unknown[]> => ({
  "mutate-request": [],
  "start-submit-chat": [],
  "before-submit-chat": [],
  "chat-stream-finished": [],
  "before-apply": [],
  "after-apply": [],
  "accept-all-edits": [],
  "composer-done": [],
  "process-stream": [],
  "add-pending-action": [],
});

const cursorProjectDir = (projectRoot: string): string =>
  path.join(
    process.env.POKO_CURSOR_PROJECTS_ROOT ??
      path.join(process.env.HOME ?? "", ".cursor", "projects"),
    projectRoot.replace(/^\/+/, "").replace(/[^a-zA-Z0-9._-]+/g, "-"),
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isPokoImportForProject = (
  value: Record<string, unknown>,
  projectRoot: string,
): boolean =>
  isRecord(value.pokoImport) &&
  value.pokoImport.originator === "poko" &&
  value.pokoImport.projectRoot === projectRoot;

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
