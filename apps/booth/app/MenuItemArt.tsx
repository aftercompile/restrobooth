import styles from "./MenuItemArt.module.css";

/** Category name (free text from `categories.name`) -> a soft gradient
 *  tone + an illustrative glyph. Not literal food photography — the
 *  Booth's own established pattern for "art standing in for a photo"
 *  (OrderStatusBoard's 🍲 cooking-pot is the precedent) applied here at
 *  card scale. Unknown/uncategorised names fall through to a neutral
 *  tone rather than guessing. */
const CATEGORY_ART: Record<string, { glyph: string; tone: string }> = {
  Sides: { glyph: "🍟", tone: "gold" },
  Appetizers: { glyph: "🥗", tone: "green" },
  Entrees: { glyph: "🥩", tone: "enamel" },
  Desserts: { glyph: "🍰", tone: "rose" },
  Beverages: { glyph: "🍹", tone: "teal" },
};
const FALLBACK_ART = { glyph: "🍽️", tone: "neutral" };

/**
 * The image slot every menu card gets — a real photo when `imageUrl` is
 * set (never true for any fixture today, no photography exists yet), or
 * an honest illustrated placeholder otherwise. Never a stock/AI photo
 * standing in for a real dish (CLAUDE.md's no-invented-data rule) — this
 * reads as art, not as a claim about what the food looks like.
 */
export function MenuItemArt({
  imageUrl,
  categoryName,
  size = "card",
}: {
  imageUrl: string | null;
  categoryName: string | null;
  size?: "card" | "sheet";
}) {
  if (imageUrl) {
    // A future real photo could be any external host; next/image's domain
    // allowlist is a config decision for whoever wires up the first real
    // image, not something to guess at now for a path no fixture exercises yet.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageUrl} alt="" className={size === "sheet" ? styles.imageSheet : styles.imageCard} />;
  }

  const art = (categoryName && CATEGORY_ART[categoryName]) || FALLBACK_ART;
  return (
    <div className={size === "sheet" ? styles.artSheet : styles.artCard} data-tone={art.tone} aria-hidden="true">
      <span className={styles.glyph}>{art.glyph}</span>
    </div>
  );
}
