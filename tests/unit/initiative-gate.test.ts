import { describe, it, expect } from "vitest";
import { canRollInitiative } from "../../src/modules/core/initiative-gate";

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
