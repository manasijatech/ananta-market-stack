#!/bin/sh
set -eu

load_generated_env() {
  if [ ! -f /config/market-stack.env ]; then
    return
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ""|\#*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    eval current="\${$key:-}"
    if [ -z "$current" ]; then
      export "$key=$value"
    fi
  done < /config/market-stack.env
}

load_generated_env

mkdir -p /data

exec "$@"
