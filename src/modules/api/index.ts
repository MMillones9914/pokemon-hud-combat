import {
  hideCombatHud,
  isCombatHudVisible,
  showCombatHud,
  toggleCombatHud
} from "../apps/CombatHudApp";
import { buildCombatView, gateForCombatant } from "../core/hud-context";
import type { CombatView, InitiativeGateResult } from "../types/index";

const MODULE_ID = "pokemon-hud-combat";

export interface PokemonHudCombatApi {
  version: string;
  show: () => void;
  hide: () => void;
  toggle: () => void;
  isVisible: () => boolean;
  /** Current ordered view (trainer cards with their nested active Pokémon). */
  getView: () => CombatView;
  /** Initiative gate for a Combatant (rule 1: trainers need an active Pokémon). */
  canRollInitiative: (combatant: Combatant) => InitiativeGateResult;
}

const api: PokemonHudCombatApi = {
  version: "0.4.2",
  show: showCombatHud,
  hide: hideCombatHud,
  toggle: toggleCombatHud,
  isVisible: isCombatHudVisible,
  getView: buildCombatView,
  canRollInitiative: gateForCombatant
};

export function registerApi(): void {
  const module = game.modules.get(MODULE_ID) as unknown as { api?: PokemonHudCombatApi };
  if (module) module.api = api;
}
