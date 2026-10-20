import { classifyFaction } from "./faction";
import { parseRivalTeams, resolveRivalTeam } from "./encounters";
import { logger } from "./logger";
import { getSettings } from "./settings";

const MODULE_ID = "pokemon-hud-combat";
const HUDDLE_ID = "pokemon-hud-like";

type FlagSource = {
  flags?: Record<string, Record<string, unknown> | undefined>;
  getFlag?: (scope: string, key: string) => unknown;
};

function readFlag(source: FlagSource | null | undefined, scope: string, key: string): unknown {
  if (!source) return undefined;
  try {
    if (typeof source.getFlag === "function") return source.getFlag(scope, key);
  } catch {
    /* fall through to the raw flags object */
  }
  return source.flags?.[scope]?.[key];
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
  /** Team name shown under the rival portraits. */
  rivalTeam: string;
  /** Rival teams the GM can pick from (empty when none configured). */
  rivalTeams: string[];
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

function isTrainerActor(actor: Actor | null | undefined): boolean {
  if (!actor) return false;
  const hudType =
    readFlag(actor as unknown as FlagSource, HUDDLE_ID, "hudType") ??
    readFlag(actor as unknown as FlagSource, MODULE_ID, "hudType");
  if (hudType === "trainer") return true;
  if (hudType === "pokemon") return false;
  const type = (actor as { type?: string }).type ?? "";
  return type === "character" || type === "pc";
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
 * Build the VS-screen view from the active combat.
 *
 * Ally trainers (per the viewer's own disposition) form the left side, everyone
 * else forms the right side. Only trainers are shown; wild Pokémon are skipped
 * so the screen stays a trainer showcase.
 */
export function buildBattleIntroView(preferredRivalTeam?: string | null): BattleIntroView {
  const settings = getSettings();
  const rivalTeams = parseRivalTeams(settings.rivalTeams);
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
    playerTeam: (settings.playerTeamName ?? "").trim(),
    rivalTeam: resolveRivalTeam(rivalTeams, preferredRivalTeam),
    rivalTeams,
    durationMs: Math.max(0, settings.battleIntroDuration) * 1000
  };
}
