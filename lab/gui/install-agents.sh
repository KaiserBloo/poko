#!/usr/bin/env bash
set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
TOOLS_DIR="${HOME}/.local/share/poko-agents"
NPM_PREFIX="${HOME}/.local"
ARCH="$(uname -m)"
FORCE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force)
      FORCE=1
      shift
      ;;
    -h|--help)
      cat <<'MSG'
Install supported coding agents into the disposable Poko GUI lab.

Usage:
  /workspace/poko/lab/gui/install-agents.sh [--force]

Installs into:
  ~/.local/bin
  ~/.local/share/poko-agents

T3 Code is skipped on arm64 Linux until an arm64 build or amd64 GUI lane exists.
MSG
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$BIN_DIR" "$TOOLS_DIR"
export PATH="$BIN_DIR:$HOME/.bun/bin:$PATH"
export npm_config_prefix="$NPM_PREFIX"

status() {
  printf '\033[1;36m%s\033[0m\n' "$1"
}

ok() {
  printf '  \033[32m+\033[0m %s\n' "$1"
}

warn() {
  printf '  \033[33m!\033[0m %s\n' "$1"
}

fail() {
  printf '  \033[31mx\033[0m %s\n' "$1"
}

have_working_bin() {
  local bin="$1"
  [[ "$FORCE" -eq 0 ]] && command -v "$bin" >/dev/null 2>&1
}

latest_asset_url() {
  local repo="$1"
  local regex="$2"
  curl -fsSL "https://api.github.com/repos/${repo}/releases/latest" \
    | jq -r --arg regex "$regex" '.assets[] | select(.name | test($regex)) | .browser_download_url' \
    | head -n 1
}

install_tar_asset() {
  local label="$1"
  local repo="$2"
  local regex="$3"
  local bin="$4"
  local url
  local tmp

  if have_working_bin "$bin"; then
    ok "$label already installed at $(command -v "$bin")"
    return 0
  fi

  url="$(latest_asset_url "$repo" "$regex")"
  if [[ -z "$url" || "$url" == "null" ]]; then
    fail "$label release asset not found for /$regex/"
    return 1
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  mkdir -p "$tmp/extract"
  curl -fL "$url" -o "$tmp/agent.tar.gz"
  tar -xzf "$tmp/agent.tar.gz" -C "$tmp/extract"

  local candidate=""
  candidate="$(find "$tmp/extract" -type f -name "$bin" -perm -111 | head -n 1 || true)"
  if [[ -z "$candidate" ]]; then
    candidate="$(find "$tmp/extract" -type f -name "$bin" | head -n 1 || true)"
  fi
  if [[ -z "$candidate" ]]; then
    candidate="$(find "$tmp/extract" -type f -perm -111 | head -n 1 || true)"
  fi
  if [[ -z "$candidate" ]]; then
    fail "$label archive did not contain an executable"
    return 1
  fi

  local candidate_dir
  candidate_dir="$(dirname "$candidate")"
  if [[ -f "$candidate_dir/package.json" ]]; then
    rm -rf "$TOOLS_DIR/$bin"
    mkdir -p "$TOOLS_DIR"
    cp -R "$candidate_dir" "$TOOLS_DIR/$bin"
    chmod +x "$TOOLS_DIR/$bin/$bin"
    ln -sf "$TOOLS_DIR/$bin/$bin" "$BIN_DIR/$bin"
    ok "$label installed at $BIN_DIR/$bin with bundled package files"
  else
    install -m 0755 "$candidate" "$BIN_DIR/$bin"
    ok "$label installed at $BIN_DIR/$bin"
  fi
}

install_npm_global() {
  local label="$1"
  local package="$2"
  local bin="$3"

  if have_working_bin "$bin"; then
    ok "$label already installed at $(command -v "$bin")"
    return 0
  fi

  npm install -g "$package"
  if command -v "$bin" >/dev/null 2>&1; then
    ok "$label installed at $(command -v "$bin")"
  else
    fail "$label npm install completed, but '$bin' was not on PATH"
    return 1
  fi
}

install_opencode_desktop() {
  local label="OpenCode Desktop"

  if [[ "$ARCH" != "aarch64" && "$ARCH" != "arm64" ]]; then
    warn "$label skipped: installer currently targets arm64 lab images"
    return 0
  fi

  if command -v opencode-desktop >/dev/null 2>&1 && [[ "$FORCE" -eq 0 ]]; then
    ok "$label already installed at $(command -v opencode-desktop)"
    return 0
  fi

  local url
  url="$(latest_asset_url "anomalyco/opencode" 'opencode-desktop-linux-arm64\.deb$')"
  if [[ -z "$url" || "$url" == "null" ]]; then
    warn "$label skipped: release .deb not found"
    return 0
  fi

  local tmp
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fL "$url" -o "$tmp/opencode-desktop.deb"

  if [[ "$(id -u)" -eq 0 ]]; then
    apt-get update
    apt-get install -y "$tmp/opencode-desktop.deb"
  elif command -v sudo >/dev/null 2>&1; then
    sudo apt-get update
    sudo apt-get install -y "$tmp/opencode-desktop.deb"
  else
    warn "$label downloaded but not installed: root or sudo is required for .deb"
    return 0
  fi

  if command -v opencode >/dev/null 2>&1; then
    ok "$label installed"
  else
    ok "$label package installed"
  fi
}

install_t3code() {
  if [[ "$ARCH" == "x86_64" || "$ARCH" == "amd64" ]]; then
    local url
    url="$(latest_asset_url "pingdotgg/t3code" 'T3-Code-.*x86_64\.AppImage$')"
    if [[ -z "$url" || "$url" == "null" ]]; then
      warn "T3 Code skipped: Linux AppImage asset not found"
      return 0
    fi
    curl -fL "$url" -o "$BIN_DIR/t3code"
    chmod +x "$BIN_DIR/t3code"
    ok "T3 Code installed at $BIN_DIR/t3code"
  else
    warn "T3 Code skipped: latest Linux build is x86_64 AppImage, but this GUI lab is $ARCH"
  fi
}

status "Installing prerequisites"
if [[ "$(id -u)" -eq 0 ]]; then
  apt-get update
  apt-get install -y ca-certificates curl git jq less tar unzip sqlite3 libfuse2t64
else
  warn "Skipping apt prerequisites because this script is not running as root"
fi

status "Installing Bun"
if command -v bun >/dev/null 2>&1; then
  ok "Bun already installed at $(command -v bun)"
else
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  ok "Bun installed at $(command -v bun)"
fi

status "Installing native release binaries"
case "$ARCH" in
  aarch64|arm64)
    install_tar_asset "Codex CLI" "openai/codex" 'codex-aarch64-unknown-linux-musl\.tar\.gz$' "codex" || true
    install_tar_asset "Claude Code CLI" "anthropics/claude-code" 'claude-linux-arm64\.tar\.gz$' "claude" || true
    install_tar_asset "OpenCode CLI" "anomalyco/opencode" 'opencode-linux-arm64\.tar\.gz$' "opencode" || true
    install_tar_asset "Pi CLI" "earendil-works/pi" 'pi-linux-arm64\.tar\.gz$' "pi" || true
    ;;
  x86_64|amd64)
    install_tar_asset "Codex CLI" "openai/codex" 'codex-x86_64-unknown-linux-musl\.tar\.gz$' "codex" || true
    install_tar_asset "Claude Code CLI" "anthropics/claude-code" 'claude-linux-x64\.tar\.gz$' "claude" || true
    install_tar_asset "OpenCode CLI" "anomalyco/opencode" 'opencode-linux-x64\.tar\.gz$' "opencode" || true
    install_tar_asset "Pi CLI" "earendil-works/pi" 'pi-linux-x64\.tar\.gz$' "pi" || true
    ;;
  *)
    warn "Native release installs skipped for unsupported architecture: $ARCH"
    ;;
esac

status "Installing npm-backed agents"
install_npm_global "Hermes Agent" "hermes-agent" "hermes" || true
install_npm_global "OpenClaw" "openclaw" "openclaw" || true

status "Installing GUI agents"
install_t3code
install_opencode_desktop || true

status "Installed command summary"
for bin in bun codex claude opencode pi hermes openclaw cursor t3code; do
  if command -v "$bin" >/dev/null 2>&1; then
    version="$("$bin" --version 2>/dev/null | head -n 1 || true)"
    if [[ -n "$version" ]]; then
      ok "$bin: $(command -v "$bin") ($version)"
    else
      ok "$bin: $(command -v "$bin")"
    fi
  else
    warn "$bin: not installed"
  fi
done

cat <<'MSG'

Add this to interactive shells in the GUI lab if needed:
  export PATH="$HOME/.local/bin:$HOME/.bun/bin:$PATH"
MSG
