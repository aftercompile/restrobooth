import { describe, it, expect } from "vitest";
import { StubProvider } from "./stubProvider.js";

describe("StubProvider", () => {
  it("returns the identical completion for identical input (deterministic, not random)", async () => {
    const provider = new StubProvider();
    const a = await provider.complete({ prompt: "recommend a dish", maxTokens: 100 });
    const b = await provider.complete({ prompt: "recommend a dish", maxTokens: 100 });
    expect(a.text).toBe(b.text);
  });

  it("returns a different completion for different input", async () => {
    const provider = new StubProvider();
    const a = await provider.complete({ prompt: "recommend a dish", maxTokens: 100 });
    const b = await provider.complete({ prompt: "recommend a drink", maxTokens: 100 });
    expect(a.text).not.toBe(b.text);
  });

  it("system context changes the completion even with the same prompt", async () => {
    const provider = new StubProvider();
    const a = await provider.complete({ system: "be terse", prompt: "hello", maxTokens: 100 });
    const b = await provider.complete({ system: "be verbose", prompt: "hello", maxTokens: 100 });
    expect(a.text).not.toBe(b.text);
  });

  it("costs nothing", () => {
    const provider = new StubProvider();
    expect(provider.costPer1kTokens).toEqual({ input: 0, output: 0 });
  });

  it("embed() is deterministic and returns gte-small's 384 dims", async () => {
    const provider = new StubProvider();
    const [a] = await provider.embed(["butter chicken"]);
    const [b] = await provider.embed(["butter chicken"]);
    expect(a).toHaveLength(384);
    expect(a).toEqual(b);
  });

  it("embed() returns different vectors for different text", async () => {
    const provider = new StubProvider();
    const [a] = await provider.embed(["butter chicken"]);
    const [b] = await provider.embed(["paneer tikka"]);
    expect(a).not.toEqual(b);
  });
});
