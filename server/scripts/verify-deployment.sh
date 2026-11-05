#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${SPHERELAB_URL:-http://127.0.0.1:8787}"
MANIFEST_PATH="${SPHERELAB_MANIFEST:-/data/media/tile-manifest.json}"

health="$(curl --fail --silent "$BASE_URL/health")"
printf '%s\n' "$health"
printf '%s' "$health" | grep -q '"executable":true' || {
  echo "renderer executable is not ready" >&2
  exit 1
}

curl --fail --silent -X POST "$BASE_URL/api/media/tile-manifest" \
  -H 'content-type: application/json' \
  -d "$(printf '{\"path\":\"%s\",\"checkFiles\":true,\"frame\":0}' "$MANIFEST_PATH")"
printf '\n'
preview="$(curl --fail --silent "$BASE_URL/preview")"
printf '%s' "$preview" | grep -q 'native-tiles'
echo "SphereLab server deployment checks passed; open $BASE_URL/preview for the WebRTC tile handshake."
