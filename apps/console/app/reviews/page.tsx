import { eq, schema, sql } from "@restrobooth/db";
import { Animate, Badge, Card, CardHeader, DataRow, PageHeader } from "@restrobooth/ui";
import { queryAsCurrentUser } from "../../lib/db";
import { createClient } from "../../lib/supabase/server";
import { ConsoleShell } from "../ConsoleShell";
import { ExtractPendingButton } from "./ExtractPendingButton";
import { ReviewPasteForm } from "./ReviewPasteForm";

const ASPECT_LABEL: Record<string, string> = {
  taste: "Taste",
  portion: "Portion",
  temperature: "Temperature",
  wait: "Wait",
  price: "Price",
  service: "Service",
};

function sentimentTone(sentiment: string): "live" | "critical" | "neutral" {
  if (sentiment === "positive") return "live";
  if (sentiment === "negative") return "critical";
  return "neutral";
}

interface TopIssue {
  aspect: string;
  menuItemId: string | null;
  dishName: string | null;
  count: number;
}

interface DishSentiment {
  menuItemId: string;
  name: string;
  positive: number;
  negative: number;
  neutral: number;
}

interface Finding {
  aspect: string;
  sentiment: string;
  dishName: string | null;
}

interface RecentReview {
  sourceType: "guest_feedback" | "external_review";
  id: string;
  platform: string | null;
  rating: number | null;
  text: string;
  createdAt: string;
  aiUsed: boolean;
  extracted: boolean;
}

export default async function ReviewsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { stores, topIssues, dishSentiment, recentReviews, findingsBySource, pendingCount } = await queryAsCurrentUser(async (tx) => {
    const stores = await tx
      .select({ id: schema.stores.id, outletName: schema.outlets.name })
      .from(schema.stores)
      .innerJoin(schema.outlets, eq(schema.outlets.id, schema.stores.outletId));

    const topIssuesResult = await tx.execute<{
      [key: string]: unknown;
      aspect: string;
      menu_item_id: string | null;
      dish_name: string | null;
      cnt: string;
    }>(sql`
      select re.aspect, re.menu_item_id, mi.name as dish_name, count(*) as cnt
      from review_extractions re
      left join menu_items mi on mi.id = re.menu_item_id
      where re.sentiment = 'negative' and re.created_at >= now() - interval '7 days'
      group by re.aspect, re.menu_item_id, mi.name
      order by cnt desc
      limit 3
    `);
    const topIssues: TopIssue[] = topIssuesResult.rows.map((r) => ({
      aspect: r.aspect,
      menuItemId: r.menu_item_id,
      dishName: r.dish_name,
      count: Number(r.cnt),
    }));

    const dishSentimentResult = await tx.execute<{
      [key: string]: unknown;
      menu_item_id: string;
      name: string;
      positive_count: string;
      negative_count: string;
      neutral_count: string;
    }>(sql`
      select mi.id as menu_item_id, mi.name,
        count(*) filter (where re.sentiment = 'positive') as positive_count,
        count(*) filter (where re.sentiment = 'negative') as negative_count,
        count(*) filter (where re.sentiment = 'neutral') as neutral_count
      from review_extractions re
      join menu_items mi on mi.id = re.menu_item_id
      group by mi.id, mi.name
      order by count(*) filter (where re.sentiment = 'negative') desc, count(*) desc
      limit 20
    `);
    const dishSentiment: DishSentiment[] = dishSentimentResult.rows.map((r) => ({
      menuItemId: r.menu_item_id,
      name: r.name,
      positive: Number(r.positive_count),
      negative: Number(r.negative_count),
      neutral: Number(r.neutral_count),
    }));

    const recentResult = await tx.execute<{
      [key: string]: unknown;
      source_type: "guest_feedback" | "external_review";
      id: string;
      platform: string | null;
      rating: number | null;
      text: string;
      created_at: string;
      extraction_ai_used: boolean;
      extracted: boolean;
    }>(sql`
      select 'guest_feedback' as source_type, f.id, null::text as platform, f.rating, f.comment as text,
        f.created_at, f.extraction_ai_used, (f.extracted_at is not null) as extracted
      from feedback f
      where f.comment is not null
      union all
      select 'external_review' as source_type, er.id, er.source_platform as platform, er.external_rating as rating,
        er.review_text as text, er.created_at, er.extraction_ai_used, (er.extracted_at is not null) as extracted
      from external_reviews er
      order by created_at desc
      limit 20
    `);
    const recentReviews: RecentReview[] = recentResult.rows.map((r) => ({
      sourceType: r.source_type,
      id: r.id,
      platform: r.platform,
      rating: r.rating,
      text: r.text,
      createdAt: r.created_at,
      aiUsed: r.extraction_ai_used,
      extracted: r.extracted,
    }));

    const findingsResult = await tx.execute<{
      [key: string]: unknown;
      feedback_id: string | null;
      external_review_id: string | null;
      aspect: string;
      sentiment: string;
      dish_name: string | null;
    }>(sql`
      select re.feedback_id, re.external_review_id, re.aspect, re.sentiment, mi.name as dish_name
      from review_extractions re
      left join menu_items mi on mi.id = re.menu_item_id
    `);
    const findingsBySource = new Map<string, Finding[]>();
    for (const r of findingsResult.rows) {
      const key = r.feedback_id ?? r.external_review_id;
      if (!key) continue;
      const list = findingsBySource.get(key) ?? [];
      list.push({ aspect: r.aspect, sentiment: r.sentiment, dishName: r.dish_name });
      findingsBySource.set(key, list);
    }

    const pendingResult = await tx.execute<{ [key: string]: unknown; cnt: string }>(
      sql`select count(*) as cnt from feedback where comment is not null and extracted_at is null`,
    );
    const pendingCount = Number(pendingResult.rows[0]?.cnt ?? 0);

    return { stores, topIssues, dishSentiment, recentReviews, findingsBySource, pendingCount };
  });

  return (
    <ConsoleShell email={user?.email}>
      <PageHeader
        title="Reviews"
        subtitle="Post-meal guest feedback and pasted aggregator reviews, broken into taste / portion / temperature / wait / price / service findings. AI classifies when configured and under budget; a deterministic keyword pass covers the rest — every finding is real either way."
      />

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {pendingCount > 0 && (
          <Animate>
            <Card>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-2)" }}>
                <p style={{ margin: 0 }}>
                  {pendingCount} guest feedback comment{pendingCount === 1 ? "" : "s"} not analyzed yet.
                </p>
                <ExtractPendingButton />
              </div>
            </Card>
          </Animate>
        )}

        <Animate delayIndex={1}>
          <Card padded={false}>
            <CardHeader title="3 things to fix this week" count={`${topIssues.length}`} />
            {topIssues.length === 0 && (
              <p style={{ padding: "var(--space-2)", margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                Nothing flagged in the last 7 days.
              </p>
            )}
            {topIssues.map((issue, i) => (
              <DataRow
                key={`${issue.aspect}-${issue.menuItemId ?? "general"}`}
                railState="critical"
                railLabel="Rising complaint"
                label={`${ASPECT_LABEL[issue.aspect] ?? issue.aspect}${issue.dishName ? ` — ${issue.dishName}` : ""}`}
                trailing={<Badge tone="critical">{issue.count} mention{issue.count === 1 ? "" : "s"}</Badge>}
                muted={i > 2}
              />
            ))}
          </Card>
        </Animate>

        <Animate delayIndex={2}>
          <Card padded={false}>
            <CardHeader title="Per-dish sentiment" count={`${dishSentiment.length}`} />
            {dishSentiment.length === 0 && (
              <p style={{ padding: "var(--space-2)", margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                No dish-level findings yet.
              </p>
            )}
            {dishSentiment.map((d) => (
              <DataRow
                key={d.menuItemId}
                railState={d.negative > d.positive ? "critical" : d.positive > d.negative ? "fresh" : "idle"}
                railLabel={d.negative > d.positive ? "More negative than positive" : d.positive > d.negative ? "More positive than negative" : "Mixed"}
                label={d.name}
                trailing={
                  <>
                    {d.positive > 0 && <Badge tone="live">+{d.positive}</Badge>}
                    {d.negative > 0 && <Badge tone="critical">-{d.negative}</Badge>}
                    {d.neutral > 0 && <Badge tone="neutral">{d.neutral} neutral</Badge>}
                  </>
                }
              />
            ))}
          </Card>
        </Animate>

        <Animate delayIndex={3}>
          <Card style={{ maxWidth: 560 }}>
            <h2 style={{ margin: "0 0 var(--space-2)", fontFamily: "var(--font-display)", fontSize: "var(--text-lg)" }}>Paste a review</h2>
            <ReviewPasteForm stores={stores} />
          </Card>
        </Animate>

        <Animate delayIndex={4}>
          <Card padded={false}>
            <CardHeader title="Recent" count={`${recentReviews.length}`} />
            {recentReviews.length === 0 && (
              <p style={{ padding: "var(--space-2)", margin: 0, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
                No feedback or reviews yet.
              </p>
            )}
            {recentReviews.map((r) => {
              const findings = findingsBySource.get(r.id) ?? [];
              return (
                <DataRow
                  key={`${r.sourceType}-${r.id}`}
                  label={
                    <span>
                      <span style={{ display: "block", fontWeight: 600 }}>
                        {r.sourceType === "guest_feedback" ? "Guest feedback" : r.platform ?? "Aggregator review"}
                        {r.rating ? ` · ${r.rating}★` : ""}
                      </span>
                      <span style={{ display: "block", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{r.text}</span>
                      {findings.length > 0 && (
                        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                          {findings.map((f, i) => (
                            <Badge key={i} tone={sentimentTone(f.sentiment)}>
                              {ASPECT_LABEL[f.aspect] ?? f.aspect}
                              {f.dishName ? ` · ${f.dishName}` : ""}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </span>
                  }
                  trailing={
                    r.extracted ? <Badge tone={r.aiUsed ? "live" : "neutral"}>{r.aiUsed ? "AI" : "keyword-only"}</Badge> : <Badge tone="warning">not analyzed</Badge>
                  }
                />
              );
            })}
          </Card>
        </Animate>
      </div>
    </ConsoleShell>
  );
}
