# Native Chat Sync Research

Poko's standout history feature should import conversations into each agent's
native project/session store when that store is local and documented enough to
write safely. Markdown handoffs remain useful as a portable fallback, but they
are not the primary project sync path.

## Working Rules

- Prefer agent-supported import APIs or local server commands when available.
- If direct file or SQLite writes are required, make them deterministic,
  idempotent, and project-scoped.
- Never mutate global history unless the user explicitly asks for a global sync.
- Back up mutable agent databases before the first native write.
- Keep raw captured messages in Poko's local store so native writers can be
  rebuilt as agent formats evolve.

## Current Native Targets

### T3 Code

- Status: implemented as canonical event writes.
- Native store: `~/.t3/userdata/state.sqlite`, or `T3CODE_HOME`/base-dir
  derived equivalents.
- Source of truth: `orchestration_events`. Projection tables are derived and
  should not be the only write target.
- Current approach: append deterministic `project.created`, `thread.created`,
  `thread.message-sent`, `thread.turn-start-requested`, and
  `thread.turn-diff-completed` events.
- Safety note: before writing on macOS, Poko asks a running T3 Code app to quit,
  waits until it is closed, writes the event log, then reopens it. If the app
  does not close in time, Poko skips native T3 chat sync rather than editing a
  live database.

### Codex

- Status: implemented as rollout JSONL writes.
- Native store: JSONL rollouts under
  `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl`, with
  `CODEX_HOME` defaulting to `~/.codex`.
- Source of truth: rollout JSONL. Do not write Codex SQLite state directly.
- Import shape: first line `session_meta` with the project `cwd`, then
  `response_item` user/assistant messages for resume, plus `event_msg` preview
  rows for listing.
- Optional title index: append to `$CODEX_HOME/session_index.jsonl`.
- Safety note: `event_msg` alone is not resumable; `response_item` alone may not
  show a useful preview.

### OpenCode

- Status: implemented through generated export JSON and `opencode import`.
- Preferred path: generate OpenCode export-shaped JSON and run
  `opencode import <file>` from the target project.
- Poko writes the generated import payloads under `.poko/native/opencode/`.
- Native store: OpenCode SQLite database such as `opencode.db`, with
  `OPENCODE_DB` override. Prefer the first-party import command over direct SQL.
- Import shape:
  `{ info: Session.Info, messages: [{ info: MessageV2.Info, parts: MessageV2.Part[] }] }`.
- Idempotency: deterministic `ses_`, `msg_`, and `prt_` ids make repeated import
  mostly a no-op; replace semantics would require deleting Poko-owned rows or a
  direct SQL path.
- Safety note: the import command may not publish live UI bus events, so a
  running OpenCode instance may need refresh or restart.

## App Lifecycle Standard

For native targets that require direct writes to an application's live SQLite
state, Poko uses the same close/sync/reopen lifecycle:

1. Warn that Poko needs to close the app to sync data.
2. Ask the running app to quit.
3. Wait until the app has actually closed.
4. Perform the native history sync.
5. Reopen the app if Poko closed it.

Cursor and T3 Code currently use this flow. Claude Code and Codex are file-based
native writers, while OpenCode uses the first-party `opencode import` command.

### Claude Code

- Status: implemented as project JSONL session files.
- Native store:
  `$CLAUDE_CONFIG_DIR/projects/<encoded-cwd>/<session-uuid>.jsonl`, with
  `CLAUDE_CONFIG_DIR` defaulting to `~/.claude`.
- Project encoding: canonical real project path with non-alphanumeric
  characters replaced by `-`.
- Import shape: one JSON object per line using top-level `type: "user"` or
  `type: "assistant"` entries, stamped with `cwd`, `sessionId`, `uuid`,
  `timestamp`, `userType`, `entrypoint`, `version`, and a linear
  `parentUuid` chain.
- No index write is required; current Claude Code scans JSONL session files.
- Optional metadata rows: `custom-title` and `last-prompt`.
- Safety note: create a new complete file with a unique UUID via temp-file then
  atomic rename. Do not modify or append to an active Claude session.

## Pending Research

- None for the first supported set.
