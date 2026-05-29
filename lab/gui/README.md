# Poko GUI Lab

The headless lab proves storage conversion. The GUI lab is for the final visual
check: open the app, confirm imported chats appear, then reset and repeat.

Start the noVNC desktop:

```sh
docker compose -f lab/docker-compose.gui.yml up
```

Open:

```text
http://localhost:3001
```

Inside the desktop terminal:

```sh
/workspace/poko/lab/gui/bootstrap.sh
```

Install supported agents inside the desktop:

```sh
/workspace/poko/lab/gui/install-agents.sh
```

The installer keeps tools under `~/.local`, prints a command summary, and can be
re-run with `--force`. It installs native arm64 builds for Codex, Claude Code,
OpenCode, and Pi where available, plus npm-backed Hermes/OpenClaw packages. T3
Code is skipped in the default arm64 GUI lab because its current Linux release is
an x86_64 AppImage; use a future amd64 lab lane for that visual test.

The GUI container maps `/lab-state` to `~/.poko/lab` on the host. That means
profiles, reports, and signed-in baselines survive container deletion, while the
container itself stays disposable.

## Signed-In Baseline

1. Start the GUI desktop.
2. Run `bun lab/poko-lab.ts reset`.
3. Sign into the agent apps inside the desktop.
4. Run `bun lab/poko-lab.ts snapshot-auth --force`.
5. Use `bun lab/poko-lab.ts scenario all-to-all --write` for repeated tests.

If an app login flow fails inside noVNC, import auth/profile state from the host
Mac into the lab baseline instead:

```sh
bun lab/poko-lab.ts import-auth --agent cursor,codex,claude,t3code,opencode,pi,hermes,openclaw --force --reset
```

The imported state stays under `~/.poko/lab` and is copied into the disposable
run home on reset. Do not commit anything from that directory.

Normal reset keeps the baseline:

```sh
bun lab/poko-lab.ts reset
```

Full auth deletion is explicit:

```sh
bun lab/poko-lab.ts reset --include-auth --yes
```

## App Notes

Cursor's Linux GUI should be tested in this lane because CLI and GUI state
sharing is not something we should assume. When launching Cursor in this
disposable desktop, use `--password-store=basic` so the container does not block
on an OS keyring prompt.

Codex/Claude/OpenCode/Pi/Hermes/OpenClaw can be exercised headlessly first,
then visually checked here when they expose a GUI or local TUI that reads the
same state.
