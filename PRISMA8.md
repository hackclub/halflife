# Prisma 8 migration notes

Status: **complete on this branch.** Every query in `src/`, `scripts/`, `import/` and `prisma/seed.ts` runs through the Prisma 8 client in `src/lib/prisma8.ts`. Prisma 7 packages, config, schema, migrations and generated client are removed. The local database is signed to the contract.

## What Prisma 8 changed

Prisma 8 is not a drop-in major upgrade of the Prisma 7 client. It replaces the generated client and the query API:

- There is no `prisma generate`, no `PrismaClient`, no `@prisma/client` runtime, and no `Prisma.*` generated types.
- The schema is a contract (`prisma/contract.prisma`), emitted to `contract.json` + `contract.d.ts`.
- Queries move from `prisma.user.findMany({ where, include, orderBy })` to chains such as `db.orm.public.User.where({...}).include("posts").orderBy(...).all()`.
- `findUnique`/`findFirst` become `.first()` / `.firstOrThrow()`, `createManyAndReturn` has no ORM equivalent, `count()` becomes `.aggregate(a => ({ n: a.count() }))`, and `$transaction([...])` becomes `db.transaction(async tx => ...)`.
- PostgreSQL `DateTime` columns are read as strings (`TimestampString(3)`), not `Date` objects. The app parses at the boundary (`parseDbTimestamp` / `formatDbTimestamp` in `src/lib/time.ts`, `parseTimestampFields` for whole rows) and keeps `Date` everywhere else.
- Enums come from the contract as string unions. `src/lib/enums.ts` keeps the `Phase.DESIGN` value-and-type shape the app already used; it is generated from the contract by `scripts/generate-enums.ts` (run via `bun run db:generate`) and type-checked against it.

## What is set up here

| Piece | State |
| --- | --- |
| Prisma 8 CLI | `prisma@8.0.0-rc.27`, config `prisma.config.ts` |
| Prisma 8 runtime | `@prisma/orm-postgres@8.0.0-rc.20` |
| Contract source | `prisma/contract.prisma` – the schema of record |
| Contract artifacts | `src/app/generated/prisma8/contract.json` and `contract.d.ts` (gitignored with the rest of `src/app/generated`) |
| Migration state | `migrations/app/refs/db.json` + content-addressed snapshots under `migrations/snapshots/` |
| Verification | `bun run p8:verify` exercises the admin, review, feed and shop read paths |
| Auth | better-auth on its Kysely adapter with its own UTC-pinned `pg` pool (`src/lib/auth-db.ts`); the Prisma adapter is gone with the v7 client |

### Commands

```sh
bun run db:generate         # emit contract + regenerate src/lib/enums.ts
bun run db:update            # local-dev fast path: apply contract to dev DB
bun run db:plan -- --name x  # formal path: write a migration package
bun run db:migrate           # apply pending migrations (also the boot command)
bun run db:verify            # contract vs live schema
bun run db:sign              # adopt a matching database
bun run p8:verify            # read-path smoke test over real queries
```

### Verified locally

- `bun run db:generate`, `bun run typecheck`, `bun run lint`, `bun run build` pass with no Prisma 7 packages installed.
- `bun run p8:verify` returns the admin counters, review queue, feed, shop and project queries against the signed local database.
- `bun run db:verify` passes against the signed local database.

### Contract authorship notes

The contract was rewritten from the Prisma 7 schema rather than inferred, so every field and relation name the app uses is preserved:

- 8 partial indexes carry `where: sql\`...\`` with Postgres's own reprint of the predicate (casts and extra parens included) – byte-identical text is what `db sign` compares.
- 3 indexes lost their `(sort: Desc)` field arguments; sort direction lives in query `orderBy`, not in the index.
- `cuid()` defaults became `@onCreate(cuid())`; Prisma 8 treats client-generated values as generators, not database defaults.
- Native enum member order matches the live database (enum order is significant to verification, not alphabetical).

## Production cutover

`prisma db sign` has been run against the local database only. The production database has the same schema but has **not** been signed. Cutover order:

1. Back up production and take a maintenance window.
2. Deploy this branch (the entrypoint runs `prisma db migrate`, which is a no-op while the marker is absent – it does not write schema).
3. `prisma db sign --db <production-url>` (or `bun run db:sign` with `DATABASE_URL` pointed at production). If it reports drift, stop: the drift output names the exact object.
4. `prisma db verify` to confirm, then re-enable traffic.

Do not delete the `prisma_contract` schema or marker rows by hand; `db sign` owns them.
