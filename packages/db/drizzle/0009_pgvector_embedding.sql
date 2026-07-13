-- Custom SQL migration file, put your code below! --

-- docs/adr/0007-ai-provider.md: gte-small (384 dims), free, no external key.
-- Deliberately absent from schema.ts — Phase 6 (Booth Host) is when this
-- column actually gets read/written, and that's when a proper Drizzle +
-- pgvector integration is worth adding. Until then it's SQL-only, matching
-- the same precedent already set for packages/ai being an empty shell.
create extension if not exists vector;

alter table menu_items add column embedding vector(384);

-- ivfflat needs training data to be useful; an empty/near-empty table would
-- build a low-quality index. Deferred to whichever Phase 6 migration first
-- backfills embeddings at real volume.
