#!/bin/bash
#
# Downloads the Ollama binary for macOS and pulls the default vision model.
# Run once during development:  ./scripts/download-ollama.sh
#
# Usage:
#   ./scripts/download-ollama.sh                  # defaults: v0.17.4 binary, minicpm-v model
#   ./scripts/download-ollama.sh v0.18.0          # specific binary version
#   ./scripts/download-ollama.sh v0.17.4 llava    # specific version + model
#   ./scripts/download-ollama.sh --force           # force re-pull model
#
set -euo pipefail

VERSION="${1:-v0.17.4}"
MODEL="${2:-minicpm-v}"
FORCE=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENDOR_ABS="$PROJECT_DIR/vendor/ollama"

# Parse --force flag
for arg in "$@"; do
  if [ "$arg" = "--force" ]; then
    FORCE=1
    if [ "$1" = "--force" ]; then
      VERSION="v0.17.4"
      MODEL="minicpm-v"
    fi
  fi
done

echo "==> Ollama binary version: $VERSION"
echo "==> Default model: $MODEL"
echo "==> Destination: $VENDOR_ABS"

# ---------------------------------------------------------------
# 1. Download binary
# ---------------------------------------------------------------
mkdir -p "$VENDOR_ABS"

if [ -f "$VENDOR_ABS/ollama" ] && file "$VENDOR_ABS/ollama" | grep -q "Mach-O"; then
  echo "==> Binary already exists — skipping download"
else
  echo "==> Downloading Ollama binary (ollama-darwin.tgz)..."
  TMPFILE=$(mktemp /tmp/ollama-darwin.XXXXXX.tgz)
  curl -L --progress-bar \
    "https://github.com/ollama/ollama/releases/download/${VERSION}/ollama-darwin.tgz" \
    -o "$TMPFILE"
  echo "==> Extracting..."
  tar -xzf "$TMPFILE" -C "$VENDOR_ABS"
  rm -f "$TMPFILE"
  chmod +x "$VENDOR_ABS/ollama"
  echo "==> Binary extracted"
fi

# ---------------------------------------------------------------
# 2. Pull default vision model (minicpm-v)
# ---------------------------------------------------------------
MODELS_DIR="$VENDOR_ABS/models"
mkdir -p "$MODELS_DIR"

# Clean partial downloads
PARTIALS=$(find "$MODELS_DIR" -name "*-partial*" 2>/dev/null | wc -l | tr -d ' ')
if [ "$PARTIALS" -gt 0 ] || [ "$FORCE" -eq 1 ]; then
  echo "==> Cleaning $PARTIALS partial blob(s)..."
  find "$MODELS_DIR" -name "*-partial*" -delete 2>/dev/null || true
  find "$MODELS_DIR/manifests" -type d -empty -delete 2>/dev/null || true
fi

MANIFEST_DIR="$MODELS_DIR/manifests/registry.ollama.ai/library/$MODEL"
if [ -d "$MANIFEST_DIR" ] && [ "$(ls -A "$MANIFEST_DIR" 2>/dev/null)" ] && [ "$FORCE" -eq 0 ]; then
  echo "==> Model '$MODEL' already exists — skipping (use --force to re-pull)"
else
  echo "==> Starting temporary Ollama server to pull model..."
  export OLLAMA_MODELS="$MODELS_DIR"
  export OLLAMA_HOST="127.0.0.1:11435"

  "$VENDOR_ABS/ollama" serve &
  OLLAMA_PID=$!
  trap "kill $OLLAMA_PID 2>/dev/null; wait $OLLAMA_PID 2>/dev/null || true" EXIT

  echo "==> Waiting for server..."
  for i in $(seq 1 30); do
    if curl -s "http://127.0.0.1:11435/api/version" > /dev/null 2>&1; then
      echo "==> Server ready"
      break
    fi
    sleep 1
  done

  echo "==> Pulling model '$MODEL' (this may take a while for large models)..."
  "$VENDOR_ABS/ollama" pull "$MODEL"

  echo "==> Stopping temporary server..."
  kill $OLLAMA_PID 2>/dev/null || true
  wait $OLLAMA_PID 2>/dev/null || true
  trap - EXIT
  echo "==> Model pulled successfully"
fi

# ---------------------------------------------------------------
# Summary
# ---------------------------------------------------------------
echo ""
echo "==> Done!"
du -sh "$VENDOR_ABS/ollama"
du -sh "$VENDOR_ABS/models" 2>/dev/null || echo "  (no models)"
echo ""
echo "The app will bundle these files via extraResources."
