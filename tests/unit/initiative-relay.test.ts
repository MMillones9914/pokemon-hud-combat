import { describe, it, expect } from "vitest";
import {
  canApplyRelay,
  parseInitiativeRequest,
  readInitiativeFlag,
  type RelayCheck
} from "../../src/modules/core/initiative-relay";

const VALID_REQUEST = {
  type: "applyInitiative" as const,
  combatantId: "abc123",
  total: 17,
  messageId: "msg1",
  userId: "user1"
};

/** A request that passes every check. */
const VALID_CHECK: RelayCheck = {
  isGM: true,
  requesterIsGM: false,
  alreadyRolled: false,
  messageFound: true,
  flagMatches: true,
  authorMatches: true,
  entitled: true,
  trustPlayers: false
};

describe("parseInitiativeRequest", () => {
  it("accepts a well formed request", () => {
    expect(parseInitiativeRequest(VALID_REQUEST)).toEqual(VALID_REQUEST);
  });

  it("rejects anything that is not an initiative request", () => {
    expect(parseInitiativeRequest(null)).toBeNull();
    expect(parseInitiativeRequest("applyInitiative")).toBeNull();
    expect(parseInitiativeRequest({ type: "somethingElse" })).toBeNull();
  });

  it("rejects requests with missing or invalid fields", () => {
    expect(parseInitiativeRequest({ ...VALID_REQUEST, combatantId: "" })).toBeNull();
    expect(parseInitiativeRequest({ ...VALID_REQUEST, total: "17" })).toBeNull();
    expect(parseInitiativeRequest({ ...VALID_REQUEST, total: Number.NaN })).toBeNull();
    expect(parseInitiativeRequest({ ...VALID_REQUEST, messageId: "" })).toBeNull();
    expect(parseInitiativeRequest({ ...VALID_REQUEST, userId: "" })).toBeNull();
  });
});

describe("readInitiativeFlag", () => {
  it("reads the flag of a roll message", () => {
    const flags = { "pokemon-hud-combat": { initiative: { combatantId: "abc", total: 9 } } };
    expect(readInitiativeFlag(flags)).toEqual({ combatantId: "abc", total: 9 });
  });

  it("ignores messages without the module flag", () => {
    expect(readInitiativeFlag(undefined)).toBeNull();
    expect(readInitiativeFlag({})).toBeNull();
    expect(readInitiativeFlag({ "pokemon-hud-combat": {} })).toBeNull();
    expect(readInitiativeFlag({ "pokemon-hud-combat": { initiative: true } })).toBeNull();
  });

  it("ignores malformed flag payloads", () => {
    expect(
      readInitiativeFlag({ "pokemon-hud-combat": { initiative: { combatantId: 5, total: 9 } } })
    ).toBeNull();
    expect(
      readInitiativeFlag({ "pokemon-hud-combat": { initiative: { combatantId: "abc" } } })
    ).toBeNull();
  });
});

describe("canApplyRelay", () => {
  it("accepts a valid request from a player", () => {
    expect(canApplyRelay(VALID_CHECK)).toBe(true);
  });

  it("never acts on a client that is not the GM", () => {
    expect(canApplyRelay({ ...VALID_CHECK, isGM: false })).toBe(false);
  });

  it("never relays a request made by a GM", () => {
    expect(canApplyRelay({ ...VALID_CHECK, requesterIsGM: true })).toBe(false);
  });

  it("never overwrites an initiative that was already rolled", () => {
    expect(canApplyRelay({ ...VALID_CHECK, alreadyRolled: true })).toBe(false);
  });

  it("requires the roll message and a matching flag", () => {
    expect(canApplyRelay({ ...VALID_CHECK, messageFound: false })).toBe(false);
    expect(canApplyRelay({ ...VALID_CHECK, flagMatches: false })).toBe(false);
  });

  it("requires the message to be authored by the requester", () => {
    expect(canApplyRelay({ ...VALID_CHECK, authorMatches: false })).toBe(false);
  });

  it("refuses a player that does not own the combatant", () => {
    expect(canApplyRelay({ ...VALID_CHECK, entitled: false })).toBe(false);
  });

  it("accepts an unentitled player when the GM trusts the players", () => {
    expect(canApplyRelay({ ...VALID_CHECK, entitled: false, trustPlayers: true })).toBe(true);
  });
});
