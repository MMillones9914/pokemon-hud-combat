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

/**
 * Parse the GM-provided rival-team list. One team per line; blank lines and
 * surrounding whitespace are dropped, duplicates are removed (case-insensitive)
 * while preserving order.
 */
export function parseRivalTeams(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const name = line.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Resolve which rival team to display: the explicit pick when it is still part
 * of the list, otherwise the first configured team, otherwise an empty string.
 */
export function resolveRivalTeam(teams: string[], preferred?: string | null): string {
  if (typeof preferred === "string" && preferred.trim()) {
    const match = teams.find((team) => team.toLowerCase() === preferred.trim().toLowerCase());
    if (match) return match;
  }
  return teams[0] ?? "";
}
