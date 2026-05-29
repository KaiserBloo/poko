export const DEFAULT_POKO_CONFIG = `{
  "schemaVersion": 1,
  "project": {
    "id": "",
    "createdAt": ""
  },
  "adapters": {
    "claude": {
      "enabled": true,
      "mcp": true,
      "skills": true
    },
    "cursor": {
      "enabled": true,
      "mcp": true,
      "legacyCursorrules": false
    },
    "aider": {
      "enabled": true
    },
    "antigravity": {
      "enabled": true
    },
    "copilot": {
      "enabled": true,
      "mcp": true
    },
    "t3code": {
      "enabled": true,
      "skills": true
    },
    "opencode": {
      "enabled": true,
      "mcp": true
    },
    "gemini": {
      "enabled": false,
      "mcp": true
    },
    "codex": {
      "enabled": true,
      "mcp": true
    }
  },
  "history": {
    "defaultStore": "local",
    "captureRaw": true,
    "includePreviousProjectIncarnations": false,
    "syncOnProjectSync": true,
    "agents": {
      "codex": true,
      "claude": true,
      "cursor": true
    }
  },
  "pro": {
    "enabledFeatures": []
  }
}
`;

export const DEFAULT_RULES = `# Project Rules

<!-- Add durable instructions that every agent should follow in this project. -->
`;

export const DEFAULT_MEMORY = `# Project Memory

<!-- Add stable project facts, decisions, and gotchas here. -->
`;

export const DEFAULT_STYLE = `# Coding Style

<!-- Add project-specific naming, formatting, testing, and review preferences here. -->
`;

export const DEFAULT_STACK = `# Tech Stack

<!-- Add the languages, frameworks, package managers, and important commands for this project. -->
`;

export const DEFAULT_MCP = `{
  "mcpServers": {}
}
`;

export const DEFAULT_SKILLS_README = `# Project Skills

Add project skills here when you want Poko to export them to agents that support skills.

Supported shapes:

- .poko/skills/my-skill.md
- .poko/skills/my-skill/SKILL.md
`;

export const INIT_TEMPLATES = [
  { path: ".poko/poko.json", content: DEFAULT_POKO_CONFIG },
  { path: ".poko/rules.md", content: DEFAULT_RULES },
  { path: ".poko/memory.md", content: DEFAULT_MEMORY },
  { path: ".poko/style.md", content: DEFAULT_STYLE },
  { path: ".poko/stack.md", content: DEFAULT_STACK },
  { path: ".poko/mcp.json", content: DEFAULT_MCP },
  { path: ".poko/skills/README.md", content: DEFAULT_SKILLS_README },
] as const;
