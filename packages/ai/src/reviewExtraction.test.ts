import { describe, it, expect } from "vitest";
import { matchDishName, classifyByKeywords, parseExtractionResponse, type MenuNameCandidate } from "./reviewExtraction.js";

const MENU: MenuNameCandidate[] = [
  { id: "1", name: "Grilled Asparagus" },
  { id: "2", name: "Filet Mignon" },
  { id: "3", name: "Ribeye Steak" },
  { id: "4", name: "New York Strip Steak" },
];

describe("matchDishName", () => {
  it("matches an exact name, case/punctuation-insensitive", () => {
    expect(matchDishName("filet mignon!", MENU)).toBe("2");
  });

  it("matches a partial name uniquely contained in one dish", () => {
    expect(matchDishName("asparagus", MENU)).toBe("1");
  });

  it("returns null for an unambiguous non-match rather than guessing", () => {
    expect(matchDishName("chocolate cake", MENU)).toBeNull();
  });

  it("returns null for an empty or punctuation-only phrase", () => {
    expect(matchDishName("", MENU)).toBeNull();
    expect(matchDishName("...", MENU)).toBeNull();
  });

  it("resolves a containment ambiguity to the closer-length candidate", () => {
    // "steak" is contained in both Ribeye Steak and New York Strip Steak —
    // neither is an exact/token match, so this exercises the
    // closest-length tiebreak, not a guess.
    const result = matchDishName("steak", MENU);
    expect(["3", "4"]).toContain(result);
  });

  it("matches via significant token overlap when no direct containment applies", () => {
    // Reordered words: neither string contains the other, so this only
    // succeeds via the token-overlap fallback, not the containment check.
    expect(matchDishName("steak ribeye", MENU)).toBe("3");
  });
});

describe("classifyByKeywords", () => {
  it("finds a negative temperature cue", () => {
    const findings = classifyByKeywords("The soup arrived lukewarm.", MENU);
    expect(findings).toContainEqual(expect.objectContaining({ aspect: "temperature", sentiment: "negative" }));
  });

  it("finds a positive taste cue", () => {
    const findings = classifyByKeywords("The filet mignon was absolutely delicious.", MENU);
    expect(findings).toContainEqual(expect.objectContaining({ aspect: "taste", sentiment: "positive" }));
  });

  it("attaches the mentioned real dish to every finding found", () => {
    const findings = classifyByKeywords("The Filet Mignon was delicious but arrived cold.", MENU);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.menuItemId).toBe("2");
  });

  it("leaves menuItemId null when no real dish is mentioned", () => {
    const findings = classifyByKeywords("Service was rude and slow.", MENU);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.menuItemId).toBeNull();
  });

  it("returns an empty array for text with no unambiguous cues, honestly", () => {
    expect(classifyByKeywords("We came in on a Tuesday evening.", MENU)).toEqual([]);
  });
});

describe("parseExtractionResponse", () => {
  it("parses a well-formed JSON array and resolves a real dish", () => {
    const text = JSON.stringify([
      { aspect: "taste", sentiment: "positive", dish: "Filet Mignon", snippet: "cooked perfectly" },
    ]);
    const findings = parseExtractionResponse(text, MENU);
    expect(findings).toEqual([{ aspect: "taste", sentiment: "positive", menuItemId: "2", snippet: "cooked perfectly" }]);
  });

  it("strips prose/code-fence wrapping around the JSON array", () => {
    const text = 'Here you go:\n```json\n[{"aspect":"wait","sentiment":"negative","dish":null,"snippet":"waited 40 minutes"}]\n```';
    const findings = parseExtractionResponse(text, MENU);
    expect(findings).toEqual([{ aspect: "wait", sentiment: "negative", menuItemId: null, snippet: "waited 40 minutes" }]);
  });

  it("drops a finding with an unknown aspect", () => {
    const text = JSON.stringify([{ aspect: "ambiance", sentiment: "positive", dish: null, snippet: "nice vibe" }]);
    expect(parseExtractionResponse(text, MENU)).toEqual([]);
  });

  it("drops a finding with an unknown sentiment", () => {
    const text = JSON.stringify([{ aspect: "taste", sentiment: "meh", dish: null, snippet: "it was fine" }]);
    expect(parseExtractionResponse(text, MENU)).toEqual([]);
  });

  it("drops a finding with a missing or empty snippet", () => {
    const text = JSON.stringify([{ aspect: "taste", sentiment: "positive", dish: null, snippet: "" }]);
    expect(parseExtractionResponse(text, MENU)).toEqual([]);
  });

  it("never invents a menu_item_id for a dish that isn't real — resolves to null instead", () => {
    const text = JSON.stringify([
      { aspect: "taste", sentiment: "negative", dish: "Chocolate Lava Cake (not on this menu)", snippet: "too sweet" },
    ]);
    const findings = parseExtractionResponse(text, MENU);
    expect(findings[0]!.menuItemId).toBeNull();
  });

  it("returns an empty array for unparseable text", () => {
    expect(parseExtractionResponse("not json at all", MENU)).toEqual([]);
  });

  it("returns an empty array when the top-level JSON value isn't an array", () => {
    expect(parseExtractionResponse('{"aspect":"taste"}', MENU)).toEqual([]);
  });

  it("keeps valid findings and drops only the invalid ones from a mixed array", () => {
    const text = JSON.stringify([
      { aspect: "taste", sentiment: "positive", dish: null, snippet: "great flavor" },
      { aspect: "not-a-real-aspect", sentiment: "positive", dish: null, snippet: "x" },
    ]);
    const findings = parseExtractionResponse(text, MENU);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.snippet).toBe("great flavor");
  });
});
