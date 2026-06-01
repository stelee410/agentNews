#!/usr/bin/env bash
# Redeploy agentNews to the shared VPS (root@47.79.84.15).
#
# App-only update: pulls the latest code on the server, rebuilds the image, and
# recreates just the `agentnews` container. It does NOT touch agentvoice, the
# nginx edge proxy, or the firewall — those are one-time infra (see DEPLOY.md).
#
#   ./deploy/deploy.sh
#   AGENTNEWS_SERVER=root@host ./deploy/deploy.sh
set -euo pipefail

SERVER="${AGENTNEWS_SERVER:-root@47.79.84.15}"
REMOTE_DIR="${AGENTNEWS_DIR:-/opt/agentNews}"

echo "→ redeploying agentNews on ${SERVER}…"
ssh "$SERVER" "set -e
  cd '$REMOTE_DIR'
  git pull --ff-only
  docker build -t agentnews:latest .
  docker rm -f agentnews 2>/dev/null || true
  docker run -d --name agentnews --restart unless-stopped \
    --network edge \
    -e AGENTNEWS_BASE_URL='https://agentnews.linkyun.co' \
    -v '$REMOTE_DIR/data:/data' \
    agentnews:latest >/dev/null
  sleep 3
  docker run --rm --network edge curlimages/curl:latest -sf --max-time 6 \
    http://agentnews:3000/health >/dev/null \
    && echo '✓ agentnews healthy' \
    || { echo '✗ health check failed — recent logs:'; docker logs agentnews --tail 30; exit 1; }"

echo "✓ deployed → https://agentnews.linkyun.co"
