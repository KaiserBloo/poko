import { describe, expect, test } from "bun:test";
import { renderHandoff } from "../../src/history/render.ts";
import type { RawHistorySession } from "../../src/history/types.ts";

describe("history handoff renderer", () => {
  test("omits runtime instruction snapshots unless raw output is requested", () => {
    const session: RawHistorySession = {
      schemaVersion: 1,
      id: "session-1",
      sourceAgent: "codex",
      title: "Renderer test",
      projectRoot: "/tmp/project",
      messages: [
        {
          role: "assistant",
          text: "<permissions instructions>\ninternal runtime details",
        },
        {
          role: "system",
          text: "system-only detail",
        },
        {
          role: "user",
          text: "build the feature",
        },
        {
          role: "assistant",
          text: "feature built",
        },
      ],
    };

    const defaultHandoff = renderHandoff("t3code", [session], false);
    expect(defaultHandoff).toContain("build the feature");
    expect(defaultHandoff).toContain("feature built");
    expect(defaultHandoff).not.toContain("internal runtime details");
    expect(defaultHandoff).not.toContain("system-only detail");

    const rawHandoff = renderHandoff("t3code", [session], true);
    expect(rawHandoff).toContain("internal runtime details");
    expect(rawHandoff).toContain("system-only detail");
  });
});
