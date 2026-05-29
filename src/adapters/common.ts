import { stringify as stringifyToml } from "@iarna/toml";
import type { McpServer, PokoContext } from "../core/config.ts";
import type { JsonObject } from "./types.ts";

export const hasMcpServers = (context: PokoContext): boolean =>
  Object.keys(context.mcpServers).length > 0;

export const renderMcpJson = (context: PokoContext): JsonObject => ({
  mcpServers: Object.fromEntries(
    Object.entries(context.mcpServers).map(([name, server]) => [
      name,
      cleanMcpServer(server),
    ]),
  ) as JsonObject,
});

export const renderVsCodeMcpJson = (context: PokoContext): JsonObject => ({
  servers: Object.fromEntries(
    Object.entries(context.mcpServers).map(([name, server]) => [
      name,
      cleanVsCodeMcpServer(server),
    ]),
  ) as JsonObject,
});

export const renderOpenCodeConfigJson = (context: PokoContext): JsonObject => ({
  $schema: "https://opencode.ai/config.json",
  ...(hasMcpServers(context)
    ? {
        mcp: Object.fromEntries(
          Object.entries(context.mcpServers).map(([name, server]) => [
            name,
            cleanOpenCodeMcpServer(server),
          ]),
        ) as JsonObject,
      }
    : {}),
});

export const renderCodexMcpToml = (context: PokoContext): string => {
  return stringifyToml({
    mcp_servers: Object.fromEntries(
      Object.entries(context.mcpServers).map(([name, server]) => [
        name,
        cleanMcpServer(server),
      ]),
    ),
  } as never).trim();
};

const cleanMcpServer = (server: McpServer): JsonObject => {
  const clean: JsonObject = {};

  for (const key of [
    "command",
    "url",
    "args",
    "env",
    "headers",
    "cwd",
  ] as const) {
    const value = server[key];

    if (value !== undefined) {
      clean[key] = value as JsonObject[string];
    }
  }

  return clean;
};

const cleanVsCodeMcpServer = (server: McpServer): JsonObject => {
  if (server.url) {
    return {
      type: "http",
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return {
    type: "stdio",
    command: server.command ?? "",
    ...(server.args ? { args: server.args } : {}),
    ...(server.env ? { env: server.env } : {}),
  };
};

const cleanOpenCodeMcpServer = (server: McpServer): JsonObject => {
  if (server.url) {
    return {
      type: "remote",
      url: server.url,
      enabled: true,
      ...(server.headers ? { headers: server.headers } : {}),
    };
  }

  return {
    type: "local",
    command: [server.command ?? "", ...(server.args ?? [])],
    enabled: true,
    ...(server.env ? { environment: server.env } : {}),
  };
};
