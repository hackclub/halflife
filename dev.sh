#!/bin/sh
# Local development: Postgres in Docker, migrated and seeded, then next dev.
set -eu

[ -f .env ] || { echo "Missing .env — copy .env.example and fill it in"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running"; exit 1; }

echo "==> starting postgres"
docker compose -f docker-compose.dev.yaml up -d --wait

echo "==> generating prisma client"
pnpm exec prisma generate

echo "==> applying migrations"
pnpm exec prisma migrate deploy

echo "==> seeding"
pnpm db:seed

echo "==> starting next"
exec pnpm dev
