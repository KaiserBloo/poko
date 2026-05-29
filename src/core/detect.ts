import { access } from "node:fs/promises";
import path from "node:path";
import type { AgentDetection, AgentId } from "../adapters/types.ts";
import { pathExists } from "./config.ts";

type DetectSignals = {
  id: AgentId;
  displayName: string;
  binaries: string[];
  projectPaths: string[];
};

export const detectBySignals = async (
  root: string,
  signals: DetectSignals,
): Promise<AgentDetection> => {
  const reasons: string[] = [];

  for (const binary of signals.binaries) {
    if (await findExecutable(binary)) {
      reasons.push(`found ${binary} on PATH`);
      break;
    }
  }

  for (const relativePath of signals.projectPaths) {
    if (await pathExists(path.join(root, relativePath))) {
      reasons.push(`found ${relativePath}`);
    }
  }

  return {
    id: signals.id,
    displayName: signals.displayName,
    detected: reasons.length > 0,
    reasons,
  };
};

const findExecutable = async (binary: string): Promise<boolean> => {
  const pathValue = process.env.PATH ?? "";
  const extensions =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }

    for (const extension of extensions) {
      try {
        await access(path.join(directory, `${binary}${extension}`));
        return true;
      } catch {
        // Try the next PATH candidate.
      }
    }
  }

  return false;
};
