#!/bin/sh
set -eu

root="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
cd "$root"

"$(dirname "$0")/prepare-standalone.sh"

PORT="${PORT:-3000}"
HOSTNAME="${HOSTNAME:-0.0.0.0}"

while [ $# -gt 0 ]; do
  case "$1" in
    -p|--port)
      if [ $# -lt 2 ]; then
        echo "Missing value for $1" >&2
        exit 1
      fi
      PORT="$2"
      shift 2
      ;;
    -H|--hostname)
      if [ $# -lt 2 ]; then
        echo "Missing value for $1" >&2
        exit 1
      fi
      HOSTNAME="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "${AUTH_DATABASE_PATH:-}" ]; then
  AUTH_DATABASE_PATH="$(CDPATH= cd -- "$root/.." && pwd)/backend/data/app.db"
  export AUTH_DATABASE_PATH
fi

export PORT HOSTNAME
exec node .next/standalone/server.js
