#!/bin/sh
# `set -e` stops a failed migration from starting a server against a schema it
# does not match. `exec` hands PID 1 to bun so Kubernetes rolling updates
# terminate cleanly rather than waiting out the grace period.
set -eu

# TEMPORARY: remove after the first deploy that signs production. Adopts the
# database before migrating, so the first Prisma 8 boot writes the contract
# marker instead of replaying the baseline. `db sign` verifies the live
# schema against the contract first and refuses on drift (a separate
# `db verify` step cannot run before it: verify requires the marker that
# only sign creates). On later boots sign reports "already signed", so this
# is safe to run more than once but should not live here permanently.
echo "[boot] signing database"
bunx prisma db sign

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
