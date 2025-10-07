#!/usr/bin/env bash
set -euo pipefail

# Resolve repository root relative to this script
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

# Ensure dependencies are installed before starting the dev server
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies (node_modules not found)..."
  npm install
fi

HOST=${HOST:-127.0.0.1}
PORT=${PORT:-5173}
EXTRA_ARGS=()

if [ -n "${VITE_DEV_ARGS:-}" ]; then
  # Allow callers to pass additional arguments to the Vite dev server
  # as a single space-separated string, e.g. "--host 0.0.0.0 --open".
  # shellcheck disable=SC2206
  EXTRA_ARGS=(${VITE_DEV_ARGS})
fi

# Start the dev server in the background so we can open the browser after it is ready.
echo "Starting dev server on http://${HOST}:${PORT} ..."
nohup npm run dev -- --host "$HOST" --port "$PORT" "${EXTRA_ARGS[@]}" >/tmp/vite-dev.log 2>&1 &
DEV_PID=$!

echo "Dev server PID: $DEV_PID"

cleanup() {
  if ps -p $DEV_PID > /dev/null 2>&1; then
    echo "Stopping dev server (PID $DEV_PID)..."
    kill $DEV_PID 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Wait until the server responds before opening the browser.
ATTEMPTS=0
MAX_ATTEMPTS=${MAX_ATTEMPTS:-60}
SLEEP_SECONDS=${SLEEP_SECONDS:-1}

until curl -s "http://$HOST:$PORT" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "Dev server did not start within $((MAX_ATTEMPTS * SLEEP_SECONDS)) seconds."
    wait $DEV_PID || true
    exit 1
  fi
  sleep "$SLEEP_SECONDS"
done

echo "Dev server is running. Opening browser..."

open_in_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$url" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then
    open "$url" &
  elif command -v start >/dev/null 2>&1; then
    start "$url" &
  else
    echo "Could not find a command to open the browser automatically."
    echo "Please open $url manually."
    return 1
  fi
  return 0
}

open_in_browser "http://$HOST:$PORT" || true

echo "Streaming dev server logs. Press Ctrl+C to stop."
tail -f /tmp/vite-dev.log &
TAIL_PID=$!
wait $DEV_PID
kill $TAIL_PID 2>/dev/null || true
