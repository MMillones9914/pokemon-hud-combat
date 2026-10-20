/** Visual faction of a combatant card: light-blue (ally) or red (enemy) border. */
export type Faction = "ally" | "enemy" | "neutral";

/**
 * Classify a token as ally or enemy for the current user (pure).
 *
 * @param disposition     Token disposition (`CONST.TOKEN_DISPOSITIONS`:
 *                        -2 hostile, -1 enemy, 0 secret/neutral, 1 friendly).
 * @param userDisposition The viewing player's own token disposition (`null` for
 *                        the GM or when the player controls no token).
 *
 * With a known `userDisposition` we compare the two sides directly. Without one
 * (GM, or no token controlled) we fall back to the sign, and treat the common
 * "secret/neutral" (0) case as friendly so allied combatants still get the
 * white frame instead of mid grey.
 */
export function classifyFaction(
  disposition: number | null | undefined,
  userDisposition: number | null | undefined
): Faction {
  if (typeof disposition !== "number" || !Number.isFinite(disposition)) return "neutral";
  const mine =
    typeof userDisposition === "number" && Number.isFinite(userDisposition) && userDisposition !== 0
      ? userDisposition
      : null;
  // Known viewer side: same side → ally, anything else → enemy.
  if (mine !== null) return disposition === mine ? "ally" : "enemy";
  // Unknown viewer side (GM / nothing controlled): hostile is enemy, the rest
  // (friendly, and Foundry's neutral 0) reads as ally.
  return disposition < 0 ? "enemy" : "ally";
}
