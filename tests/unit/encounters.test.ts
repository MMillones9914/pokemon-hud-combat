import { describe, it, expect } from "vitest";
import {
  encounterLabelKey,
  ENCOUNTER_KINDS,
  isEncounterImplemented,
  normalizeEncounterKind
} from "../../src/modules/core/encounters";

describe("ENCOUNTER_KINDS", () => {
  it("lists every encounter type once, trainers first", () => {
    expect(ENCOUNTER_KINDS[0]).toBe("trainers");
    expect(new Set(ENCOUNTER_KINDS).size).toBe(ENCOUNTER_KINDS.length);
    expect(ENCOUNTER_KINDS).toContain("alpha");
  });
});

describe("encounterLabelKey", () => {
  it("builds a module-prefixed localization key", () => {
    expect(encounterLabelKey("trainers")).toBe("pokemon-hud-combat.encounter.trainers");
    expect(encounterLabelKey("alpha")).toBe("pokemon-hud-combat.encounter.alpha");
  });
});

describe("isEncounterImplemented", () => {
  it("only wires up trainer encounters for now", () => {
    expect(isEncounterImplemented("trainers")).toBe(true);
    expect(isEncounterImplemented("casual")).toBe(false);
    expect(isEncounterImplemented("gym")).toBe(false);
    expect(isEncounterImplemented("leader")).toBe(false);
    expect(isEncounterImplemented("wild")).toBe(false);
    expect(isEncounterImplemented("alpha")).toBe(false);
  });
});

describe("normalizeEncounterKind", () => {
  it("passes through known kinds", () => {
    expect(normalizeEncounterKind("gym")).toBe("gym");
  });

  it("falls back to trainers for unknown or non-string input", () => {
    expect(normalizeEncounterKind("nope")).toBe("trainers");
    expect(normalizeEncounterKind(undefined)).toBe("trainers");
    expect(normalizeEncounterKind(42)).toBe("trainers");
  });
});
