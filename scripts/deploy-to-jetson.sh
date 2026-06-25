#!/usr/bin/env bash
# Deploy Pilotdeck-upstream to Jetson AGX Orin.
# Run from repo root: ./scripts/deploy-to-jetson.sh

set -euo pipefail

JETSON_HOST="${JETSON_HOST:-modelbest@192.168.20.8}"
REMOTE_DIR="${REMOTE_DIR:-/data/PilotDeck}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Deploy $(git -C "$REPO_ROOT" describe --tags --always) to ${JETSON_HOST}:${REMOTE_DIR}"

rsync -avz --delete \
  --exclude node_modules \
  --exclude ui/node_modules \
  "${REPO_ROOT}/" "${JETSON_HOST}:${REMOTE_DIR}/"

ssh "${JETSON_HOST}" bash -s <<'REMOTE'
set -euo pipefail
export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
source "$NVM_DIR/nvm.sh"
nvm use 22

cd /data/PilotDeck
npm install

pkill -f "/data/PilotDeck/node_modules/.bin/concurrently" 2>/dev/null || true
sleep 2
nohup npm run dev > /data/pilotdeck.log 2>&1 < /dev/null &
disown
sleep 8

echo "==> PilotDeck ports"
ss -tlnp | grep -E "5173|3001|18790" || true
echo "==> Log tail"
tail -8 /data/pilotdeck.log
REMOTE

echo "==> Done. UI: http://192.168.20.8:5173/"
