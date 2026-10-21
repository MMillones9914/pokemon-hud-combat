/**
 * Encounter kinds shown by the battle intro screen (pure, no Foundry globals).
 *
 * v0.3 ships the full selector, but only `trainers` is wired to a screen so
 * far; the remaining kinds are declared here so the popup, the localization
 * keys and future work all share one source of truth.
 */
export type EncounterKind = "trainers" | "casual" | "gym" | "leader" | "wild" | "alpha";

/** Ordered list used to build the popup's selector. */
export const ENCOUNTER_KINDS: EncounterKind[] = [
  "trainers",
  "casual",
  "gym",
  "leader",
  "wild",
  "alpha"
];

/** Kinds that already render a full screen. Everything else is a placeholder. */
const IMPLEMENTED: ReadonlySet<EncounterKind> = new Set<EncounterKind>(["trainers"]);

/** Localization key for an encounter label (`pokemon-hud-combat.encounter.<kind>`). */
export function encounterLabelKey(kind: EncounterKind): string {
  return `pokemon-hud-combat.encounter.${kind}`;
}

/** Whether an encounter kind has a working screen behind it. */
export function isEncounterImplemented(kind: EncounterKind): boolean {
  return IMPLEMENTED.has(kind);
}

/** Coerce arbitrary input (a select value, a flag) into a known kind. */
export function normalizeEncounterKind(value: unknown): EncounterKind {
  return typeof value === "string" && (ENCOUNTER_KINDS as string[]).includes(value)
    ? (value as EncounterKind)
    : "trainers";
}

