import type { InitiativeGateInput, InitiativeGateResult } from "../types/index";

/**
 * Decide whether an initiative roll is allowed (pure).
 *
 * - Wild (non-trainer) combatants may always roll — they count with their own
 *   individual initiative (rule 4).
 * - A player may always roll **their own** combatant (the sheet they own).
 *   Their active-Pokémon data depends on flags written by pokemon-hud-like and
 *   is not always resolvable on the player's client, so owning the combatant is
 *   the proof that they may roll it.
 * - Trainers may only roll while they have an active, summoned Pokémon
 *   (rule 1). Trainers whose Pokémon was withdrawn and not replaced are blocked.
 * - GMs bypass the gate when the `gmBypass` setting is on.
 */
export function canRollInitiative(input: InitiativeGateInput): InitiativeGateResult {
  const {
    isTrainer,
    hasActivePokemon,
    isGM = false,
    gmBypass = true,
    ownsCombatant = false
  } = input;

  if (isGM && gmBypass) return { allowed: true, blockedKey: null };

  if (!isTrainer) return { allowed: true, blockedKey: null };

  if (hasActivePokemon) return { allowed: true, blockedKey: null };

  // Rule 1 must never lock a player out of their own initiative: the local
  // view cannot always resolve the trainer's summoned Pokémon.
  if (ownsCombatant) return { allowed: true, blockedKey: null };

  return { allowed: false, blockedKey: "pokemon-hud-combat.error.noActivePokemon" };
}
