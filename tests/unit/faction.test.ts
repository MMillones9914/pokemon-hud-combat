import { describe, it, expect } from "vitest";
import { classifyFaction } from "../../src/modules/core/faction";

describe("classifyFaction", () => {
  it("marks friendly tokens as allies for the GM", () => {
    expect(classifyFaction(1, null)).toBe("ally");
  });

  it("marks hostile tokens as enemies for the GM", () => {
    expect(classifyFaction(-1, null)).toBe("enemy");
  });

  it("treats neutral tokens as neither ally nor enemy", () => {
    expect(classifyFaction(0, null)).toBe("neutral");
  });

  it("compares against the viewing player's own disposition", () => {
    expect(classifyFaction(1, 1)).toBe("ally");
    expect(classifyFaction(-1, -1)).toBe("ally");
    expect(classifyFaction(-1, 1)).toBe("enemy");
    expect(classifyFaction(1, -1)).toBe("enemy");
  });

  it("falls back to the global reading when the player token is neutral", () => {
    expect(classifyFaction(-1, 0)).toBe("enemy");
    expect(classifyFaction(1, 0)).toBe("ally");
  });

  it("returns neutral for missing or invalid dispositions", () => {
    expect(classifyFaction(null, null)).toBe("neutral");
    expect(classifyFaction(undefined, 1)).toBe("neutral");
    expect(classifyFaction(Number.NaN, 1)).toBe("neutral");
  });
});
