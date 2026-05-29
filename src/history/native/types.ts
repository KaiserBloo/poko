import type { AgentId } from "../../adapters/types.ts";
import type { PokoConfig } from "../../core/config.ts";
import type { Logger } from "../../core/logger.ts";
import type { RawHistorySession } from "../types.ts";

export type NativeHistorySyncOptions = {
  root: string;
  config: PokoConfig;
  sessions: RawHistorySession[];
  dryRun?: boolean;
  logger?: Pick<Logger, "info" | "warn">;
};

export type NativeHistorySyncResult = {
  target: AgentId;
  location: string;
  sessions: number;
  messages: number;
  dryRun: boolean;
  skipped: boolean;
  reason?: string;
  details?: Record<string, number | string | boolean>;
};

export type NativeHistorySyncer = {
  id: AgentId;
  sync(options: NativeHistorySyncOptions): Promise<NativeHistorySyncResult>;
};
