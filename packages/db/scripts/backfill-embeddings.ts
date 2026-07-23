/**
 * `pnpm --filter @restrobooth/db backfill:embeddings` — Phase 6 Slice 2
 * (ADR-0007 §2: "gte-small (384 dims) ... No external key, no per-call
 * cost, no vendor").
 *
 * Generates REAL gte-small embeddings for every menu_items row that
 * doesn't have one yet, via `@huggingface/transformers` (the actively-
 * maintained successor to `@xenova/transformers`) running the ONNX model
 * `Supabase/gte-small` — the exact fork Supabase's own docs use, chosen
 * specifically because ADR-0007 frames this whole approach around "gte-
 * small via a Supabase Edge Function."
 *
 * NOT the Edge Function itself — this is a one-time/on-demand Node
 * backfill, run manually. ADR-0007's real design is an Edge Function that
 * re-embeds automatically on menu publish; this project has no Edge
 * Function infrastructure yet (verified: no supabase/functions directory
 * exists), and standing that up is a separate, real piece of
 * infrastructure work with its own risk (Deno's WASM/ONNX support is a
 * different runtime than Node's), not something to fold into a data-
 * backfill task. Owner's explicit call (DECISIONS.md, Phase 6 Slice 2):
 * real embeddings now via Node, the Edge Function auto-refresh is a
 * named, deferred follow-up.
 *
 * Text embedded per item: `name. category. description. tags.` — the
 * exact shape ADR-0007 names ("built from description + tags + review
 * aspects" — review aspects are Slice 4's Review→Action output, not
 * available yet, so left out honestly rather than faked).
 */
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { pipeline } from "@huggingface/transformers";
import { createDbClient, type Database } from "../src/client.js";
import * as schema from "../src/schema/index.js";

const EMBEDDING_MODEL = "Supabase/gte-small";
const EMBEDDING_DIMS = 384;

interface MenuItemToEmbed {
  [key: string]: unknown;
  id: string;
  name: string;
  description: string | null;
  tags: string[];
  category_id: string | null;
}

export async function backfillEmbeddings(db: Database): Promise<void> {
  // `embedding` has no Drizzle column (packages/db/drizzle/0009's own
  // comment explains why) — raw SQL for both the read and the write.
  const rows = (await db.execute<MenuItemToEmbed>(sql`select id, name, description, tags, category_id from menu_items where embedding is null`)).rows;

  if (rows.length === 0) {
    console.log("Every menu item already has an embedding. Nothing to do.");
    return;
  }
  console.log(`Embedding ${rows.length} menu items with ${EMBEDDING_MODEL} (first run downloads the model — a few seconds)...`);

  const categoryNames = new Map<string, string>();
  for (const cat of await db.select({ id: schema.categories.id, name: schema.categories.name }).from(schema.categories)) {
    categoryNames.set(cat.id, cat.name);
  }

  const extractor = await pipeline("feature-extraction", EMBEDDING_MODEL);

  let done = 0;
  for (const row of rows) {
    const category = row.category_id ? categoryNames.get(row.category_id) : undefined;
    const text = [row.name, category, row.description, row.tags.join(", ")].filter(Boolean).join(". ");

    const output = await extractor(text, { pooling: "mean", normalize: true });
    const vector: number[] = Array.from(output.data as Float32Array);
    if (vector.length !== EMBEDDING_DIMS) {
      throw new Error(`Expected ${EMBEDDING_DIMS} dims from ${EMBEDDING_MODEL}, got ${vector.length} for "${row.name}"`);
    }

    // pgvector has no Drizzle column type (packages/db/drizzle/0009's own
    // comment) — write via raw SQL, same reasoning that migration gave
    // for leaving embedding out of schema.ts entirely.
    await db.execute(sql`update menu_items set embedding = ${`[${vector.join(",")}]`}::vector where id = ${row.id}`);
    done++;
    if (done % 20 === 0 || done === rows.length) console.log(`  ${done}/${rows.length}`);
  }
  console.log("Done.");
}

async function cliMain() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  config({ path: path.resolve(here, "../../../.env") });
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  await backfillEmbeddings(createDbClient(url));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cliMain()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
