#!/usr/bin/env bash
#
# Proxy server startup script (WSL / bash)
#
# Usage:
#   ./start-proxy.sh              # Start on PORT=18080
#   PORT=9000 ./start-proxy.sh    # Start on a specific port
#
# Stop: Ctrl + C
#
set -euo pipefail

# Navigate to the directory containing this script (proxy-server/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Port (prioritize PORT environment variable, default to 18080)
PORT="${PORT:-18080}"

# Check for Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "Error: node not found. Please install Node.js." >&2
  exit 1
fi

# Install dependencies if node_modules is missing
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

echo "Starting proxy server: http://localhost:${PORT}"
echo "Press Ctrl + C to stop."
echo

exec env PORT="$PORT" node server.js
