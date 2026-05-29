import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { runInit } from "../../src/commands/init.ts";
import { createMemoryLogger, makeTempDir, removeTempDir } from "../helpers.ts";

let cwd: string;

beforeEach(async () => {
  cwd = await makeTempDir();
});

afterEach(async () => {
  await removeTempDir(cwd);
});

describe("poko init", () => {
  test("creates the canonical .poko folder", async () => {
    const logger = createMemoryLogger();
    const results = await runInit({ cwd, logger });

    expect(results.every((result) => result.action === "created")).toBe(true);
    expect(await readFile(path.join(cwd, ".poko/poko.json"), "utf8")).toContain(
      '"schemaVersion": 1',
    );
    expect(await readFile(path.join(cwd, ".poko/rules.md"), "utf8")).toContain(
      "# Project Rules",
    );
    expect(
      await readFile(path.join(cwd, ".poko/skills/README.md"), "utf8"),
    ).toContain("Poko Skills");
  });

  test("does not overwrite existing files unless forced", async () => {
    await runInit({ cwd, logger: createMemoryLogger() });
    await writeFile(path.join(cwd, ".poko/rules.md"), "custom rules\n", "utf8");

    const skipped = await runInit({ cwd, logger: createMemoryLogger() });
    expect(
      skipped.find((result) => result.path === ".poko/rules.md")?.action,
    ).toBe("skipped");
    expect(await readFile(path.join(cwd, ".poko/rules.md"), "utf8")).toBe(
      "custom rules\n",
    );

    const forced = await runInit({
      cwd,
      force: true,
      logger: createMemoryLogger(),
    });
    expect(
      forced.find((result) => result.path === ".poko/rules.md")?.action,
    ).toBe("overwritten");
    expect(await readFile(path.join(cwd, ".poko/rules.md"), "utf8")).toContain(
      "# Project Rules",
    );
  });
});
