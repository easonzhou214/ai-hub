#!/bin/bash
# AI Hub double-click launcher
# Double-click to open Terminal and run the local server. Keep this window open
# while using AI Hub. Close the window or press Ctrl+C to stop the server.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

URL="http://127.0.0.1:5173/"
API="http://127.0.0.1:5173/api/cc-switch/providers"

pause_on_exit() {
  local status=$?
  echo
  if [ "$status" -eq 0 ]; then
    echo "AI Hub stopped."
  else
    echo "AI Hub stopped (exit code $status)."
  fi
  read -r -p "Press Enter to close this window..." _
}
trap pause_on_exit EXIT

echo "=========================================="
echo "  AI Hub"
echo "=========================================="
echo

# Include standard macOS Node installations when launched from Finder.
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# Prefer the known Node 22.22.3 from nvm. The project needs Node 22.13+
# because the local bridge uses node:sqlite.
NODE_DIR="$HOME/.nvm/versions/node/v22.22.3/bin"
if [ -x "$NODE_DIR/node" ]; then
  export PATH="$NODE_DIR:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Please install Node 22.13 or newer."
  exit 1
fi

NODE_VERSION="$(node -p 'process.versions.node' 2>/dev/null)"
NODE_MAJOR="${NODE_VERSION%%.*}"
NODE_REST="${NODE_VERSION#*.}"
NODE_MINOR="${NODE_REST%%.*}"
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 13 ]; }; then
  echo "Node $NODE_VERSION is too old. Please install Node 22.13 or newer."
  exit 1
fi
echo "Node: $NODE_VERSION"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Please check your Node/npm installation."
  exit 1
fi

# Starting a second server would fail on port 5173. If AI Hub is already
# running, just open the browser.
if curl -fsS --max-time 1 "$API" >/dev/null 2>&1; then
  echo "AI Hub is already running. Opening the browser..."
  open "$URL"
  sleep 1
  trap - EXIT
  exit 0
fi

if [ ! -d node_modules ]; then
  echo "First start: installing dependencies..."
  if ! npm install; then
    echo
    echo "Dependency installation failed. Check your network and try again."
    exit 1
  fi
fi

open_when_ready() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS --max-time 1 "$API" >/dev/null 2>&1; then
      open "$URL"
      return
    fi
    sleep 0.5
  done
}
open_when_ready &

echo
echo "Starting: $URL"
echo "Keep this Terminal window open. Close it or press Ctrl+C to stop."
echo

npm run dev
