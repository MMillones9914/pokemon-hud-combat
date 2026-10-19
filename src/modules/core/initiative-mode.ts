/** Keyboard modifier result for an initiative roll from the HUD. */
export type InitiativeRollMode = "normal" | "advantage" | "disadvantage";

/**
 * Rewrite an initiative formula so the roll keeps the highest (advantage) or
 * lowest (disadvantage) of two dice — pure.
 *
 * `1d20 + @mod` → `2d20kh1 + @mod` / `2d20kl1 + @mod`.
 * Formulas without a dice term are returned unchanged, so a system with a
 * non-dice initiative simply ignores the modifier.
 */
export function applyInitiativeMode(
  formula: string | null | undefined,
  mode: InitiativeRollMode
): string {
  const base = typeof formula === "string" && formula.trim() ? formula.trim() : "1d20";
  if (mode === "normal") return base;

  const match = /(\d*)d(\d+)/i.exec(base);
  if (!match || match.index === undefined) return base;
  const count = match[1] ? Number.parseInt(match[1], 10) : 1;
  const faces = match[2];
  if (!Number.isFinite(count) || count < 1 || !faces) return base;

  const keep = mode === "advantage" ? "kh" : "kl";
  const replacement = `${count * 2}d${faces}${keep}${count}`;
  return base.slice(0, match.index) + replacement + base.slice(match.index + match[0].length);
}
