import { aiderAdapter } from "./aider.ts";
import { antigravityAdapter } from "./antigravity.ts";
import { claudeAdapter } from "./claude.ts";
import { codexAdapter } from "./codex.ts";
import { copilotAdapter } from "./copilot.ts";
import { cursorAdapter } from "./cursor.ts";
import { geminiAdapter } from "./gemini.ts";
import { openCodeAdapter } from "./opencode.ts";
import { t3CodeAdapter } from "./t3code.ts";
import type { AgentAdapter, AgentId } from "./types.ts";

export const ADAPTERS: AgentAdapter[] = [
  claudeAdapter,
  cursorAdapter,
  aiderAdapter,
  antigravityAdapter,
  copilotAdapter,
  t3CodeAdapter,
  openCodeAdapter,
  geminiAdapter,
  codexAdapter,
];

export const getAdapter = (id: AgentId): AgentAdapter | undefined =>
  ADAPTERS.find((adapter) => adapter.id === id);
