#!/usr/bin/env bash
# ============================================================
#  start.sh — Install dependencies & start all services
#  Tested on Ubuntu 20.04 / 22.04 / 24.04
#  Run as root or a user with package-install privileges.
# ============================================================
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
err()     { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── Load .env ─────────────────────────────────────────────────
if [ -f .env ]; then
  info "Loading .env"
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
else
  warn ".env not found — copy .env.example to .env and fill in EMAIL, PASSWORD"
  warn "Using defaults (PORT=25515)"
fi

PORT="${PORT:-25515}"

# ── Validate required vars ────────────────────────────────────
[ -z "${EMAIL:-}" ]    && err "EMAIL is not set in .env"
[ -z "${PASSWORD:-}" ] && err "PASSWORD is not set in .env"

# ── System dependencies ───────────────────────────────────────
step "Installing system dependencies"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

# Core tools
apt-get install -y -qq curl wget gnupg ca-certificates lsb-release apt-transport-https

# Xvfb and X11 runtime libraries needed by Chrome
apt-get install -y -qq \
  xvfb \
  libx11-xcb1 \
  libxcomposite1 \
  libxcursor1 \
  libxdamage1 \
  libxfixes3 \
  libxi6 \
  libxrandr2 \
  libxss1 \
  libxtst6 \
  libnss3 \
  libatk1.0-0 \
  libatk-bridge2.0-0 \
  libcups2 \
  libdrm2 \
  libgbm1 \
  libxkbcommon0 \
  libgtk-3-0 \
  libasound2 \
  fonts-liberation \
  libappindicator3-1 \
  xdg-utils 2>/dev/null || true

success "System packages ready"

# ── Google Chrome Stable ──────────────────────────────────────
# We install the real .deb from Google — NOT snap chromium-browser.
# Ubuntu ≥22.04's /usr/bin/chromium-browser is a snap wrapper that
# cannot forward --remote-debugging-port, causing ECONNREFUSED errors.
step "Installing Google Chrome Stable"

if command -v google-chrome-stable &>/dev/null || command -v google-chrome &>/dev/null; then
  CHROME_VER=$(google-chrome-stable --version 2>/dev/null || google-chrome --version 2>/dev/null)
  success "Google Chrome already installed: ${CHROME_VER}"
else
  info "Adding Google apt repo…"
  wget -q -O /tmp/google-chrome.gpg https://dl.google.com/linux/linux_signing_key.pub
  gpg --dearmor < /tmp/google-chrome.gpg > /usr/share/keyrings/google-chrome-keyring.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome-keyring.gpg] \
    https://dl.google.com/linux/chrome/deb/ stable main" \
    > /etc/apt/sources.list.d/google-chrome.list
  apt-get update -qq
  apt-get install -y -qq google-chrome-stable
  CHROME_VER=$(google-chrome-stable --version 2>/dev/null)
  success "Installed: ${CHROME_VER}"
fi

# ── Node.js ───────────────────────────────────────────────────
step "Checking Node.js"

if ! command -v node &>/dev/null; then
  info "Node.js not found — installing Node.js 20 via NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs
fi

NODE_VER=$(node --version)
success "Node.js ${NODE_VER}"

# ── pnpm ──────────────────────────────────────────────────────
step "Checking pnpm"

if ! command -v pnpm &>/dev/null; then
  info "pnpm not found — installing via npm"
  npm install -g pnpm --quiet
fi

PNPM_VER=$(pnpm --version)
success "pnpm ${PNPM_VER}"

# ── Project dependencies ──────────────────────────────────────
step "Installing project dependencies"
pnpm install --frozen-lockfile 2>&1 | tail -5
success "Dependencies installed"

# ── Build API server ──────────────────────────────────────────
step "Building API server"
pnpm --filter @workspace/api-server run build 2>&1 | tail -10
success "API server built"

# ── PID tracking ─────────────────────────────────────────────
PIDS=()
XVFB_PID=""

cleanup() {
  echo -e "\n${YELLOW}Shutting down…${NC}"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  [ -n "$XVFB_PID" ] && kill "$XVFB_PID" 2>/dev/null || true
  echo -e "${GREEN}All services stopped.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM

# ── Xvfb virtual display ──────────────────────────────────────
step "Starting Xvfb (virtual display for Chrome)"

DISPLAY_NUM=99
if pgrep -x Xvfb &>/dev/null; then
  success "Xvfb already running"
else
  Xvfb ":${DISPLAY_NUM}" -screen 0 1280x800x24 -ac &
  XVFB_PID=$!
  sleep 1
  if kill -0 "$XVFB_PID" 2>/dev/null; then
    success "Xvfb started on :${DISPLAY_NUM} (PID ${XVFB_PID})"
  else
    warn "Xvfb failed to start — Chrome will try to manage its own display"
    DISPLAY_NUM=""
  fi
fi

[ -n "$DISPLAY_NUM" ] && export DISPLAY=":${DISPLAY_NUM}"

# ── API server ────────────────────────────────────────────────
step "Starting API + Dashboard server"

mkdir -p logs
LOG_API="logs/api-server.log"

PORT="${PORT}" \
EMAIL="${EMAIL}" \
PASSWORD="${PASSWORD}" \
  node --enable-source-maps artifacts/api-server/dist/index.mjs >> "${LOG_API}" 2>&1 &

API_PID=$!
PIDS+=("$API_PID")
sleep 2

if kill -0 "$API_PID" 2>/dev/null; then
  success "API server running (PID ${API_PID}) → log: ${LOG_API}"
else
  err "API server failed to start. Check ${LOG_API}"
fi

# ── AFK Bot ───────────────────────────────────────────────────
step "Starting AFK Bot"

LOG_BOT="logs/afk-bot.log"

EMAIL="${EMAIL}" \
PASSWORD="${PASSWORD}" \
${DISPLAY:+DISPLAY="${DISPLAY}"} \
  pnpm --filter @workspace/scripts run afk-bot >> "${LOG_BOT}" 2>&1 &

BOT_PID=$!
PIDS+=("$BOT_PID")
sleep 2

if kill -0 "$BOT_PID" 2>/dev/null; then
  success "AFK bot running (PID ${BOT_PID}) → log: ${LOG_BOT}"
else
  err "AFK bot failed to start. Check ${LOG_BOT}"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}  All services started successfully!${NC}"
echo -e "${BOLD}${GREEN}════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Dashboard:${NC}   ${BLUE}http://localhost:${PORT}/${NC}"
echo -e "  ${BOLD}Bot status:${NC}  ${BLUE}http://localhost:${PORT}/api/bot/status${NC}"
echo -e "  ${BOLD}API health:${NC}  ${BLUE}http://localhost:${PORT}/api/healthz${NC}"
echo ""
echo -e "  ${BOLD}Logs:${NC}"
echo -e "    API server → ${CYAN}${LOG_API}${NC}"
echo -e "    AFK bot    → ${CYAN}${LOG_BOT}${NC}"
echo ""
echo -e "  ${YELLOW}Press Ctrl+C to stop all services${NC}"
echo ""

# ── Follow bot log live ───────────────────────────────────────
tail -f "${LOG_BOT}" &
TAIL_PID=$!
PIDS+=("$TAIL_PID")

# Wait for any service to exit unexpectedly
wait -n "${API_PID}" "${BOT_PID}" 2>/dev/null || true
echo -e "\n${RED}A service exited unexpectedly.${NC}"
cleanup
