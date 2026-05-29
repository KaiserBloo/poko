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

- Prefer small, well-tested changes.
- Follow the existing architecture and naming conventions before adding new patterns.
- Keep generated files, secrets, and machine-specific state out of commits.
- Explain risky tradeoffs before making broad changes.
`;

export const DEFAULT_MEMORY = `# Project Memory

- Product: poko.sh is a pocket context buddy for AI coding tools.
- Source of truth: edit files in .poko/, then run poko sync.
- Local-first behavior is free forever.
`;

export const DEFAULT_STYLE = `# Coding Style

- Use clear names and straightforward control flow.
- Keep comments useful and sparse.
- Prefer deterministic output for generated files.
- Add tests around behavior that may drift across agent formats.
`;

export const DEFAULT_STACK = `# Tech Stack

- Runtime: Bun-first TypeScript.
- CLI: small custom parser.
- Testing: bun test.
- Formatting and linting: Biome.
`;

export const DEFAULT_MCP = `{
  "mcpServers": {}
}
`;

export const DEFAULT_SKILLS_README = `# Poko Skills

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
