import { describe, expect, test } from "bun:test";
import { run } from "../../src/cli.ts";
import { createMemoryLogger } from "../helpers.ts";

describe("cli", () => {
  test("shows global help for --help", async () => {
    const logger = createMemoryLogger();
    const code = await run(["--help"], process.cwd(), logger);

    expect(code).toBe(0);
    expect(logger.messages.join("\n")).toContain("poko init");
  });

  test("returns an error for unknown commands", async () => {
    await expect(
      run(["nope"], process.cwd(), createMemoryLogger()),
    ).rejects.toThrow("Unknown command");
  });
});
