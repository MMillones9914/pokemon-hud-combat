import type { CombatGroup, HpSnapshot, PokemonRow } from "../types/index";
import { classifyFaction } from "./faction";

/** A Combatant flattened to plain data (pure input). */
export interface RawCombatant {
  /** Combatant id. */
  id: string;
  /** Base Actor id (or synthetic token actor id). */
  actorId: string;
  name: string;
  img: string;
  initiative: number | null;
  defeated: boolean;
  /** Actor follows trainer rules (vs. wild Pokémon). */
  isTrainer: boolean;
  hp: HpSnapshot | null;
  /** Token disposition used to derive the ally/enemy card border. */
  disposition: number | null;
}

/** The trainer's active Pokémon resolved from flags/tokens (may lack a Combatant). */
export interface ActivePokemonInfo {
  actorId: string;
  name: string;
  img: string;
  hp: HpSnapshot | null;
  /** Combatant id when the Pokémon itself was added to combat. */
  combatantId: string | null;
  initiative: number | null;
  defeated: boolean;
}

export interface BuildGroupsOptions {
  /** `isGM && gmBypass` — when true every entry is rollable. */
  gmBypassActive?: boolean;
  /** Disposition of the viewing player's own token (null for the GM). */
  userDisposition?: number | null;
}

/**
 * Build the ordered top-bar groups (pure):
 *
 * 1. Every Combatant that is the active Pokémon of a trainer present in combat
 *    is nested directly below that trainer — always immediately after it, no
 *    matter what initiative each has (rule 3).
 * 2. Trainers and wild Pokémon that are not someone's active Pokémon are
 *    top-level cards; wild entries keep their own individual initiative
 *    (rule 4).
 * 3. Groups sort by initiative descending (missing initiative last, ties keep
 *    tracker order).
 * 4. Trainers without an active Pokémon are flagged as non-rollable (rule 1).
 */
export function buildCombatGroups(
  combatants: RawCombatant[],
  activeByTrainerActor: Record<string, ActivePokemonInfo | null>,
  options: BuildGroupsOptions = {}
): CombatGroup[] {
  const gmBypassActive = options.gmBypassActive ?? false;
  const userDisposition = options.userDisposition ?? null;

  // Which combatants are someone's active Pokémon → nested, never top-level.
  const nestedCombatantIds = new Set<string>();
  for (const info of Object.values(activeByTrainerActor)) {
    if (info?.combatantId) nestedCombatantIds.add(info.combatantId);
  }

  const groups: CombatGroup[] = [];

  combatants.forEach((raw) => {
    if (nestedCombatantIds.has(raw.id)) return;

    const active = activeByTrainerActor[raw.actorId] ?? null;
    const kind: CombatGroup["kind"] = raw.isTrainer ? "trainer" : "wild";
    const hasActivePokemon = kind === "trainer" && active !== null;

    const rollable = gmBypassActive || kind === "wild" || hasActivePokemon;

    const pokemon: PokemonRow | null = active
      ? {
          actorId: active.actorId,
          combatantId: active.combatantId,
          name: active.name,
          img: active.img,
          hp: active.hp,
          initiative: active.initiative,
          defeated: active.defeated,
          active: false
        }
      : null;

    const group: CombatGroup = {
      combatantId: raw.id,
      actorId: raw.actorId,
      kind,
      name: raw.name,
      img: raw.img,
      initiative: raw.initiative,
      defeated: raw.defeated,
      active: false,
      faction: classifyFaction(raw.disposition, userDisposition),
      rollable,
      blockedKey: rollable ? null : "pokemon-hud-combat.error.noActivePokemon",
      pokemon
    };
    groups.push(group);
  });

  // Initiative descending; missing initiative last; ties keep tracker order.
  const order = new Map(groups.map((g, i) => [g.combatantId, i]));
  groups.sort((a, b) => {
    const ai = a.initiative;
    const bi = b.initiative;
    if (ai === null && bi !== null) return 1;
    if (ai !== null && bi === null) return -1;
    if (ai !== null && bi !== null && ai !== bi) return bi - ai;
    return (order.get(a.combatantId) ?? 0) - (order.get(b.combatantId) ?? 0);
  });

  return groups;
}

interface MarkableGroup {
  combatantId: string;
  active: boolean;
  pokemon: { combatantId: string | null; active: boolean } | null;
}

/**
 * Flag the entry (group or nested Pokémon) whose Combatant owns the turn
 * (pure). Mutates and returns the same array — safe for `buildCombatGroups`
 * output.
 */
export function markActive<G extends MarkableGroup>(groups: G[], combatantId: string | null): G[] {
  for (const group of groups) {
    group.active = combatantId !== null && group.combatantId === combatantId;
    if (group.pokemon) {
      const pActive = combatantId !== null && group.pokemon.combatantId === combatantId;
      group.pokemon.active = pActive;
      // The turn belongs to the Pokémon → highlight it, not the trainer card.
      if (pActive) group.active = false;
    }
  }
  return groups;
}
