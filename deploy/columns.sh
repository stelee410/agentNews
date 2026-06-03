#!/usr/bin/env bash
# Define / re-sync agentNews columns (content types) and their order.
# Idempotent: creates missing types, updates labels+position+enabled for
# existing ones, and disables retired defaults.
#
#   AGENTNEWS_ADMIN_KEY=an_admin_xxx ./deploy/columns.sh
#   AGENTNEWS_BASE=https://agentnews.linkyun.co AGENTNEWS_ADMIN_KEY=... ./deploy/columns.sh
set -euo pipefail

BASE="${AGENTNEWS_BASE:-https://agentnews.linkyun.co}"
KEY="${AGENTNEWS_ADMIN_KEY:?set AGENTNEWS_ADMIN_KEY to an admin key}"
AUTH=(-H "authorization: Bearer ${KEY}" -H "content-type: application/json")

# Desired columns, in display order:  key|label_zh|label_en|position
COLUMNS=(
  "perspective|视角|Perspective|1"
  "headline|今日头条|Today's Headlines|2"
  "ai-news|AI新闻热点|AI News|3"
  "society|社会新闻|Society|4"
  "electronics|消费电子|Consumer Electronics|5"
  "finance|金融和区块链|Finance & Blockchain|6"
  "philosophy-art|哲学艺术|Philosophy & Art|7"
  "creative|创作|Creative|8"
)
# Legacy default types to retire (kept in DB, hidden from columns):
RETIRE=(news hotspot blog deepread)

upsert() {
  local key="$1" zh="$2" en="$3" pos="$4"
  local body
  body=$(printf '{"key":"%s","label_zh":"%s","label_en":"%s","position":%s}' "$key" "$zh" "$en" "$pos")
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "${BASE}/api/v1/types" "${AUTH[@]}" -d "$body")
  if [ "$code" = "201" ]; then
    echo "  created  $key (pos $pos)"
  elif [ "$code" = "409" ]; then
    # already exists -> patch labels + position + ensure enabled
    local pbody
    pbody=$(printf '{"label_zh":"%s","label_en":"%s","position":%s,"enabled":true}' "$zh" "$en" "$pos")
    curl -s -o /dev/null --max-time 15 -X PATCH "${BASE}/api/v1/types/${key}" "${AUTH[@]}" -d "$pbody"
    echo "  updated  $key (pos $pos)"
  else
    echo "  ERROR    $key -> HTTP $code"; exit 1
  fi
}

echo "→ syncing columns on ${BASE}"
for row in "${COLUMNS[@]}"; do
  IFS='|' read -r key zh en pos <<<"$row"
  upsert "$key" "$zh" "$en" "$pos"
done

echo "→ retiring legacy defaults"
for key in "${RETIRE[@]}"; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "${BASE}/api/v1/types/${key}/disable" "${AUTH[@]}")
  echo "  disabled $key -> HTTP $code"
done

echo "✓ done. Current columns:"
curl -s --max-time 12 "${BASE}/api/v1/types" \
  | python3 -c "import sys,json;[print(f\"  {t['position']:>3}  {t['key']:<14} {t['label_zh']} / {t['label_en']}  enabled={t['enabled']}\") for t in sorted(json.load(sys.stdin)['types'], key=lambda x:(x['position'],x['key']))]"
