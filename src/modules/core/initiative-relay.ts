/**
 * Pure helpers of the **initiative relay** (no Foundry globals, unit tested).
 *
 * A player may roll initiative from the HUD, but Foundry's server refuses to
 * store the initiative of a combatant whose actor the player does not own. The
 * roll is therefore relayed to the GM's client through the module socket.
 *
 * The socket carries no authenticated sender, so the GM's client validates the
 * request against the chat message that carries the roll (the server
 * authenticates its author and its content).
 */

/** The initiative data a roll message carries in its module flag. */
export interface InitiativeFlag {
  combatantId: string;
  total: number;
}

/** Payload sent by a player asking the GM to store their initiative. */
export interface InitiativeRequest {
  type: "applyInitiative";
  /** Combatant whose initiative must be written. */
  combatantId: string;
  /** Rolled value (the roll total). */
  total: number;
  /** Id of the chat message carrying the roll (server authenticated). */
  messageId: string;
  /** Id of the user who rolled (cross-checked against the message author). */
  userId: string;
}

/** Parse and validate the payload of a socket request. */
export function parseInitiativeRequest(payload: unknown): InitiativeRequest | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Partial<InitiativeRequest>;
  if (raw.type !== "applyInitiative") return null;
  if (typeof raw.combatantId !== "string" || !raw.combatantId) return null;
  if (typeof raw.total !== "number" || !Number.isFinite(raw.total)) return null;
  if (typeof raw.messageId !== "string" || !raw.messageId) return null;
  if (typeof raw.userId !== "string" || !raw.userId) return null;
  return {
    type: "applyInitiative",
    combatantId: raw.combatantId,
    total: raw.total,
    messageId: raw.messageId,
    userId: raw.userId
  };
}

/** Read the module flag of a roll message: `{ combatantId, total }`. */
export function readInitiativeFlag(
  flags: Record<string, Record<string, unknown> | undefined> | undefined
): InitiativeFlag | null {
  if (!flags) return null;
  const raw = flags["pokemon-hud-combat"]?.initiative as
    | { combatantId?: unknown; total?: unknown }
    | undefined;
  if (!raw) return null;
  const { combatantId, total } = raw;
  if (typeof combatantId !== "string" || !combatantId) return null;
  if (typeof total !== "number" || !Number.isFinite(total)) return null;
  return { combatantId, total };
}

/** Every fact the GM's client needs to judge a relayed initiative request. */
export interface RelayCheck {
  /** The client that received the request belongs to a GM. */
  isGM: boolean;
  /** The requester is a GM (a GM never needs the relay). */
  requesterIsGM: boolean;
  /** The combatant already rolled. */
  alreadyRolled: boolean;
  /** The roll message was found on this client. */
  messageFound: boolean;
  /** The message flag matches the requested combatant and total. */
  flagMatches: boolean;
  /** The message was authored by the requester. */
  authorMatches: boolean;
  /** The requester owns (or controls) the combatant. */
  entitled: boolean;
  /** The GM opened the relay to every player (module setting). */
  trustPlayers: boolean;
}

/**
 * May the GM's client store the relayed initiative?
 *
 * Every check but the entitlement one is about authenticity: the request must
 * come from a player, for a pending combatant, and be backed by the player's
 * own roll message. The entitlement (the player owns the combatant) can be
 * waived by the GM through the `playerInitiative` setting.
 */
export function canApplyRelay(check: RelayCheck): boolean {
  if (!check.isGM) return false;
  if (check.requesterIsGM) return false;
  if (check.alreadyRolled) return false;
  if (!check.messageFound) return false;
  if (!check.flagMatches) return false;
  if (!check.authorMatches) return false;
  if (!check.entitled && !check.trustPlayers) return false;
  return true;
}
