import { describe, it, expect } from "vitest";
import { applyInitiativeMode } from "../../src/modules/core/initiative-mode";

describe("applyInitiativeMode", () => {
  it("keeps the plain formula for a normal roll", () => {
    expect(applyInitiativeMode("1d20", "normal")).toBe("1d20");
    expect(applyInitiativeMode("1d20 + 3", "normal")).toBe("1d20 + 3");
  });

  it("rolls with advantage (keep highest) on the leading die", () => {
    expect(applyInitiativeMode("1d20", "advantage")).toBe("2d20kh1");
    expect(applyInitiativeMode("1d20 + @mod", "advantage")).toBe("2d20kh1 + @mod");
    expect(applyInitiativeMode("d20", "advantage")).toBe("2d20kh1");
  });

  it("rolls with disadvantage (keep lowest) on the leading die", () => {
    expect(applyInitiativeMode("1d20", "disadvantage")).toBe("2d20kl1");
    expect(applyInitiativeMode("1d20 + @mod + 2", "disadvantage")).toBe("2d20kl1 + @mod + 2");
  });

  it("keeps the count for multi-dice formulas", () => {
    expect(applyInitiativeMode("3d6", "advantage")).toBe("6d6kh3");
    expect(applyInitiativeMode("2d8", "disadvantage")).toBe("4d8kl2");
  });

  it("ignores modifiers on formulas without dice", () => {
    expect(applyInitiativeMode("@init", "advantage")).toBe("@init");
    // A missing formula falls back to the default 1d20, which the mode can apply to.
    expect(applyInitiativeMode("", "advantage")).toBe("2d20kh1");
    expect(applyInitiativeMode(null, "disadvantage")).toBe("2d20kl1");
  });

  it("only rewrites the first dice term", () => {
    expect(applyInitiativeMode("1d20 + 2d6", "advantage")).toBe("2d20kh1 + 2d6");
  });
});
