#!/usr/bin/env bash
set -euo pipefail

export POKO_LAB_ROOT="${POKO_LAB_ROOT:-/lab-state}"
export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

cd /workspace/poko
bun install
bun lab/poko-lab.ts reset

cat <<'MSG'
Poko GUI lab is ready.

Useful commands:
  bun lab/poko-lab.ts env
  bun lab/poko-lab.ts smoke --write
  bun lab/poko-lab.ts scenario all-to-all --write
  bun lab/poko-lab.ts snapshot-auth --force
  bun lab/poko-lab.ts import-auth --agent cursor,codex,claude,t3code,opencode,pi,hermes,openclaw --force --reset
  /workspace/poko/lab/gui/install-agents.sh

Sign into GUI agents inside this desktop, then run snapshot-auth to save the
baseline. Normal reset restores from that baseline without clearing logins.
MSG
