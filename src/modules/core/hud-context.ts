import type { ActivePokemonInfo, RawCombatant } from "./combat-order";
import { buildCombatGroups, markActive } from "./combat-order";
import { canRollInitiative } from "./initiative-gate";
import { applyInitiativeMode, type InitiativeRollMode } from "./initiative-mode";
import { getSettings } from "./settings";
import { readCoreStats } from "./stats";
import type { CombatView, HpSnapshot, InitiativeGateResult } from "../types/index";
import { logger } from "./logger";

const MODULE_ID = "pokemon-hud-combat";
/** Data source module: trainer party + the `summoner` token flag. */
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

/** Is the pokemon-hud-like module active? It owns the trainer/pokémon flags. */
export function isHuddleActive(): boolean {
  try {
    return game.modules.get(HUDDLE_ID)?.active === true;
  } catch {
    return false;
  }
}

/** Trainer vs. wild: the `hudType` flag if present, else actor type. */
export function isTrainerActor(actor: Actor | null | undefined): boolean {
  if (!actor) return false;
  const hudType =
    readFlag(actor as unknown as FlagSource, HUDDLE_ID, "hudType") ??
    readFlag(actor as unknown as FlagSource, MODULE_ID, "hudType");
  if (hudType === "trainer") return true;
  if (hudType === "pokemon") return false;
  const type = (actor as { type?: string }).type ?? "";
  return type === "character" || type === "pc";
}

function snapshotHp(actor: Actor | null | undefined): HpSnapshot | null {
  if (!actor) return null;
  try {
    const attributes = (
      actor.system as { attributes?: { hp?: { value?: unknown; max?: unknown } } }
    )?.attributes;
    const raw = attributes?.hp;
    if (!raw || typeof raw.max !== "number" || typeof raw.value !== "number") return null;
    const stats = readCoreStats(actor.system);
    return { current: stats.hp.current, max: stats.hp.max };
  } catch {
    return null;
  }
}

interface SceneToken {
  tokenId: string;
  actorId: string;
  name: string;
  img: string;
  actor: Actor | null;
  flags: Record<string, Record<string, unknown> | undefined>;
}

function sceneTokens(): SceneToken[] {
  const out: SceneToken[] = [];
  try {
    const placeables = (canvas as { tokens?: { placeables?: unknown } } | undefined)?.tokens
      ?.placeables;
    if (!Array.isArray(placeables)) return out;
    for (const placeable of placeables) {
      const tk = placeable as {
        document?: {
          id?: string;
          actorId?: string;
          name?: string;
          texture?: { src?: string };
          flags?: Record<string, Record<string, unknown> | undefined>;
        };
        actor?: Actor | null;
      };
      const doc = tk.document;
      if (!doc?.id) continue;
      out.push({
        tokenId: doc.id,
        actorId: doc.actorId ?? tk.actor?.id ?? "",
        name: tk.actor?.name ?? doc.name ?? "",
        img: doc.texture?.src ?? tk.actor?.img ?? "icons/svg/mystery-man.svg",
        actor: tk.actor ?? null,
        flags: doc.flags ?? {}
      });
    }
  } catch (err) {
    logger.warn(`sceneTokens: ${String(err)}`);
  }
  return out;
}

/**
 * The token representing a trainer's active Pokémon:
 * 1. pokemon-hud-like's `summoner` token flag (authoritative when installed);
 * 2. our own `activePokemon` actor flag (trainer actor id) as fallback.
 */
export function activeTokenFor(trainer: Actor | null | undefined): SceneToken | null {
  if (!trainer) return null;
  const tokens = sceneTokens();
  const ids = new Set<string>();
  if (trainer.id) ids.add(trainer.id);
  if (trainer.uuid) ids.add(trainer.uuid);
  const tokenDoc = (trainer as { token?: { id?: string; document?: { actorId?: string } } }).token;
  if (tokenDoc?.document?.actorId) ids.add(tokenDoc.document.actorId);
  if (tokenDoc?.id) ids.add(tokenDoc.id);

  const summoned = tokens.find((token) => {
    const summoner = readFlag({ flags: token.flags }, HUDDLE_ID, "summoner");
    return typeof summoner === "string" && ids.has(summoner);
  });
  if (summoned) return summoned;

  // pokemon-hud-like owns the live summon state; only fall back to our own flag
  // when it is not installed.
  if (isHuddleActive()) return null;

  const fallbackId = readFlag(trainer as unknown as FlagSource, MODULE_ID, "activePokemon");
  if (typeof fallbackId !== "string" || !fallbackId) return null;
  return (
    tokens.find((token) => token.actorId === fallbackId || token.actor?.id === fallbackId) ?? null
  );
}

function combatantActor(combatant: Combatant): Actor | null {
  try {
    const actor = (combatant as { actor?: Actor | null }).actor;
    if (actor) return actor;
    const tokenActor = (combatant as { token?: { actor?: Actor | null } | null }).token?.actor;
    return tokenActor ?? null;
  } catch {
    return null;
  }
}

function combatantTokenId(combatant: Combatant): string | null {
  const raw = combatant as unknown as { token?: { id?: string } | null; tokenId?: string | null };
  return raw.token?.id ?? raw.tokenId ?? null;
}

function combatantDefeated(combatant: Combatant): boolean {
  const raw = combatant as unknown as { isDefeated?: boolean; defeated?: boolean };
  return raw.isDefeated === true || raw.defeated === true;
}

/** Token disposition of a combatant (drives the ally/enemy border). */
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

function activePokemonInfo(
  trainer: Actor | null,
  combatants: Combatant[]
): ActivePokemonInfo | null {
  const token = activeTokenFor(trainer);
  if (!token) return null;
  const pokemonActor = token.actor;
  const actorId = pokemonActor?.id ?? token.actorId;
  if (!actorId) return null;

  const inCombat = combatants.find(
    (combatant) =>
      combatantTokenId(combatant) === token.tokenId ||
      combatantActor(combatant)?.id === actorId ||
      (combatant as { actorId?: string | null }).actorId === actorId
  );

  return {
    actorId,
    name: pokemonActor?.name ?? token.name,
    img: token.img || pokemonActor?.img || "icons/svg/mystery-man.svg",
    hp: snapshotHp(pokemonActor),
    combatantId: inCombat?.id ?? null,
    initiative: typeof inCombat?.initiative === "number" ? inCombat.initiative : null,
    defeated: inCombat ? combatantDefeated(inCombat) : false
  };
}

function combatantImg(combatant: Combatant, actor: Actor | null): string {
  const srcSetting = getSettings().imageSource;
  const raw = combatant as unknown as {
    img?: unknown;
    token?: { texture?: { src?: unknown } } | null;
  };
  const tokenSrc = raw.token?.texture?.src;
  if (typeof tokenSrc === "string" && tokenSrc && srcSetting === "token") return tokenSrc;
  const own = typeof raw.img === "string" ? raw.img : "";
  if (own && srcSetting === "actor") return own;
  if (typeof tokenSrc === "string" && tokenSrc) return tokenSrc;
  return own || (actor?.img ?? "icons/svg/mystery-man.svg");
}

function emptyView(): CombatView {
  return {
    present: false,
    started: false,
    round: 0,
    turn: 0,
    activeId: null,
    groups: []
  };
}

/** Build the current top-bar view from `game.combat` (runtime only). */
export function buildCombatView(): CombatView {
  const combat = game.combat;
  if (!combat) return emptyView();

  try {
    const combatants = Array.from(combat.combatants);
    const raws: RawCombatant[] = [];
    const activeByTrainer: Record<string, ActivePokemonInfo | null> = {};

    for (const combatant of combatants) {
      const hidden = (combatant as { hidden?: boolean }).hidden === true;
      if (hidden && game.user?.isGM !== true) continue;
      const actor = combatantActor(combatant);
      const actorId = actor?.id ?? "";
      raws.push({
        id: combatant.id ?? "",
        actorId,
        name: actor?.name ?? combatant.name ?? "",
        img: combatantImg(combatant, actor),
        initiative: typeof combatant.initiative === "number" ? combatant.initiative : null,
        defeated: combatantDefeated(combatant),
        isTrainer: isTrainerActor(actor),
        hp: snapshotHp(actor),
        disposition: combatantDisposition(combatant)
      });
      if (isTrainerActor(actor) && actorId) {
        activeByTrainer[actorId] = activePokemonInfo(actor, combatants);
      }
    }

    const gmBypassActive = game.user?.isGM === true && getSettings().gmBypass;
    const groups = markActive(
      buildCombatGroups(raws, activeByTrainer, { gmBypassActive, userDisposition: userDisposition() }),
      activeCombatantId(combat)
    );

    return {
      present: true,
      started: combat.started === true,
      round: typeof combat.round === "number" ? combat.round : 0,
      turn: typeof combat.turn === "number" ? combat.turn : 0,
      activeId: activeCombatantId(combat),
      groups
    };
  } catch (err) {
    logger.error(
      `buildCombatView: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
    );
    return emptyView();
  }
}

function activeCombatantId(combat: Combat): string | null {
  const raw = combat as unknown as {
    combatant?: { id?: string | null } | null;
    turns?: { active?: { id?: string | null } | null } | null;
  };
  return raw.combatant?.id ?? raw.turns?.active?.id ?? null;
}

/** Initiative gate for a single Combatant (used by the prototype guard). */
export function gateForCombatant(combatant: Combatant): InitiativeGateResult {
  const actor = combatantActor(combatant);
  const settings = getSettings();
  return canRollInitiative({
    isTrainer: isTrainerActor(actor),
    hasActivePokemon: activeTokenFor(actor) !== null,
    isGM: game.user?.isGM === true,
    gmBypass: settings.gmBypass
  });
}

/**
 * Effective initiative formula for a roll with advantage/disadvantage.
 * Returns `undefined` when the modifier cannot change the formula (the default
 * roll is used instead).
 */
function initiativeFormulaFor(combatant: Combatant, mode: InitiativeRollMode): string | undefined {
  if (mode === "normal") return undefined;
  let base = "";
  try {
    const getFormula = (combatant as unknown as { _getInitiativeFormula?: () => string })
      ._getInitiativeFormula;
    if (typeof getFormula === "function") base = getFormula.call(combatant) ?? "";
  } catch {
    base = "";
  }
  const fallback = "1d20";
  const source = base.trim() || fallback;
  const withMode = applyInitiativeMode(source, mode);
  return withMode === source ? undefined : withMode;
}

/**
 * Roll one combatant's initiative through the (guarded) Foundry API.
 * `mode` applies advantage (Alt) / disadvantage (Ctrl) via the dice formula.
 */
export async function rollCombatantInitiative(
  combatantId: string,
  mode: InitiativeRollMode = "normal"
): Promise<void> {
  const combat = game.combat;
  if (!combat) return;
  const combatant = Array.from(combat.combatants).find((c) => c.id === combatantId);
  if (!combatant) return;
  const roll = (combatant as unknown as { rollInitiative?: (formula?: string) => Promise<unknown> })
    .rollInitiative;
  if (typeof roll !== "function") {
    logger.warn("Combatant#rollInitiative unavailable");
    return;
  }
  const formula = initiativeFormulaFor(combatant, mode);
  if (formula) await roll.call(combatant, formula);
  else await roll.call(combatant);
}

/** Roll initiative for every combatant that has not rolled yet. */
export async function rollAllInitiatives(): Promise<void> {
  const combat = game.combat;
  if (!combat) return;
  for (const combatant of Array.from(combat.combatants)) {
    if (typeof combatant.initiative === "number") continue;
    await rollCombatantInitiative(combatant.id ?? "");
  }
}

export async function startCombat(): Promise<void> {
  await game.combat?.startCombat();
}

export async function endCombat(): Promise<void> {
  await game.combat?.delete();
}

export async function nextTurn(): Promise<void> {
  await game.combat?.nextTurn();
}

export async function previousTurn(): Promise<void> {
  await game.combat?.previousTurn();
}

export { MODULE_ID };
