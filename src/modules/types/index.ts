import type { Faction } from "../core/faction";

/** Snapshot of an actor's HP used for the nested Pokémon row. */
export interface HpSnapshot {
  current: number;
  max: number;
}

/** The active Pokémon nested below its trainer's card. */
export interface PokemonRow {
  /** Actor id of the Pokémon (may exist without a Combatant). */
  actorId: string;
  /** Combatant id when the Pokémon itself is in the combat tracker. */
  combatantId: string | null;
  name: string;
  img: string;
  hp: HpSnapshot | null;
  initiative: number | null;
  defeated: boolean;
  active: boolean;
}

/** Top-level card: a trainer (with nested active Pokémon) or a wild combatant. */
export interface CombatGroup {
  combatantId: string;
  actorId: string;
  kind: "trainer" | "wild";
  name: string;
  img: string;
  initiative: number | null;
  defeated: boolean;
  active: boolean;
  /** Ally (light-blue border) vs. enemy (red border) for the viewing user. */
  faction: Faction;
  /** The viewing user owns this combatant (their own character / token). */
  owned: boolean;
  /** Whether the HUD may offer an initiative roll button for this entry. */
  rollable: boolean;
  /** Localization key explaining why rolling is blocked (when `rollable` is false). */
  blockedKey: string | null;
  pokemon: PokemonRow | null;
}

/** Everything the template needs to paint the top combat bar. */
export interface CombatView {
  /** True while a Combat document exists (started or not). */
  present: boolean;
  started: boolean;
  round: number;
  turn: number;
  /** Combatant id whose turn it is (may be null). */
  activeId: string | null;
  groups: CombatGroup[];
}

/** Input shape consumed by the pure initiative gate. */
export interface InitiativeGateInput {
  /** The actor follows the trainer rules (vs. wild Pokémon). */
  isTrainer: boolean;
  /** The trainer has a live, summoned active Pokémon. */
  hasActivePokemon: boolean;
  /** User running the roll is GM. */
  isGM?: boolean;
  /** Whether GMs bypass the gate (module setting). */
  gmBypass?: boolean;
  /**
   * The user running the roll owns this combatant (their own character).
   * Owning the sheet is proof enough to roll one's own initiative.
   */
  ownsCombatant?: boolean;
}

/** Input of the HUD portrait click decision (`canRollFromPortrait`, pure). */
export interface PortraitRollInput {
  /** The viewing user is the GM. */
  isGM: boolean;
  /** The viewing user owns the combatant (their own character). */
  owned: boolean;
  /** The card passes the initiative gate (rule 1). */
  rollable: boolean;
  /** The combatant already has an initiative. */
  hasInitiative: boolean;
}

export interface InitiativeGateResult {
  allowed: boolean;
  /** Localization key for a warning when denied, null when allowed. */
  blockedKey: string | null;
}
