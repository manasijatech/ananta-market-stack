#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
standalone="$root/.next/standalone"

if [ ! -f "$standalone/server.js" ]; then
  echo "Missing $standalone/server.js — run \"npm run build\" first." >&2
  exit 1
fi

mkdir -p "$standalone/.next"

if [ -d "$root/.next/static" ]; then
  rm -rf "$standalone/.next/static"
  cp -R "$root/.next/static" "$standalone/.next/static"
fi

if [ -d "$root/public" ]; then
  rm -rf "$standalone/public"
  cp -R "$root/public" "$standalone/public"
fi
