import type { InitiativeRequest } from "./initiative-relay";
import { canApplyRelay, parseInitiativeRequest, readInitiativeFlag } from "./initiative-relay";
import { logger } from "./logger";
import { userOwnsCombatant } from "./ownership";
import { getSettings } from "./settings";

const MODULE_ID = "pokemon-hud-combat";

/**
 * Foundry's per-module socket namespace.
 *
 * The manifest declares `"socket": true`, so the server opens a
 * `module.pokemon-hud-combat` channel and relays every event emitted on it to
 * the other connected clients of the world.
 */
export const SOCKET_EVENT = `module.${MODULE_ID}`;

export type { InitiativeRequest };

let registered = false;

/** Minimal surface of a chat message the relay validates against. */
interface FlaggedMessage {
  id?: string;
  /** Author of the message (server authenticated). */
  user?: { id?: string } | null;
  flags?: Record<string, Record<string, unknown> | undefined>;
}

function findCombatant(combatantId: string): Combatant | undefined {
  try {
    return Array.from(game.combat?.combatants ?? []).find((c) => c.id === combatantId);
  } catch {
    return undefined;
  }
}

/**
 * Look up a chat message, retrying a few times.
 *
 * The socket request and the chat message travel through different channels:
 * the message may not have reached this client yet when the request arrives.
 */
async function findMessage(messageId: string): Promise<FlaggedMessage | undefined> {
  const delays = [150, 400, 900];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    let found: FlaggedMessage | undefined;
    try {
      found = game.messages.get(messageId) as unknown as FlaggedMessage | undefined;
    } catch {
      found = undefined;
    }
    if (found) return found;
    if (attempt < delays.length) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  return undefined;
}

/**
 * Register the GM-side handler of the initiative relay (once per client).
 *
 * Only the GM's client acts on a request: it is the only one allowed to write
 * the initiative of a combatant the player does not own.
 */
export function registerSocketHandlers(): void {
  if (registered) return;
  registered = true;
  try {
    const socket = game.socket;
    if (!socket || typeof socket.on !== "function") {
      logger.warn("game.socket unavailable: the initiative relay stays off");
      return;
    }
    socket.on(SOCKET_EVENT, (payload: unknown) => {
      void handleInitiativeRequest(payload);
    });
  } catch (err) {
    logger.warn(`registerSocketHandlers: ${String(err)}`);
  }
}

/**
 * Ask the GM's client to apply the initiative on the player's behalf.
 *
 * Foundry's server refuses to store the initiative of a combatant whose actor
 * the player does not own, so the roll is relayed to the GM instead.
 *
 * @returns `true` when the request was sent.
 */
export function requestInitiativeApply(request: InitiativeRequest): boolean {
  try {
    const socket = game.socket;
    if (!socket || typeof socket.emit !== "function") return false;
    socket.emit(SOCKET_EVENT, request);
    return true;
  } catch (err) {
    logger.warn(`requestInitiativeApply: ${String(err)}`);
    return false;
  }
}

/**
 * GM side of the relay.
 *
 * The socket carries **no authenticated sender**, so the request is validated
 * against the chat message that carries the roll: the server authenticated its
 * author and its content, so it is the only trustworthy link between "a player
 * rolled this" and "this value may be stored".
 */
async function handleInitiativeRequest(payload: unknown): Promise<void> {
  try {
    const isGM = game.user?.isGM === true;
    const request = parseInitiativeRequest(payload);
    if (!request) return;

    const combatant = findCombatant(request.combatantId);
    if (!combatant) return;

    // The player's own write-back landed (this is the common case: they own
    // their character). Nothing to do — and nothing to complain about.
    if (typeof combatant.initiative === "number") {
      logger.debug(
        `initiative relay skipped: ${combatant.name ?? request.combatantId} already has initiative`
      );
      return;
    }

    const requester = game.users.get(request.userId);
    const requesterIsGM = requester?.isGM === true;

    // Validate against the (server authenticated) chat message.
    const message = await findMessage(request.messageId);
    const flag = message ? readInitiativeFlag(message.flags) : null;
    const flagMatches =
      !!flag && flag.combatantId === request.combatantId && flag.total === request.total;
    const authorMatches = !!message && message.user?.id === requester?.id;

    const allowed = canApplyRelay({
      isGM,
      requesterIsGM,
      alreadyRolled: typeof combatant.initiative === "number",
      messageFound: !!message,
      flagMatches,
      authorMatches,
      entitled: !!requester && userOwnsCombatant(requester, combatant),
      trustPlayers: getSettings().playerInitiative
    });
    if (!allowed) {
      if (isGM && !requesterIsGM && requester) {
        logger.warn(
          `initiative relay refused: ${requester.name} → ${combatant.name ?? request.combatantId}`
        );
        ui.notifications?.warn(
          game.i18n.format("pokemon-hud-combat.error.initiativeNeedsGM", {
            name: requester.name ?? requester.id,
            total: request.total,
            combatant: combatant.name ?? request.combatantId
          })
        );
      }
      return;
    }

    await combatant.update({ initiative: request.total });
    logger.info(
      `initiative relay applied: ${requester?.name ?? request.userId} rolled ${request.total} for ${combatant.name ?? request.combatantId}`
    );
  } catch (err) {
    logger.warn(`handleInitiativeRequest: ${String(err)}`);
  }
}
