import { describe, it, expect } from "vitest";
import {
  encounterLabelKey,
  ENCOUNTER_KINDS,
  isEncounterImplemented,
  normalizeEncounterKind,
  parseRivalTeams,
  resolveRivalTeam
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

describe("parseRivalTeams", () => {
  it("splits on newlines and trims each entry", () => {
    expect(parseRivalTeams("Team Rocket\n  Team Aqua  \nTeam Magma")).toEqual([
      "Team Rocket",
      "Team Aqua",
      "Team Magma"
    ]);
  });

  it("drops blank lines and handles CRLF", () => {
    expect(parseRivalTeams("A\r\n\r\nB\n")).toEqual(["A", "B"]);
  });

  it("removes duplicates case-insensitively, keeping the first spelling", () => {
    expect(parseRivalTeams("Team Rocket\nteam rocket\nTEAM ROCKET")).toEqual(["Team Rocket"]);
  });

  it("returns an empty list for non-strings and blanks", () => {
    expect(parseRivalTeams(null)).toEqual([]);
    expect(parseRivalTeams(undefined)).toEqual([]);
    expect(parseRivalTeams("   \n  ")).toEqual([]);
  });
});

describe("resolveRivalTeam", () => {
  const teams = ["Team Rocket", "Team Aqua"];

  it("picks the preferred team case-insensitively", () => {
    expect(resolveRivalTeam(teams, "team aqua")).toBe("Team Aqua");
  });

  it("falls back to the first team when the pick is unknown or empty", () => {
    expect(resolveRivalTeam(teams, "Team Magma")).toBe("Team Rocket");
    expect(resolveRivalTeam(teams, "")).toBe("Team Rocket");
    expect(resolveRivalTeam(teams, null)).toBe("Team Rocket");
  });

  it("returns an empty string when no teams are configured", () => {
    expect(resolveRivalTeam([], "Team Rocket")).toBe("");
  });
});
