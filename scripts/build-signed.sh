#!/usr/bin/env bash
#
# build-signed.sh — Load Apple Developer credentials from .env and build
# a signed + notarized Snip DMG in one command.
#
# Usage:
#   ./scripts/build-signed.sh                 # build for host arch (arm64 or x64)
#   ./scripts/build-signed.sh --arch x64      # build for Intel
#   ./scripts/build-signed.sh --arch arm64    # build for Apple Silicon
#   ENV_FILE=path/to/.env ./scripts/build-signed.sh  # custom .env path
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${ENV_FILE:-$PROJECT_ROOT/.env}"

# ── Parse --arch flag ─────────────────────────────────────────
TARGET_ARCH=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --arch) TARGET_ARCH="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# Default to host architecture
if [ -z "$TARGET_ARCH" ]; then
  TARGET_ARCH=$(uname -m)
  [ "$TARGET_ARCH" = "x86_64" ] && TARGET_ARCH="x64"
fi

if [ "$TARGET_ARCH" != "arm64" ] && [ "$TARGET_ARCH" != "x64" ]; then
  echo "❌ Unsupported arch: $TARGET_ARCH (use arm64 or x64)"
  exit 1
fi

echo "🎯 Target architecture: $TARGET_ARCH"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env file not found at $ENV_FILE"
  echo "   Create one with CSC_LINK, CSC_KEY_PASSWORD, APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID"
  exit 1
fi

echo "📦 Loading credentials from $ENV_FILE"
set -a
source "$ENV_FILE"
set +a

# ── Validate required env vars ──────────────────────────────────
missing=""
[ -z "${CSC_LINK:-}" ]         && missing="$missing CSC_LINK"
[ -z "${CSC_KEY_PASSWORD:-}" ] && missing="$missing CSC_KEY_PASSWORD"
[ -z "${APPLE_ID:-}" ]         && missing="$missing APPLE_ID"
[ -z "${APPLE_TEAM_ID:-}" ]    && missing="$missing APPLE_TEAM_ID"

[ -z "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] && missing="$missing APPLE_APP_SPECIFIC_PASSWORD"

if [ -n "$missing" ]; then
  echo "❌ Missing required env vars:$missing"
  exit 1
fi

# ── Validate certificate type ───────────────────────────────────
echo "🔍 Validating certificate..."
CERT_INFO=$(echo "$CSC_LINK" | base64 -d | openssl pkcs12 -info -nokeys -passin pass:"${CSC_KEY_PASSWORD}" 2>&1 || true)

if echo "$CERT_INFO" | grep -q "Developer ID Application"; then
  CERT_CN=$(echo "$CERT_INFO" | grep "subject" | head -1)
  echo "   ✅ Developer ID Application certificate found"
  echo "   $CERT_CN"
elif echo "$CERT_INFO" | grep -q "Apple Development"; then
  echo "❌ Certificate is 'Apple Development' — notarization requires 'Developer ID Application'"
  echo "   Create one at: https://developer.apple.com/account/resources/certificates/add"
  exit 1
elif echo "$CERT_INFO" | grep -q "Apple Distribution"; then
  echo "❌ Certificate is 'Apple Distribution' (App Store only) — notarization requires 'Developer ID Application'"
  exit 1
elif echo "$CERT_INFO" | grep -q "3rd Party Mac Developer"; then
  echo "❌ Certificate is '3rd Party Mac Developer' (App Store only) — notarization requires 'Developer ID Application'"
  exit 1
else
  echo "⚠️  Could not determine certificate type. Proceeding anyway..."
  echo "   (If notarization fails, ensure CSC_LINK contains a 'Developer ID Application' .p12)"
fi

cd "$PROJECT_ROOT"

echo ""
echo "🔨 Building native modules for $TARGET_ARCH..."
node-gyp rebuild --arch="$TARGET_ARCH"

echo ""
echo "🏗️  Building signed DMG ($TARGET_ARCH)..."
npx electron-builder --mac --"$TARGET_ARCH"

echo ""
echo "✅ Build complete! Output in dist/"
ls -lh dist/*.dmg 2>/dev/null || echo "(no DMG found — check dist/ manually)"
