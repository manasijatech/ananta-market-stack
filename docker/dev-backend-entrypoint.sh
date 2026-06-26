#!/bin/sh
set -eu

mkdir -p /app/data

python -c "from db.session import init_db; init_db()"

exec "$@"
