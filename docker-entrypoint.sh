#!/bin/sh
# `set -e` stops a failed migration from starting a server against a schema it
# does not match. `exec` hands PID 1 to bun so Kubernetes rolling updates
# terminate cleanly rather than waiting out the grace period.
set -eu

echo "[boot] applying migrations"
bunx prisma migrate deploy

echo "[boot] starting server"
# A scheduler (Orchard app jobs) can override the image command; honour it
# rather than always starting the web server.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec bun server.js
