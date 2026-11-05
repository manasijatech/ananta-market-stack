#!/bin/sh
# Prepare the shared socket directory and a token the backend can read.
# The guest never receives this environment; main.py drops to nobody.
set -eu
umask 077
mkdir -p /run/ananta-code
chmod 700 /run/ananta-code
if [ ! -s /run/ananta-code/token ]; then
  python -c 'import secrets; open("/run/ananta-code/token","w").write(secrets.token_hex(32))'
fi
chmod 400 /run/ananta-code/token
exec python -B -u /opt/ananta-code/main.py \
  --socket /run/ananta-code/runner.sock \
  --token-file /run/ananta-code/token
