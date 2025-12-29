#!/bin/bash
# Start Expo with fixed cache directory to avoid permission errors

cd "$(dirname "$0")"

# Set cache directory to project folder instead of /tmp
export TMPDIR="$PWD/node_modules/.cache"

# Ensure cache directory exists
mkdir -p "$TMPDIR"
chmod 755 "$TMPDIR"

# Start Expo
exec npx expo start "$@"





