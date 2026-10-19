import type { InitiativeGateInput, InitiativeGateResult } from "../types/index";

/**
 * Decide whether an initiative roll is allowed (pure).
 *
 * - Wild (non-trainer) combatants may always roll — they count with their own
 *   individual initiative (rule 4).
 * - Trainers may only roll while they have an active, summoned Pokémon
 *   (rule 1). Trainers whose Pokémon was withdrawn and not replaced are blocked.
 * - GMs bypass the gate when the `gmBypass` setting is on.
 */
export function canRollInitiative(input: InitiativeGateInput): InitiativeGateResult {
  const { isTrainer, hasActivePokemon, isGM = false, gmBypass = true } = input;

  if (isGM && gmBypass) return { allowed: true, blockedKey: null };

  if (!isTrainer) return { allowed: true, blockedKey: null };

  if (hasActivePokemon) return { allowed: true, blockedKey: null };

  return { allowed: false, blockedKey: "pokemon-hud-combat.error.noActivePokemon" };
}
