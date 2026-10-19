/** Visual faction of a combatant card: light-blue (ally) or red (enemy) border. */
export type Faction = "ally" | "enemy" | "neutral";

/**
 * Classify a token as ally or enemy for the current user (pure).
 *
 * @param disposition     Token disposition (`CONST.TOKEN_DISPOSITIONS`).
 * @param userDisposition The viewing player's own token disposition (`null` for
 *                        the GM or when the player controls no token). When it
 *                        is unknown we fall back to the global reading:
 *                        hostile → enemy, friendly → ally.
 */
export function classifyFaction(
  disposition: number | null | undefined,
  userDisposition: number | null | undefined
): Faction {
  if (typeof disposition !== "number" || !Number.isFinite(disposition) || disposition === 0) {
    return "neutral";
  }
  const mine =
    typeof userDisposition === "number" && Number.isFinite(userDisposition) && userDisposition !== 0
      ? userDisposition
      : null;
  if (mine === null) return disposition < 0 ? "enemy" : "ally";
  return disposition === mine ? "ally" : "enemy";
}
