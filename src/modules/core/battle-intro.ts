import { normalizeEncounterKind, type EncounterKind } from "./encounters";
import { classifyFaction } from "./faction";
import { isTrainerActor } from "./hud-context";
import { logger } from "./logger";
import { getSettings } from "./settings";

const MODULE_ID = "pokemon-hud-combat";
/** Flag scope/key on the Combat document where the GM's choice is stored. */
const SCOPE = MODULE_ID;
const FLAG_KEY = "battleIntro";

/**
 * Lifecycle of the VS screen for one combat.
 *
 * - `pending`   → the GM has the setup screen open, nobody else sees anything.
 * - `confirmed` → the GM pressed "Comenzar combate"; everybody plays the intro.
 * - `cancelled` → the GM skipped it; everybody just goes back to the tracker.
 */
export type BattleIntroState = "pending" | "confirmed" | "cancelled";

/**
 * The GM's choices for the VS screen.
 *
 * Stored as a flag on the Combat document so every client — and any player
 * joining later — reads the very same encounter from the same source of truth.
 */
export interface BattleIntroConfig {
  /** Encounter kind picked by the GM (only `trainers` has a screen for now). */
  kind: EncounterKind;
  /** Free-text name of the encounter, typed by the GM on the VS screen. */
  encounterName: string;
  /** Player team name, snapshotted when the GM confirmed the encounter. */
  playerTeam: string;
  state: BattleIntroState;
  /** Epoch milliseconds of the moment the GM confirmed (or cancelled). */
  startedAt: number;
}

/** One portrait shown on either side of the VS bar. */
export interface BattleIntroEntry {
  id: string;
  name: string;
  img: string;
}

/** Data the intro template paints. */
export interface BattleIntroView {
  /** Left side: the player trainers taking part. */
  players: BattleIntroEntry[];
  /** Right side: the rival trainers taking part. */
  rivals: BattleIntroEntry[];
  /** Team name shown under the player portraits. */
  playerTeam: string;
  /** Encounter name shown on the rival side of the VS bar. */
  encounterName: string;
  /** Auto-close delay in milliseconds. */
  durationMs: number;
}

function combatantActor(combatant: Combatant): Actor | null {
  try {
    const actor = (combatant as { actor?: Actor | null }).actor;
    if (actor) return actor;
    return (combatant as { token?: { actor?: Actor | null } | null }).token?.actor ?? null;
  } catch {
    return null;
  }
}

function combatantDisposition(combatant: Combatant): number | null {
  try {
    const raw = combatant as unknown as {
      disposition?: unknown;
      token?: { disposition?: unknown; document?: { disposition?: unknown } } | null;
    };
    const candidate =
      raw.token?.document?.disposition ?? raw.token?.disposition ?? raw.disposition;
    return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

/** The viewing player's own token disposition; null for the GM. */
function userDisposition(): number | null {
  try {
    const tokens = canvas as
      | {
          scene?: { tokens?: { contents?: Array<{ actorId?: string; disposition?: unknown }> } };
          tokens?: { controlled?: Array<{ document?: { disposition?: unknown } }> };
        }
      | undefined;
    const controlled = tokens?.tokens?.controlled;
    const controlledDisp =
      Array.isArray(controlled) && controlled.length ? controlled[0].document?.disposition : undefined;
    if (typeof controlledDisp === "number" && Number.isFinite(controlledDisp)) return controlledDisp;

    const characterId = game.user?.character?.id;
    if (!characterId) return null;
    const own = tokens?.scene?.tokens?.contents?.find((token) => token.actorId === characterId);
    return typeof own?.disposition === "number" && Number.isFinite(own.disposition)
      ? own.disposition
      : null;
  } catch {
    return null;
  }
}

/** Actor portrait for the intro (always the actor image, per the feature spec). */
function actorPortrait(actor: Actor | null, combatant: Combatant): string {
  const actorImg = typeof actor?.img === "string" ? actor.img : "";
  if (actorImg) return actorImg;
  const raw = combatant as unknown as {
    img?: unknown;
    token?: { texture?: { src?: unknown } } | null;
  };
  const tokenSrc = typeof raw.token?.texture?.src === "string" ? raw.token.texture.src : "";
  const own = typeof raw.img === "string" ? raw.img : "";
  return own || tokenSrc || "icons/svg/mystery-person.svg";
}

/**
 * Read the encounter the GM chose for this combat.
 *
 * Returns `null` when the GM has not confirmed anything yet (no flag, or a
 * flag that does not match the expected shape).
 */
export function readBattleIntroConfig(
  combat: Combat | null | undefined
): BattleIntroConfig | null {
  if (!combat) return null;
  let raw: unknown;
  try {
    raw = combat.getFlag(SCOPE, FLAG_KEY);
  } catch (err) {
    logger.warn(`readBattleIntroConfig: ${String(err)}`);
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<BattleIntroConfig>;
  const state = data.state;
  if (state !== "pending" && state !== "confirmed" && state !== "cancelled") return null;
  return {
    kind: normalizeEncounterKind(data.kind),
    encounterName: typeof data.encounterName === "string" ? data.encounterName : "",
    playerTeam: typeof data.playerTeam === "string" ? data.playerTeam : "",
    state,
    startedAt: typeof data.startedAt === "number" ? data.startedAt : 0
  };
}

/**
 * Persist the GM's choice on the Combat document.
 *
 * `Document#setFlag` updates the document by itself, so the change travels to
 * every client through the regular `updateCombat` hook.
 */
export async function writeBattleIntroConfig(
  combat: Combat | null | undefined,
  config: BattleIntroConfig
): Promise<boolean> {
  if (!combat) return false;
  try {
    await combat.setFlag(SCOPE, FLAG_KEY, config);
    return true;
  } catch (err) {
    logger.warn(`writeBattleIntroConfig: ${String(err)}`);
    return false;
  }
}

/**
 * Build the VS-screen view from the active combat.
 *
 * Ally trainers (per the viewer's own disposition) form the left side, everyone
 * else forms the right side. Only trainers are shown; wild Pokémon are skipped
 * so the screen stays a trainer showcase.
 */
export function buildBattleIntroView(options?: {
  encounterName?: string | null;
  playerTeam?: string | null;
}): BattleIntroView {
  const settings = getSettings();
  const players: BattleIntroEntry[] = [];
  const rivals: BattleIntroEntry[] = [];
  const seen = new Set<string>();

  try {
    const combatants = Array.from(game.combat?.combatants ?? []);
    const viewerDisposition = userDisposition();
    for (const combatant of combatants) {
      const actor = combatantActor(combatant);
      if (!isTrainerActor(actor)) continue;
      const id = actor?.id ?? combatant.id ?? combatant.name ?? "";
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const entry: BattleIntroEntry = {
        id,
        name: actor?.name ?? combatant.name ?? "",
        img: actorPortrait(actor, combatant)
      };
      const faction = classifyFaction(combatantDisposition(combatant), viewerDisposition);
      if (faction === "ally") players.push(entry);
      else rivals.push(entry);
    }
  } catch (err) {
    logger.warn(`buildBattleIntroView: ${String(err)}`);
  }

  return {
    players,
    rivals,
    playerTeam: (options?.playerTeam ?? settings.playerTeamName ?? "").trim(),
    encounterName: (options?.encounterName ?? "").trim(),
    durationMs: Math.max(0, settings.battleIntroDuration) * 1000
  };
}
