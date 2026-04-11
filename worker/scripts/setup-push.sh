#!/usr/bin/env bash
set -euo pipefail

# Setup script for Web Push Notifications (Issue #4, Task #5)
# Generates VAPID keys, creates KV namespace, sets worker secrets, updates config files, and deploys.
#
# Usage: bash worker/scripts/setup-push.sh
# Run from the repo root directory.

WORKER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$WORKER_DIR/.." && pwd)"
WRANGLER="npx wrangler"

echo "=== Web Push Notification Setup ==="
echo

# Step 1: Generate VAPID keys
echo "Step 1: Generating VAPID keys..."
VAPID_OUTPUT=$(node "$WORKER_DIR/scripts/generate-vapid-keys.js" 2>&1)
VAPID_PUBLIC_KEY=$(echo "$VAPID_OUTPUT" | grep '^VAPID_PUBLIC_KEY=' | cut -d= -f2)
VAPID_PRIVATE_KEY=$(echo "$VAPID_OUTPUT" | grep '^VAPID_PRIVATE_KEY=' | cut -d= -f2)

if [ -z "$VAPID_PUBLIC_KEY" ] || [ -z "$VAPID_PRIVATE_KEY" ]; then
  echo "ERROR: Failed to generate VAPID keys"
  exit 1
fi

echo "  Public key:  ${VAPID_PUBLIC_KEY:0:20}..."
echo "  Private key: ${VAPID_PRIVATE_KEY:0:10}... (will be stored as secret)"
echo

# Step 2: Create KV namespace (if needed)
echo "Step 2: Creating KV namespace..."
EXISTING_ID=$(cd "$WORKER_DIR" && $WRANGLER kv namespace list 2>/dev/null | grep -A1 '"title": "iselodyhereyet-sms-PUSH_SUBSCRIPTIONS"' | grep '"id"' | sed 's/.*"id": "//;s/".*//' || true)

if [ -n "$EXISTING_ID" ]; then
  KV_ID="$EXISTING_ID"
  echo "  KV namespace already exists: $KV_ID"
else
  KV_CREATE_OUTPUT=$(cd "$WORKER_DIR" && $WRANGLER kv namespace create PUSH_SUBSCRIPTIONS 2>&1)
  KV_ID=$(echo "$KV_CREATE_OUTPUT" | grep -o 'id = "[^"]*"' | sed 's/id = "//;s/"//')
  if [ -z "$KV_ID" ]; then
    echo "ERROR: Failed to create KV namespace. Output:"
    echo "$KV_CREATE_OUTPUT"
    exit 1
  fi
  echo "  Created KV namespace: $KV_ID"
fi
echo

# Step 3: Update wrangler.toml with real KV namespace ID
echo "Step 3: Updating wrangler.toml..."
sed -i '' "s/id = \"placeholder-create-with-wrangler\"/id = \"$KV_ID\"/" "$WORKER_DIR/wrangler.toml"
echo "  Updated KV namespace ID in wrangler.toml"
echo

# Step 4: Update index.html with production VAPID public key
echo "Step 4: Updating index.html with VAPID public key..."
sed -i '' "s|// TODO: Replace with your production VAPID public key and worker URL||" "$REPO_ROOT/index.html"
sed -i '' "s|var VAPID_PUBLIC_KEY = '[^']*'|var VAPID_PUBLIC_KEY = '$VAPID_PUBLIC_KEY'|" "$REPO_ROOT/index.html"
echo "  Updated VAPID public key in index.html"
echo

# Step 5: Set worker secrets
echo "Step 5: Setting worker secrets..."
cd "$WORKER_DIR"
echo "$VAPID_PRIVATE_KEY" | $WRANGLER secret put VAPID_PRIVATE_KEY
echo "$VAPID_PUBLIC_KEY" | $WRANGLER secret put VAPID_PUBLIC_KEY
echo "  Secrets set successfully"
echo

# Step 6: Deploy worker
echo "Step 6: Deploying worker..."
cd "$WORKER_DIR"
$WRANGLER deploy
echo

echo "=== Setup complete! ==="
echo
echo "VAPID public key (save this — needed if you re-deploy index.html):"
echo "  $VAPID_PUBLIC_KEY"
echo
echo "To verify:"
echo "  curl -X OPTIONS https://iselodyhereyet-sms.lucky-night-372b.workers.dev/subscribe -v"
