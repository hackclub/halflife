# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
# Every later stage is its own `FROM base`, so pnpm has to be here rather than
# in one of them: installing it in `deps` leaves `builder` without it, and the
# failure surfaces as `pnpm: not found` three stages into a slow build.
# Pinned to the version in package.json's packageManager field.
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# BuildKit cache mounts survive `--no-cache` and forced rebuilds, so one
# truncated tarball in the cache fails every subsequent build with "the file
# appears to be corrupt" until somebody prunes it by hand. Retrying against a
# cleaned cache costs one slow build instead of a broken deploy.
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    (pnpm install --frozen-lockfile || (pnpm store prune && pnpm install --frozen-lockfile))

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm exec prisma generate

# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/app/generated ./src/app/generated
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
# `next build` imports lib/auth.ts during static analysis and better-auth
# refuses a short secret. This value never reaches runtime.
ENV BETTER_AUTH_SECRET="build-time-placeholder-must-be-32-chars-long"

# These two are read *while building*, not by the running pod: next.config.ts
# bakes NEXT_PUBLIC_UPLOAD_HOST into the image allowlist, and the client bundle
# inlines NEXT_PUBLIC_APP_URL. Declaring them as build args is what makes
# `docker build --build-arg ...` able to supply them — a runtime env var cannot.
# Unset, the browser client falls back to the page origin and the server-side
# URL builders fall back to BETTER_AUTH_URL, so only the next/image allowlist
# (currently unused) is lost.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_UPLOAD_HOST

RUN pnpm build

# ── runner ───────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN apk add --no-cache curl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# `prisma migrate deploy` runs at container start, so the CLI and the schema
# have to ship in the runtime image. node_modules is copied whole because the
# Prisma CLI's dependency tree is hoisted and pruning it by hand is fragile.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/src/app/generated ./src/app/generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

# `pnpm db:seed` (RUNBOOK step 9) imports the printer catalogue from
# src/lib/config, and that config reaches the Prisma enums through the `@/`
# path alias. Neither is in the standalone trace — Next bundles the app's own
# imports rather than shipping the source — so the config module and the
# tsconfig whose `paths` resolves the alias have to ship as well, or a fresh
# deploy seeds no shop items.
COPY --from=builder /app/src/lib/config ./src/lib/config
COPY --from=builder /app/tsconfig.json ./tsconfig.json

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# /api/health touches Postgres, so a pod with a dead database is marked
# unhealthy instead of serving errors on every request.
# Uses $PORT so the check follows the port the server actually binds to.
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
