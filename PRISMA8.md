# Prisma 8 (release candidate) migration notes

Status: **side-by-side groundwork only.** The application still reads and writes through Prisma 7. Nothing in `src/` imports the Prisma 8 client yet.

## What Prisma 8 changes

Prisma 8 is not a drop-in major upgrade of the Prisma 7 client. It replaces the generated client and the query API:

- There is no `prisma generate`, no `PrismaClient`, no `@prisma/client` runtime, and no `Prisma.*` generated types.
- A schema becomes a contract (`prisma8/contract.prisma`), emitted to `contract.json` + `contract.d.ts`.
- Queries move from `prisma.user.findMany({ where, include, orderBy })` to chains such as `db.orm.public.User.where({...}).include("posts").orderBy(...).all()`.
- `findUnique`/`findFirst` become `.first()` / `.firstOrThrow()`, `createManyAndReturn` has no ORM equivalent, `count()` becomes `.aggregate(a => ({ n: a.count() }))`, and `$transaction([...])` becomes `db.transaction(async tx => ...)`.
- PostgreSQL `DateTime` columns are read as strings (`TimestampString(3)` in the inferred contract), not `Date` objects.
- Enums come from the contract as string unions; the generated `enums.ts` disappears.

## What is set up here

| Piece | State |
| --- | --- |
| Prisma 7 CLI | `@prisma/prisma7@7.10.1`, binary `prisma7`, config `prisma7.config.ts` |
| Prisma 8 CLI | `prisma@8.0.0-rc.27`, binary `prisma`, config `prisma.config.ts` |
| Prisma 8 runtime | `@prisma/orm-postgres@8.0.0-rc.20` |
| Contract source | `prisma8/contract.prisma`, inferred from the live database |
| Contract artifacts | `generated/prisma8/contract.json` and `contract.d.ts` (gitignored) |
| Verification | `bun run p8:verify` reads users, dates, and a relation through the Prisma 8 client |

Prisma 7 still owns schema changes. See `prisma7.config.ts`, and the `db:*` scripts in `package.json`.

### Commands

```sh
bun run db:generate          # Prisma 7 client (unchanged app)
bun run db:migrate           # Prisma 7 migrate dev
bun run p8:contract:infer    # re-read the database into prisma8/contract.prisma
bun run p8:contract:emit     # write generated/prisma8/contract.{json,d.ts}
bun run p8:verify            # run a read-only query with the Prisma 8 client
```

### Verified locally

- `bun run p8:contract:emit` succeeds against the development database.
- `bun run p8:verify` returns 5,224 users, ordered rows, a date as a string, and an `include("user")` relation.
- `bunx prisma7 generate`, `bun run typecheck`, and `bun run build` all pass with both clients installed.

## Why the whole app was not switched

The Prisma 8 schema reader refuses the existing `prisma/schema.prisma`:

- 8 partial indexes (`@@unique`/`@@index` with `where:`) – Prisma 8 wants `@@index([...], unique: true, where: sql\`...\`)`.
- 3 indexes with field arguments (`sort: Desc`) – Prisma 8 indexes carry no sort direction.

The contract was therefore inferred from the live database. Migrating the application itself touches:

- ~1,400 model calls in `src/` (plus `tx.*` calls and ~40 scripts).
- 115 files importing the generated Prisma client, its enums, or `Prisma.*` types.
- 62 interactive/array transactions, 19 raw SQL queries, 173 `groupBy`/`aggregate`/`count` calls.
- 411 `select`/`include` option blocks.
- Every `DateTime` comparison and formatter (the app has 308 explicit `Date` operations), because Prisma 8 returns strings.

Prisma 8 is still a release candidate and its own release notes warn that each RC may contain breaking changes. Pinning exact versions is deliberate.

## Suggested next steps

1. Pick one isolated read-only route (for example an admin list page) and rewrite it against `db.orm.public.*`.
2. Add a `src/lib/prisma8.ts` singleton next to `src/lib/prisma.ts`, then move routes one at a time.
3. Decide the `DateTime` policy before touching writes: string contract fields, or `Temporal` in hand-written contracts, or convert at the boundary with the existing `Date` helpers.
4. Only after every route is moved: run `prisma contract print --output prisma8/contract.prisma`, switch migrations with `prisma db sign` + `prisma migration plan`, and remove Prisma 7.

Do not run `prisma db sign` against production until a backup and a maintenance window are in place.
