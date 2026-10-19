import { describe, it, expect } from "vitest";
import { buildCombatGroups, markActive } from "../../src/modules/core/combat-order";
import type { ActivePokemonInfo, RawCombatant } from "../../src/modules/core/combat-order";

function raw(partial: Partial<RawCombatant> & { id: string }): RawCombatant {
  return {
    id: partial.id,
    actorId: partial.actorId ?? `actor-${partial.id}`,
    name: partial.name ?? partial.id,
    img: partial.img ?? "img.svg",
    initiative: partial.initiative ?? null,
    defeated: partial.defeated ?? false,
    isTrainer: partial.isTrainer ?? false,
    hp: partial.hp ?? null
  };
}

function pokemon(partial: Partial<ActivePokemonInfo> = {}): ActivePokemonInfo {
  return {
    actorId: "pikachu-actor",
    name: "Pikachu",
    img: "pikachu.svg",
    hp: { current: 30, max: 50 },
    combatantId: null,
    initiative: null,
    defeated: false,
    ...partial
  };
}

describe("buildCombatGroups", () => {
  it("sorts groups by initiative descending, missing last", () => {
    const groups = buildCombatGroups(
      [
        raw({ id: "a", initiative: 5 }),
        raw({ id: "b", initiative: 18 }),
        raw({ id: "c", initiative: null })
      ],
      {}
    );
    expect(groups.map((g) => g.combatantId)).toEqual(["b", "a", "c"]);
  });

  it("keeps tracker order for tied initiatives", () => {
    const groups = buildCombatGroups(
      [
        raw({ id: "a", initiative: 12 }),
        raw({ id: "b", initiative: 12 }),
        raw({ id: "c", initiative: 12 })
      ],
      {}
    );
    expect(groups.map((g) => g.combatantId)).toEqual(["a", "b", "c"]);
  });

  it("nests the active Pokémon directly below its trainer", () => {
    const groups = buildCombatGroups(
      [raw({ id: "trainer", actorId: "ash", initiative: 9, isTrainer: true })],
      { ash: pokemon() }
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].kind).toBe("trainer");
    expect(groups[0].pokemon?.name).toBe("Pikachu");
  });

  it("does not show a nested Pokémon as its own top-level card", () => {
    const groups = buildCombatGroups(
      [
        raw({ id: "trainer", actorId: "ash", initiative: 9, isTrainer: true }),
        raw({ id: "pika-combatant", actorId: "pikachu-actor", initiative: 20, name: "Pikachu" })
      ],
      { ash: pokemon({ combatantId: "pika-combatant", initiative: 20 }) }
    );
    expect(groups.map((g) => g.combatantId)).toEqual(["trainer"]);
    expect(groups[0].pokemon?.initiative).toBe(20);
  });

  it("sorts the Pokémon's initiative separately from the group's initiative", () => {
    const groups = buildCombatGroups(
      [
        raw({ id: "slow-trainer", actorId: "ash", initiative: 3, isTrainer: true }),
        raw({ id: "fast-wild", initiative: 25 })
      ],
      { ash: pokemon({ combatantId: "pika-combatant", initiative: 20 }) }
    );
    expect(groups.map((g) => g.combatantId)).toEqual(["fast-wild", "slow-trainer"]);
    expect(groups[1].pokemon?.initiative).toBe(20);
  });

  it("keeps wild Pokémon as top-level cards", () => {
    const groups = buildCombatGroups([raw({ id: "wild", initiative: 14 })], {});
    expect(groups[0].kind).toBe("wild");
    expect(groups[0].pokemon).toBeNull();
  });

  it("marks trainers without an active Pokémon as blocked", () => {
    const groups = buildCombatGroups(
      [raw({ id: "trainer", actorId: "ash", isTrainer: true, initiative: 8 })],
      { ash: null }
    );
    expect(groups[0].rollable).toBe(false);
    expect(groups[0].blockedKey).toBe("pokemon-hud-combat.error.noActivePokemon");
  });

  it("marks wild and active trainers as rollable", () => {
    const groups = buildCombatGroups(
      [
        raw({ id: "wild", initiative: 8 }),
        raw({ id: "trainer", actorId: "ash", isTrainer: true, initiative: 8 })
      ],
      { ash: pokemon() }
    );
    expect(groups.every((g) => g.rollable)).toBe(true);
  });

  it("lets the GM bypass roll blockages", () => {
    const groups = buildCombatGroups(
      [raw({ id: "trainer", actorId: "ash", isTrainer: true, initiative: 8 })],
      { ash: null },
      { gmBypassActive: true }
    );
    expect(groups[0].rollable).toBe(true);
    expect(groups[0].blockedKey).toBeNull();
  });

  it("ignores an active Pokémon entry whose trainer is not present", () => {
    const groups = buildCombatGroups([raw({ id: "wild", initiative: 8 })], {
      "missing-trainer": pokemon({ combatantId: "other" })
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].pokemon).toBeNull();
  });

  it("keeps defeated combatants in the list so they can be dimmed", () => {
    const groups = buildCombatGroups([raw({ id: "a", initiative: 4, defeated: true })], {});
    expect(groups[0].defeated).toBe(true);
  });
});

describe("markActive", () => {
  const groups = () =>
    buildCombatGroups(
      [
        raw({ id: "trainer", actorId: "ash", initiative: 9, isTrainer: true }),
        raw({ id: "wild", initiative: 15 })
      ],
      { ash: pokemon({ combatantId: "pika-combatant", initiative: 20 }) }
    );

  it("marks the group whose Combatant owns the turn", () => {
    const result = markActive(groups(), "wild");
    expect(result[0].active).toBe(true);
    expect(result[1].active).toBe(false);
  });

  it("marks the nested Pokémon when its own Combatant owns the turn", () => {
    const result = markActive(groups(), "pika-combatant");
    const trainer = result.find((g) => g.combatantId === "trainer");
    expect(trainer?.active).toBe(false);
    expect(trainer?.pokemon?.active).toBe(true);
  });

  it("clears everything when the combat has no active combatant", () => {
    const result = markActive(groups(), null);
    expect(result.every((g) => !g.active && !g.pokemon?.active)).toBe(true);
  });
});
