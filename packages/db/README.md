# @restrobooth/db

Schema, migrations, RLS, and the correctness/benchmark suites. See [docs/ERD.md](../../docs/ERD.md), [docs/TENANCY.md](../../docs/TENANCY.md), [docs/adr/0003-orm.md](../../docs/adr/0003-orm.md).

## Two ways this package gets consumed — and why there's a build step

This package's `tsconfig.json` uses `moduleResolution: NodeNext` (via `@restrobooth/config/typescript/base.json`), which is what lets `scripts/`, `bench/`, and `test/` run directly against `.ts` source via `tsx` and Vitest — both understand NodeNext's explicit `.js`-suffixed relative imports natively.

`apps/console` (and any future Next.js app) consumes this package differently: as `import { schema } from "@restrobooth/db"`, bundled by Turbopack. Turbopack does **not** resolve a literal `./rls.js` specifier to a sibling `./rls.ts` file — unlike `tsx`/Node, it takes the extension literally and fails with "Module not found." (`packages/ui` never hits this because its own tsconfig uses `moduleResolution: bundler`, which expects extensionless imports — appropriate there because Next is its *only* consumer. `packages/db` has two consumers with two different resolution conventions, so one of them needs a real build.)

The fix: `pnpm build` here (`tsc -p tsconfig.build.json`, `src/` only) compiles to `dist/`, and `package.json`'s `main`/`types` point there — real, unambiguous `.js` files, nothing for a bundler to guess about. `scripts/`/`bench/`/`test/` are untouched by this; they import source files by relative path, never through `package.json`'s `main`. Turborepo's `dev`/`build` tasks `dependsOn: ["^build"]`, so this package builds before `apps/console` does.

## Migration workflow — read before touching `drizzle/`

Two disjoint halves, verified two different ways (confirmed empirically, Phase 1 Day-1 spike):

- **What Drizzle can express** (columns, types, plain FKs, simple constraints) → declared in `src/schema/*.ts`, migrations generated with `pnpm db:generate`.
- **What Drizzle cannot express** (RLS policies, SQL functions, `exclude using gist`, partition-by-range DDL, generated columns) → **absent from `schema.ts` entirely**, hand-written via `drizzle-kit generate --custom`, then hand-edited.

**Never run `drizzle-kit push`. Not on this project, not ever, not even for a "quick" table.** The spike confirmed it cannot run non-interactively once schema.ts and the live DB disagree about partitioning (which they always will, by design, for the seven partitioned tables) — it either hard-crashes in CI or presents a human with a confusing rename/create disambiguation prompt about tables it doesn't understand are partitions. Always: `db:generate` → hand-edit if needed → `db:migrate`.

**Never trust `drizzle-kit pull`/introspect against this database.** It silently drops partitioned parent tables from its output entirely and represents each child partition as an independent, unrelated ordinary table. No error, no warning — just wrong. If you need to check the live schema matches what's documented, query `pg_catalog` directly, or read the migration history.

CI's drift check uses `drizzle-kit generate` producing an empty diff — that command is purely a diff between `schema.ts` and Drizzle's own snapshot history (`drizzle/meta/`), and never touches the live database, so it is safe against the hand-written half by construction.
