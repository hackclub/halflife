# syntax=docker/dockerfile:1

# Declared before the first FROM because that is the only scope a FROM line can read an ARG from; inside a stage it would be invisible to the `next-cache` FROM below.
# See that stage for what this image is.
ARG NEXT_CACHE_IMAGE=alpine:3

FROM oven/bun:1-alpine AS base
# Production runs on Bun, not Node: installs, the Next build and the standalone server below all execute under `bun`. Local dev and CI still use pnpm (see package.json's packageManager field); the pnpm lockfile and workspace config are deliberately excluded from this build context via .dockerignore so they never land in the image.

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN bunx prisma contract emit

# ── prod-deps ────────────────────────────────────────────────────────────────
# Runtime-only node_modules: the runner ships no build toolchain (typescript, eslint, tailwind, …). `prisma` itself is a production dependency, so `db migrate` at boot keeps working, as do the seed and backfill scripts (their only non-runtime import was `dotenv`, which is a dependency for exactly this reason). Rebuilt only when the lockfile or contract changes, like `deps` above.
FROM base AS prod-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN bunx prisma contract emit

# ── next-cache ───────────────────────────────────────────────────────────────
# The Turbopack cache as an image, so a build can start warm.
#
# The `--mount=type=cache` this replaced could not do it. A cache mount lives in the builder's own state, and here the builder is a fresh pod per build; it is also never part of the cache export, which carries layers only. So every deploy saw an empty directory and recompiled from scratch – measured at 26s cold against 1s warm on this app, with a two-file diff landing at 13s.
#
# Defaulted to an image with no cache in it, so a build without the cache image (a fresh environment, the first deploy after this change) starts cold rather than failing. The `mkdir` is what makes that work: whatever the source image carried, `/cache` exists from here on, so the copy in the builder cannot fail on a missing directory. (`NEXT_CACHE_IMAGE` is declared at the top of this file, because a FROM can only read an ARG from before the first FROM.)
FROM ${NEXT_CACHE_IMAGE} AS next-cache
RUN mkdir -p /cache

# ── build ────────────────────────────────────────────────────────────────────
# Two builds of the same tree, differing only in where the Turbopack cache lives.
#
# The split is about what the cache costs. It is 384MB, it is source-dependent, and a
# copy of it into the filesystem lands in a layer – which every deploy then re-exports to
# the build cache, and every commit grows the builder's cache store by, for a layer the
# next commit invalidates anyway. Measured on the deploy that first added it: the cache
# export went from 11s to 23s, and the export is the largest single item in a build whose
# compile is fully cached. So the deploy path keeps the cache in a mount, where it is
# never part of a layer, and only the publisher – which has to be able to copy it out –
# puts it on disk.
#
# `prepared` holds everything both need, so the two cannot drift on what is built.
FROM base AS prepared
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/app/generated ./src/app/generated
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
# `next build` imports lib/auth.ts during static analysis and better-auth refuses a short secret. This value never reaches runtime.
ENV BETTER_AUTH_SECRET="build-time-placeholder-must-be-32-chars-long"

# The publisher's build, and the source of the cache image. Cold on purpose: what it
# publishes should be this commit's cache rather than the last one's, and it runs on
# merges to the deploy branch rather than per deploy. `.next/cache` on disk is the point
# of this variant, so `next-cache-image` can copy it out.
FROM prepared AS builder
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_UPLOAD_HOST
RUN bunx next build --experimental-build-mode compile

# The deploy path. Seeded from the published cache image into a mount, in the same step
# as the build so the seed happens whenever the build does, and guarded so a mount that
# already holds a cache is not copied over. `-d /prev/cache` makes a default image
# without one a cold build rather than a failure.
#
# The ARGs are repeated because an ARG is scoped to the stage that declares it – unlike
# ENV, which `prepared` hands down to both.
FROM prepared AS builder-live
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_UPLOAD_HOST
# `compile` skips Next's own typecheck pass: CI already runs `pnpm typecheck` and `pnpm lint` on every commit before it can reach prod, so re-running tsc here (~15s) buys nothing.
RUN --mount=type=cache,target=/app/.next/cache \
    --mount=type=bind,from=next-cache,source=/,target=/prev \
    sh -c 'if [ ! -e .next/cache/turbopack ] && [ -d /prev/cache ]; then cp -a /prev/cache/. .next/cache/; fi; bunx next build --experimental-build-mode compile'

# ── next-cache-image ─────────────────────────────────────────────────────────
# What the refresh job publishes: the cache the build just produced, and nothing else.
#
#     docker build --target next-cache-image -t <registry>/halflife-next-cache:main .
#
# The smallest image with a shell in it, rather than `scratch`: the consumer stage
# runs `mkdir -p /cache`, and an image without a shell cannot run anything at all.
# So this is alpine plus one layer of cache, and a deploy consumes it with
# `--build-arg NEXT_CACHE_IMAGE=<that tag>`. Worth refreshing on merges to the deploy
# branch rather than per deploy: the layer is ~260MB, and a fresh digest costs a fetch
# that eats most of the compile time it saves.
FROM alpine:3 AS next-cache-image
COPY --from=builder /app/.next/cache /cache

# ── runner ───────────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# The public origin, carried into the runtime.
#
# Not a secret: the value is in the browser bundle already. It is here so the runtime
# and the build agree. `NEXT_PUBLIC_*` is inlined into the bundle when it is built, so
# the builder's ARG is what the app itself uses; this ENV is what the parts of the
# image that are NOT bundled read – the seed, the backfill scripts, anything run with
# `bun` inside the container. The operator sets the same value as the build arg and as
# a runtime env var, so the app, the scripts and the browser all name one origin.
#
# The ARG is repeated because an ARG is scoped to the stage that declares it, and the
# runner is `FROM base` rather than `FROM prepared` (see the builder stages above).
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL}"

RUN apk add --no-cache curl \
 && addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder-live /app/public ./public
COPY --from=builder-live --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder-live --chown=nextjs:nodejs /app/.next/static ./.next/static

# `prisma db migrate` runs at container start, so the CLI and the contract
# have to ship in the runtime image. This is the production-only tree: the
# build toolchain stays in `deps`, which is why this layer is hundreds of MB
# smaller than a full install.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder-live /app/prisma ./prisma
COPY --from=builder-live /app/prisma.config.ts ./
COPY --from=builder-live /app/migrations ./migrations

# `bun prisma/seed.ts` (RUNBOOK step 9) imports the printer catalogue from src/lib/config, and that config reaches the Prisma enums through the `@/` path alias. Neither is in the standalone trace — Next bundles the app's own imports rather than shipping the source — so the config module and the tsconfig whose `paths` resolves the alias have to ship as well, or a fresh deploy seeds no shop items.
#
# The migration/backfill scripts in scripts/ (`bun --conditions=react-server scripts/backfill-analytics.ts`, …) import from all over src/lib via relative paths, and those modules reach further still — so the whole src tree ships, not just the config. Without it the scripts are absent from the image and there is nothing to run migrations/backfills with inside the container. Run them with `bun --conditions=react-server` (the condition swaps the `server-only` imports for plain ones). Bun runs TypeScript directly, so no separate TypeScript runner is needed here.
COPY --from=builder-live --chown=nextjs:nodejs /app/src ./src
COPY --from=builder-live --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder-live --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# /api/health touches Postgres, so a pod with a dead database is marked unhealthy instead of serving errors on every request.
# Uses $PORT so the check follows the port the server actually binds to.
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
