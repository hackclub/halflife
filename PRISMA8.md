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

Complete. No data migration was needed at any point: Prisma 8 reads the same tables, rows and enums as Prisma 7 did. The only write outside the app was the marker row in `prisma_contract.marker`, which records that the database matches the contract.

What it took, for the record – the first boot could not just run `migrate`, because migrate is replay-only and a marker-less database replays the baseline:

1. The entrypoint temporarily ran `db sign --no-advance-ref` before `migrate`. (`verify` cannot run before the marker exists, and the flag skips the dev-side ref file, which the runtime user cannot write — without it a successful sign still exited non-zero on EACCES.)
2. The first `sign` refused with a native-enum order mismatch: production lists two `AuditAction` member pairs in the opposite order to the dev database the contract was matched to. The contract was rewritten to production's exact order and `migrations/app/20261026T0302_audit_action_enum_order` performs the swap (new type, move the one `audit_log` column across with a `USING` cast, drop, rename) – validated on scratch and dev databases before deploy. The planner does not reorder enums, so this package is hand-authored.
3. With the contract matching, `sign` wrote the marker, `migrate` reported "Already up to date", and the temporary bootstrap was removed. Boot is now `db migrate` alone.

The old `_prisma_migrations` table stays where it is; it is Prisma 7's history and nothing reads it anymore. Its rows remain in git history under `prisma/migrations/`.
