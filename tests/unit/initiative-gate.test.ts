import { describe, it, expect } from "vitest";
import { canRollInitiative, canRollFromPortrait } from "../../src/modules/core/initiative-gate";

describe("canRollFromPortrait", () => {
  it("allows a GM to roll any pending, rollable card", () => {
    expect(canRollFromPortrait({ isGM: true, owned: false, rollable: true, hasInitiative: false })).toBe(true);
  });
  it("allows a player to roll their own pending card", () => {
    expect(canRollFromPortrait({ isGM: false, owned: true, rollable: true, hasInitiative: false })).toBe(true);
  });
  it("blocks a player from rolling somebody else's card", () => {
    expect(canRollFromPortrait({ isGM: false, owned: false, rollable: true, hasInitiative: false })).toBe(false);
  });
  it("blocks a card that already has initiative", () => {
    expect(canRollFromPortrait({ isGM: true, owned: true, rollable: true, hasInitiative: true })).toBe(false);
  });
  it("blocks a card that fails the initiative gate", () => {
    expect(canRollFromPortrait({ isGM: true, owned: true, rollable: false, hasInitiative: false })).toBe(false);
  });
});
describe("canRollInitiative", () => {
  it("allows a wild Pokémon without restrictions", () => {
    expect(canRollInitiative({ isTrainer: false, hasActivePokemon: false }).allowed).toBe(true);
  });

  it("allows a trainer with an active Pokémon", () => {
    const result = canRollInitiative({ isTrainer: true, hasActivePokemon: true });
    expect(result.allowed).toBe(true);
    expect(result.blockedKey).toBeNull();
  });

  it("blocks a trainer without an active Pokémon", () => {
    const result = canRollInitiative({ isTrainer: true, hasActivePokemon: false });
    expect(result.allowed).toBe(false);
    expect(result.blockedKey).toBe("pokemon-hud-combat.error.noActivePokemon");
  });

  it("lets a player roll their own combatant without a resolved Pokémon", () => {
    const result = canRollInitiative({
      isTrainer: true,
      hasActivePokemon: false,
      isGM: false,
      ownsCombatant: true
    });
    expect(result.allowed).toBe(true);
    expect(result.blockedKey).toBeNull();
  });

  it("never uses ownership to bypass a GM's disabled gmBypass", () => {
    const result = canRollInitiative({
      isTrainer: true,
      hasActivePokemon: false,
      isGM: true,
      gmBypass: false,
      ownsCombatant: false
    });
    expect(result.allowed).toBe(false);
  });

  it("lets GMs bypass the gate when gmBypass is on", () => {
    const result = canRollInitiative({
      isTrainer: true,
      hasActivePokemon: false,
      isGM: true,
      gmBypass: true
    });
    expect(result.allowed).toBe(true);
  });

  it("does not bypass the gate when gmBypass is off", () => {
    const result = canRollInitiative({
      isTrainer: true,
      hasActivePokemon: false,
      isGM: true,
      gmBypass: false
    });
    expect(result.allowed).toBe(false);
  });

  it("gmBypass defaults to on", () => {
    expect(
      canRollInitiative({ isTrainer: true, hasActivePokemon: false, isGM: true }).allowed
    ).toBe(true);
  });
});
