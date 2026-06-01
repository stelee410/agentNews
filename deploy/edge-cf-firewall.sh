#!/usr/bin/env bash
# Lock the shared edge proxy (nginx on :80) so only Cloudflare (+ loopback/
# private) can reach it — stops anyone hitting the raw origin IP and bypassing
# Cloudflare. Rules go in Docker's DOCKER-USER chain (the supported hook for -p
# published ports). Independent of agentVoice's firewall (distinct TAG), so an
# agentVoice redeploy cannot disturb these rules.
#   Re-run any time to refresh CF ranges.  Remove with: EDGE_FW=off ./cf-origin-firewall.sh
set -uo pipefail
PORT="${EDGE_PROXY_PORT:-80}"
TAG="edge-cf"

del_tagged() {
  local ipt="$1" spec
  while $ipt -S DOCKER-USER 2>/dev/null | grep -q -- "$TAG"; do
    spec="$($ipt -S DOCKER-USER 2>/dev/null | grep -- "$TAG" | head -1 | sed 's/^-A DOCKER-USER //')"
    [ -z "$spec" ] && break
    # shellcheck disable=SC2086
    $ipt -D DOCKER-USER $spec 2>/dev/null || break
  done
}
allow_then_drop() {
  local ipt="$1"; shift
  del_tagged "$ipt"
  $ipt -I DOCKER-USER -p tcp --dport "$PORT" -m comment --comment "$TAG" -j DROP
  local cidr
  for cidr in "$@"; do
    $ipt -I DOCKER-USER -p tcp --dport "$PORT" -s "$cidr" -m comment --comment "$TAG" -j RETURN
  done
}
if [ "${EDGE_FW:-on}" = "off" ]; then
  del_tagged iptables; command -v ip6tables >/dev/null && del_tagged ip6tables
  echo "edge origin firewall REMOVED (port $PORT open again)"; exit 0
fi
CF4="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v4 || true)"
CF6="$(curl -fsS --max-time 15 https://www.cloudflare.com/ips-v6 || true)"
if [ -z "$CF4" ]; then
  echo "WARN: could not fetch Cloudflare IPv4 ranges; leaving firewall unchanged (fail-open)" >&2
  exit 0
fi
# shellcheck disable=SC2086
allow_then_drop iptables 127.0.0.0/8 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 $CF4
if [ -n "$CF6" ] && command -v ip6tables >/dev/null 2>&1; then
  # shellcheck disable=SC2086
  allow_then_drop ip6tables ::1/128 fc00::/7 fe80::/10 $CF6 2>/dev/null || true
fi
echo "edge origin firewall applied — only Cloudflare + private may reach tcp/$PORT"
