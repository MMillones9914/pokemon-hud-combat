/**
 * Ownership / control heuristics (runtime only, never imported by tests).
 *
 * Foundry's ownership model is strict: a player may not save the initiative of
 * a combatant whose actor they do not own. These helpers answer the two
 * questions the module needs:
 *
 * - may this user roll initiative for this combatant? (client side check);
 * - is this user entitled to have the GM apply the initiative on their behalf?
 *   (validation of the socket relay running on the GM's client).
 *
 * Everything here is deliberately defensive: Foundry's API surface differs
 * between systems and versions, so each probe is wrapped in try/catch.
 */

/** Actor id behind a combatant (its actor, or the token's actor). */
export function combatantActorId(combatant: Combatant): string {
  const raw = combatant as unknown as {
    actor?: { id?: string } | null;
    actorId?: string | null;
    token?: { actor?: { id?: string } | null } | null;
  };
  return raw.actor?.id ?? raw.token?.actor?.id ?? raw.actorId ?? "";
}

/** Token id behind a combatant, when it is linked to a token. */
export function combatantTokenId(combatant: Combatant): string {
  const raw = combatant as unknown as { token?: { id?: string } | null; tokenId?: string | null };
  return raw.token?.id ?? raw.tokenId ?? "";
}

/**
 * Tokens the given user controls on the active scene.
 *
 * Only the *local* user's controlled tokens are knowable from this client, so
 * the sets come back empty for anybody else (the GM's client cannot know which
 * tokens a player has selected).
 */
function controlledTokens(user: User): { tokenIds: Set<string>; actorIds: Set<string> } {
  const tokenIds = new Set<string>();
  const actorIds = new Set<string>();
  if (!user || user.id !== game.user?.id) return { tokenIds, actorIds };
  try {
    const controlled = (canvas as { tokens?: { controlled?: unknown } } | undefined)?.tokens
      ?.controlled;
    if (!Array.isArray(controlled)) return { tokenIds, actorIds };
    for (const placeable of controlled) {
      const doc = (placeable as { document?: { id?: string; actorId?: string } } | undefined)
        ?.document;
      if (doc?.id) tokenIds.add(doc.id);
      if (doc?.actorId) actorIds.add(doc.actorId);
    }
  } catch {
    /* ignore */
  }
  return { tokenIds, actorIds };
}

/**
 * May `user` roll initiative for `combatant`?
 *
 * Several independent proofs are accepted, because Foundry's ownership table
 * is not the only way a player owns their character:
 *
 * 1. the user controls the combatant's token on the active scene;
 * 2. the local `isOwner` getters (only meaningful for the current user);
 * 3. the combatant's actor is the user's assigned character;
 * 4. Foundry's ownership flags (`testUserPermission`, `ownership.default`);
 * 5. Foundry's own combatant permission (`canUserModify`, `combatant.players`).
 *
 * Note: `actor.permission` is a *local user* getter, so the per-user check is
 * `testUserPermission`; `actor.isOwner` is used only for the current user.
 */
export function userOwnsCombatant(user: User, combatant: Combatant): boolean {
  try {
    if (!user || !combatant) return false;
    const actor = (combatant as { actor?: Actor | null }).actor ?? null;
    const actorId = combatantActorId(combatant);
    const tokenId = combatantTokenId(combatant);

    // 1. The user controls this combatant's token on the active scene.
    const { tokenIds, actorIds } = controlledTokens(user);
    if (tokenId && tokenIds.has(tokenId)) return true;
    if (actorId && actorIds.has(actorId)) return true;

    // 2. Foundry's local ownership getters. They are only meaningful for the
    //    user running this client, and they are the cheapest, most reliable
    //    proof that a player owns their own sheet/token.
    if (user.id === game.user?.id) {
      const local = combatant as {
        actor?: { isOwner?: boolean } | null;
        token?: { isOwner?: boolean } | null;
      };
      if (local.actor?.isOwner === true) return true;
      if (local.token?.isOwner === true) return true;
    }

    // 3. The actor is the user's assigned character.
    const characterId = user.character?.id;
    if (characterId && actorId && characterId === actorId) return true;

    // 4. Foundry's ownership flags (per user).
    try {
      if (actor && typeof actor.testUserPermission === "function") {
        if (actor.testUserPermission(user, "OWNER")) return true;
      }
    } catch {
      /* ignore */
    }
    try {
      const ownership = (actor as { ownership?: { default?: string } } | undefined)?.ownership;
      if (ownership?.default && ownership.default === user.id) return true;
    } catch {
      /* ignore */
    }
    try {
      // The token carries its own ownership (the GM can hand it to a player).
      const token = (combatant as { token?: { testUserPermission?: (u: User, p: string) => boolean } })
        .token;
      if (token && typeof token.testUserPermission === "function") {
        if (token.testUserPermission(user, "OWNER")) return true;
      }
    } catch {
      /* ignore */
    }

    // 5. Foundry's own combatant permission check.
    const canModify = (combatant as { canUserModify?: (u: User, action: string) => boolean })
      .canUserModify;
    if (typeof canModify === "function") {
      try {
        if (canModify.call(combatant, user, "update")) return true;
      } catch {
        /* ignore */
      }
    }
    try {
      const players = (combatant as { players?: User[] }).players;
      if (Array.isArray(players) && players.some((u) => u?.id === user.id)) return true;
    } catch {
      /* ignore */
    }

    return false;
  } catch {
    return false;
  }
}
