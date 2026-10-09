# syntax=docker/dockerfile:1
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
RUN bunx prisma generate

# ── prod-deps ────────────────────────────────────────────────────────────────
# Runtime-only node_modules: the runner ships no build toolchain (typescript, eslint, tailwind, tsx, …). `prisma` itself is a production dependency, so `migrate deploy` at boot keeps working, as do the seed and backfill scripts (their only non-runtime import was `dotenv`, which is a dependency for exactly this reason). Rebuilt only when the lockfile or schema changes, like `deps` above.
FROM base AS prod-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY prisma ./prisma
COPY prisma.config.ts ./
RUN bunx prisma generate

# ── builder ──────────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/app/generated ./src/app/generated
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
# `next build` imports lib/auth.ts during static analysis and better-auth refuses a short secret. This value never reaches runtime.
ENV BETTER_AUTH_SECRET="build-time-placeholder-must-be-32-chars-long"

# These two are read *while building*, not by the running pod: next.config.ts bakes NEXT_PUBLIC_UPLOAD_HOST into the image allowlist, and the client bundle inlines NEXT_PUBLIC_APP_URL. Declaring them as build args is what makes `docker build --build-arg ...` able to supply them — a runtime env var cannot.
# Unset, the browser client falls back to the page origin and the server-side URL builders fall back to BETTER_AUTH_URL, so only the next/image allowlist (currently unused) is lost.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_UPLOAD_HOST

# `compile` skips Next's own typecheck pass: CI already runs `pnpm typecheck` and `pnpm lint` on every commit before it can reach prod, so re-running tsc here (~15s) buys nothing. The cache mount keeps the incremental compile cache across builds, so small-diff deploys compile warm instead of cold.
RUN --mount=type=cache,target=/app/.next/cache bunx next build --experimental-build-mode compile

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
# have to ship in the runtime image. This is the production-only tree: the
# build toolchain stays in `deps`, which is why this layer is hundreds of MB
# smaller than a full install.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./

# `bun prisma/seed.ts` (RUNBOOK step 9) imports the printer catalogue from src/lib/config, and that config reaches the Prisma enums through the `@/` path alias. Neither is in the standalone trace — Next bundles the app's own imports rather than shipping the source — so the config module and the tsconfig whose `paths` resolves the alias have to ship as well, or a fresh deploy seeds no shop items.
#
# The migration/backfill scripts in scripts/ (`bun --conditions=react-server scripts/backfill-analytics.ts`, …) import from all over src/lib via relative paths, and those modules reach further still — so the whole src tree ships, not just the config. Without it the scripts are absent from the image and there is nothing to run migrations/backfills with inside the container. Run them with `bun --conditions=react-server` (the condition swaps the `server-only` imports for plain ones). Bun runs TypeScript directly, so the `tsx` dev dependency that local pnpm scripts use is not needed here.
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

USER nextjs
EXPOSE 3000

# /api/health touches Postgres, so a pod with a dead database is marked unhealthy instead of serving errors on every request.
# Uses $PORT so the check follows the port the server actually binds to.
HEALTHCHECK --interval=30s --timeout=10s --start-period=25s --retries=5 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
