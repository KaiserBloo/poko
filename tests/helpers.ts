import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Logger } from "../src/core/logger.ts";

export const makeTempDir = async (): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), "poko-test-"));

export const removeTempDir = async (directory: string): Promise<void> => {
  await rm(directory, { recursive: true, force: true });
};

export const createMemoryLogger = (): Logger & { messages: string[] } => {
  const messages: string[] = [];
  const push = (message: string) => messages.push(message);

  return {
    messages,
    info: push,
    success: push,
    warn: push,
    error: push,
    plain: push,
  };
};
