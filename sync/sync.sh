#!/bin/bash
set -euo pipefail

# sync.sh — Extracts Apple Notes content and syncs to the website.
# Invoked by launchd every 5 minutes.
#
# Required environment variables:
#   SYNC_AUTH_TOKEN  — Bearer token for the /sync Worker endpoint
#   SYNC_URL        — Full URL of the /sync endpoint (e.g. https://iselodyhereyet-sms.<subdomain>.workers.dev/sync)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="/tmp/iselodyhereyet-sync"
HASH_FILE="$HOME/.iselodyhereyet-sync-hash"

if [ -z "${SYNC_AUTH_TOKEN:-}" ]; then
  echo "Error: SYNC_AUTH_TOKEN is not set" >&2
  exit 1
fi

if [ -z "${SYNC_URL:-}" ]; then
  echo "Error: SYNC_URL is not set" >&2
  exit 1
fi

# Step 1: Run the AppleScript to extract note HTML and images
echo "Extracting note from Apple Notes..."
extract_output=$(osascript -l JavaScript "$SCRIPT_DIR/extract-note.js" "$OUTPUT_DIR")

html_path=$(echo "$extract_output" | python3 -c "import sys,json; print(json.load(sys.stdin)['html_path'])")
images_json=$(echo "$extract_output" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)['images']))")

# Step 2: Build the JSON payload with base64-encoded images
# Write payload directly to file to avoid shell argument length limits with large images
payload_file="$OUTPUT_DIR/payload.json"
echo "$images_json" | python3 -c "
import sys, json, base64
images = json.load(sys.stdin)
html = open(sys.argv[1]).read()
result = []
for img in images:
    with open(img['path'], 'rb') as f:
        b64 = base64.b64encode(f.read()).decode('ascii')
    result.append({'name': img['name'], 'data': b64})
with open(sys.argv[2], 'w') as f:
    json.dump({'html': html, 'images': result}, f)
" "$html_path" "$payload_file"

# Step 3: Hash the payload and compare against cached hash
current_hash=$(shasum -a 256 "$payload_file" | cut -d' ' -f1)
previous_hash=""
if [ -f "$HASH_FILE" ]; then
  previous_hash=$(cat "$HASH_FILE")
fi

if [ "$current_hash" = "$previous_hash" ]; then
  echo "No changes detected, skipping sync."
  exit 0
fi

# Step 4: POST to the /sync endpoint
echo "Changes detected, syncing..."
http_status=$(curl -s -o /tmp/iselodyhereyet-sync-response -w "%{http_code}" \
  -X POST "$SYNC_URL" \
  -H "Authorization: Bearer $SYNC_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d @"$payload_file")

if [ "$http_status" -eq 200 ]; then
  echo "Sync successful."
  echo "$current_hash" > "$HASH_FILE"
else
  echo "Sync failed with HTTP $http_status:" >&2
  cat /tmp/iselodyhereyet-sync-response >&2
  exit 1
fi
