<!-- poko:start -->
# Poko Conventions

## Project Rules

- Prefer small, well-tested changes.
- Follow the existing architecture and naming conventions before adding new patterns.
- Keep generated files, secrets, and machine-specific state out of commits.
- Explain risky tradeoffs before making broad changes.

## Coding Style

- Use clear names and straightforward control flow.
- Keep comments useful and sparse.
- Prefer deterministic output for generated files.
- Add tests around behavior that may drift across agent formats.

## Tech Stack

- Runtime: Bun-first TypeScript.
- CLI: small custom parser.
- Testing: bun test.
- Formatting and linting: Biome.

## Project Memory

- Product: poko.sh is a pocket context buddy for AI coding tools.
- Source of truth: edit files in .poko/, then run poko sync.
- Local-first behavior is free forever.
<!-- poko:end -->
