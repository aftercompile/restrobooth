# @restrobooth/db

Schema, migrations, RLS, and the correctness/benchmark suites. See [docs/ERD.md](../../docs/ERD.md), [docs/TENANCY.md](../../docs/TENANCY.md), [docs/adr/0003-orm.md](../../docs/adr/0003-orm.md).

## Migration workflow — read before touching `drizzle/`

Two disjoint halves, verified two different ways (confirmed empirically, Phase 1 Day-1 spike):

- **What Drizzle can express** (columns, types, plain FKs, simple constraints) → declared in `src/schema/*.ts`, migrations generated with `pnpm db:generate`.
- **What Drizzle cannot express** (RLS policies, SQL functions, `exclude using gist`, partition-by-range DDL, generated columns) → **absent from `schema.ts` entirely**, hand-written via `drizzle-kit generate --custom`, then hand-edited.

**Never run `drizzle-kit push`. Not on this project, not ever, not even for a "quick" table.** The spike confirmed it cannot run non-interactively once schema.ts and the live DB disagree about partitioning (which they always will, by design, for the seven partitioned tables) — it either hard-crashes in CI or presents a human with a confusing rename/create disambiguation prompt about tables it doesn't understand are partitions. Always: `db:generate` → hand-edit if needed → `db:migrate`.

**Never trust `drizzle-kit pull`/introspect against this database.** It silently drops partitioned parent tables from its output entirely and represents each child partition as an independent, unrelated ordinary table. No error, no warning — just wrong. If you need to check the live schema matches what's documented, query `pg_catalog` directly, or read the migration history.

CI's drift check uses `drizzle-kit generate` producing an empty diff — that command is purely a diff between `schema.ts` and Drizzle's own snapshot history (`drizzle/meta/`), and never touches the live database, so it is safe against the hand-written half by construction.
