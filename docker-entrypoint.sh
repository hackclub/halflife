#!/bin/sh
# `set -e` stops a failed migration from starting a server against a schema it
# does not match. `exec` hands PID 1 to bun so Kubernetes rolling updates
# terminate cleanly rather than waiting out the grace period.
set -eu

echo "[boot] applying migrations"
bunx prisma db migrate

echo "[boot] starting server"
# A scheduler (Orchard app jobs) can override the image command; honour it
# rather than always starting the web server.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
# `--trace-warnings` prints a stack for every process warning, so a warning in a pod's logs says where it came from instead of only what it said.
exec bun --trace-warnings server.js
