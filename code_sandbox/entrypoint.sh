#!/bin/sh
# Root entrypoint. Guests are per-slot uids 61001 and 61002 from the image.
# /var/ananta-guests is a root-owned tmpfs (mode 0711): guests can traverse
# to their own 0700 directory and cannot list their neighbors.
#
# hidepid=2 would hide other guests' /proc entries. Remounting /proc needs
# CAP_SYS_ADMIN, which this container drops, so the remount is best-effort.
# Distinct uids still deny /proc/<pid>/fd, cwd, and environ (mode 0500/0400
# owned by the other guest).
set -eu
umask 077
mkdir -p /run/ananta-code
chmod 700 /run/ananta-code
if [ -d /var/ananta-guests ]; then
  chmod 711 /var/ananta-guests || true
fi
if [ ! -s /run/ananta-code/token ]; then
  python -c 'import secrets; open("/run/ananta-code/token","w").write(secrets.token_hex(32))'
fi
chmod 400 /run/ananta-code/token
mount -o remount,hidepid=2 /proc 2>/dev/null || true
exec python -B -u /opt/ananta-code/main.py \
  --socket /run/ananta-code/runner.sock \
  --token-file /run/ananta-code/token
