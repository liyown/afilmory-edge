#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
WEB_DIST="$ROOT_DIR/apps/web/dist"
DASHBOARD_DIST="$ROOT_DIR/be/apps/dashboard/dist"
PUBLIC_DIR="$ROOT_DIR/apps/edge/public"

for dist in "$WEB_DIST" "$DASHBOARD_DIST"; do
  if [ ! -d "$dist" ]; then
    echo "Missing build output: $dist" >&2
    echo "Run pnpm build:web and pnpm build:dashboard first." >&2
    exit 1
  fi
done

rm -rf "$PUBLIC_DIR"
mkdir -p "$PUBLIC_DIR/platform"

# The gallery SPA owns the Worker root; the dashboard is built with base /platform/.
cp -R "$WEB_DIST"/. "$PUBLIC_DIR"/
cp -R "$DASHBOARD_DIST"/. "$PUBLIC_DIR/platform"/

echo "Synced assets into $PUBLIC_DIR"
