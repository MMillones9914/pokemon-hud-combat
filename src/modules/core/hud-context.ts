import type { ActivePokemonInfo, RawCombatant } from "./combat-order";
import { buildCombatGroups, markActive } from "./combat-order";
import { canRollInitiative } from "./initiative-gate";
import { applyInitiativeMode, type InitiativeRollMode } from "./initiative-mode";
import { requestInitiativeApply } from "./socket";
import { getSettings } from "./settings";
import { readCoreStats } from "./stats";
import { userOwnsCombatant } from "./ownership";
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

/** A trainer's resolved active Pokémon: its token (when on the canvas) and actor. */
export interface ActivePokemon {
  token: SceneToken | null;
  actor: Actor | null;
  name: string;
  img: string;
}

function actorById(actorId: string): Actor | null {
  try {
    const actors = game.actors as { get?: (id: string) => Actor | undefined } | undefined;
    return actors?.get?.(actorId) ?? null;
  } catch {
    return null;
  }
}

function tokenForActor(tokens: SceneToken[], actorId: string): SceneToken | null {
  return tokens.find((token) => token.actorId === actorId || token.actor?.id === actorId) ?? null;
}

/**
 * Actor ids listed in pokemon-hud-like's trainer `party` flag.
 *
 * The party lives on the **trainer** actor (`flags["pokemon-hud-like"].trainer.party`)
 * and is ordered; slot 0 is the lead. Some pokemon-hud-like releases never write
 * a `summoner` token flag, so the party is the only available hint and the
 * module must read it to know that a trainer *does* have a Pokémon.
 */
function partyActorIds(trainer: Actor): string[] {
  const data = readFlag(trainer as unknown as FlagSource, HUDDLE_ID, "trainer") as
    { party?: unknown } | undefined;
  const party = Array.isArray(data?.party) ? data.party : [];
  return party.filter((id): id is string => typeof id === "string" && id.length > 0);
}

function prototypeTokenSrc(actor: Actor | null): string {
  if (!actor) return "";
  const pt = (actor as { prototypeToken?: { texture?: { src?: unknown }; img?: unknown } }).prototypeToken;
  if (typeof pt?.texture?.src === "string" && pt.texture.src) return pt.texture.src;
  if (typeof pt?.img === "string" && pt.img) return pt.img;
  return "";
}

function buildActive(token: SceneToken | null, actor: Actor | null): ActivePokemon | null {
  if (!token && !actor) return null;
  const img = token?.img || prototypeTokenSrc(actor) || actor?.img || "icons/svg/mystery-man.svg";
  return {
    token,
    actor,
    name: actor?.name ?? token?.name ?? "",
    img
  };
}

/**
 * The trainer's active Pokémon, resolved from every source the module knows:
 *
 * 1. pokemon-hud-like's `summoner` **token** flag (authoritative when present);
 * 2. our own `activePokemon` **actor** flag (works with or without the data module);
 * 3. pokemon-hud-like's trainer **party** (slot 0 = lead). This is what makes
 *    the feature work in worlds where no `summoner` flag is ever written.
 *
 * Steps 2 and 3 only need the actors (`game.actors`), so they also resolve on a
 * player's client, where the Pokémon token may not be rendered at all.
 */
export function activePokemonFor(
  trainer: Actor | null | undefined,
  combatActorIds?: ReadonlySet<string>
): ActivePokemon | null {
  if (!trainer) return null;
  const tokens = sceneTokens();
  const ids = new Set<string>();
  if (trainer.id) ids.add(trainer.id);
  if (trainer.uuid) ids.add(trainer.uuid);
  const tokenDoc = (trainer as { token?: { id?: string; document?: { actorId?: string } } }).token;
  if (tokenDoc?.document?.actorId) ids.add(tokenDoc.document.actorId);
  if (tokenDoc?.id) ids.add(tokenDoc.id);

  // 1. pokemon-hud-like's `summoner` token flag.
  const summoned = tokens.find((token) => {
    const summoner = readFlag({ flags: token.flags }, HUDDLE_ID, "summoner");
    return typeof summoner === "string" && ids.has(summoner);
  });
  if (summoned) return buildActive(summoned, summoned.actor);

  // 2. Our own `activePokemon` actor flag.
  const flagId = readFlag(trainer as unknown as FlagSource, MODULE_ID, "activePokemon");
  if (typeof flagId === "string" && flagId) {
    const token = tokenForActor(tokens, flagId);
    const active = buildActive(token, actorById(flagId) ?? token?.actor ?? null);
    if (active) return active;
  }

  // 3. pokemon-hud-like's party. Prefer a member that is in the combat, then one
  //    standing on the canvas, then the first one that still resolves.
  const party = partyActorIds(trainer);
  const candidates = party
    .map((actorId) => ({ actorId, token: tokenForActor(tokens, actorId) }))
    .filter((candidate) => candidate.token !== null || actorById(candidate.actorId) !== null);
  const chosen =
    candidates.find((candidate) => combatActorIds?.has(candidate.actorId)) ??
    candidates.find((candidate) => candidate.token !== null) ??
    candidates[0];
  if (!chosen) return null;
  return buildActive(chosen.token, chosen.token?.actor ?? actorById(chosen.actorId));
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
    const candidate = raw.token?.document?.disposition ?? raw.token?.disposition ?? raw.disposition;
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
      Array.isArray(controlled) && controlled.length
        ? controlled[0].document?.disposition
        : undefined;
    if (typeof controlledDisp === "number" && Number.isFinite(controlledDisp))
      return controlledDisp;

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
  combatants: Combatant[],
  combatActorIds?: ReadonlySet<string>
): ActivePokemonInfo | null {
  const active = activePokemonFor(trainer, combatActorIds);
  if (!active) return null;
  const pokemonActor = active.actor ?? active.token?.actor ?? null;
  const actorId = pokemonActor?.id ?? active.token?.actorId ?? "";
  if (!actorId) return null;

  const inCombat = combatants.find(
    (combatant) =>
      (!!active.token && combatantTokenId(combatant) === active.token.tokenId) ||
      combatantActor(combatant)?.id === actorId ||
      (combatant as { actorId?: string | null }).actorId === actorId
  );

  return {
    actorId,
    name: active.name || pokemonActor?.name || "",
    img: active.img,
    hp: snapshotHp(pokemonActor),
    combatantId: inCombat?.id ?? null,
    initiative: typeof inCombat?.initiative === "number" ? inCombat.initiative : null,
    defeated: inCombat ? combatantDefeated(inCombat) : false
  };
}

/**
 * Image for a combatant card.
 * - `token` mode: the token texture (falls back to the actor portrait).
 * - `actor` mode: the actor portrait (falls back to the token texture).
 *
 * `combatant.img` is usually the token texture for token-based combatants, so
 * the actor mode must consult `actor.img` *before* `combatant.img`.
 */
function combatantImg(combatant: Combatant, actor: Actor | null): string {
  const srcSetting = getSettings().imageSource;
  const raw = combatant as unknown as {
    img?: unknown;
    token?: { texture?: { src?: unknown } } | null;
  };
  const tokenSrc = typeof raw.token?.texture?.src === "string" ? raw.token.texture.src : "";
  const combatantImg = typeof raw.img === "string" ? raw.img : "";
  const actorImg = typeof actor?.img === "string" ? actor.img : "";
  const fallback = "icons/svg/mystery-man.svg";

  // Pokémon (wild or any non-trainer combatant) always use the token art,
  // regardless of the imageSource setting — only trainers honour it.
  // Prefer the live token texture, then the actor's prototype token, then
  // whatever else is available.
  if (!isTrainerActor(actor)) {
    return (
      tokenSrc ||
      prototypeTokenSrc(actor) ||
      combatantImg ||
      actorImg ||
      fallback
    );
  }

  if (srcSetting === "actor") {
    return actorImg || combatantImg || tokenSrc || fallback;
  }
  return tokenSrc || combatantImg || actorImg || fallback;
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
    const combatActorIds = new Set<string>();
    for (const combatant of combatants) {
      const actorId =
        combatantActor(combatant)?.id ?? (combatant as { actorId?: string | null }).actorId ?? "";
      if (actorId) combatActorIds.add(actorId);
    }

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
        activeByTrainer[actorId] = activePokemonInfo(actor, combatants, combatActorIds);
      }
    }

    const gmBypassActive = game.user?.isGM === true && getSettings().gmBypass;
    // Players may always roll their own combatants, whatever the local view can
    // resolve about their Pokémon.
    const ownedCombatantIds = new Set<string>();
    if (game.user && game.user.isGM !== true) {
      for (const combatant of combatants) {
        if (combatant.id && userOwnsCombatant(game.user, combatant)) {
          ownedCombatantIds.add(combatant.id);
        }
      }
    }
    const groups = markActive(
      buildCombatGroups(raws, activeByTrainer, {
        gmBypassActive,
        userDisposition: userDisposition(),
        ownedCombatantIds
      }),
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
  const user = game.user;
  const isGM = user?.isGM === true;
  return canRollInitiative({
    isTrainer: isTrainerActor(actor),
    hasActivePokemon: activePokemonFor(actor) !== null,
    isGM,
    gmBypass: settings.gmBypass,
    ownsCombatant: !isGM && !!user && userOwnsCombatant(user, combatant)
  });
}

/** Minimal surface of a Foundry `Roll` we depend on. */
interface InitiativeRollLike {
  evaluate: () => Promise<unknown>;
  toMessage: (data?: Record<string, unknown>) => Promise<{ id?: string } | undefined>;
  total?: number;
  options?: Record<string, unknown>;
  data?: Record<string, unknown>;
  clone?: () => InitiativeRollLike;
}

type RollConstructor = new (
  formula: string,
  data?: Record<string, unknown>,
  options?: Record<string, unknown>
) => InitiativeRollLike;

/**
 * Base initiative formula for a combatant (the system's own, when available).
 * Used as the fallback when the combatant cannot build its own roll (e.g. a
 * combatant with no actor, or a system that does not override `getInitiativeRoll`).
 */
function baseInitiativeFormula(combatant: Combatant): string {
  try {
    const getFormula = (combatant as unknown as { _getInitiativeFormula?: () => string })
      ._getInitiativeFormula;
    if (typeof getFormula === "function") {
      const formula = getFormula.call(combatant);
      if (typeof formula === "string" && formula.trim()) return formula.trim();
    }
  } catch {
    // fall through to the default below
  }
  return "1d20";
}

/**
 * Build the initiative roll for a combatant using the **system's own** roll
 * machinery. This matters for Dice So Nice: dnd5e builds initiative as a
 * `CONFIG.Dice.D20Roll` (not a plain `Roll`), and only that class is registered
 * with the dice animation pipeline.
 *
 * Order of preference:
 * 1. `combatant.getInitiativeRoll()` — dnd5e overrides this to return a
 *    `D20Roll` carrying the actor's roll data + modifiers.
 * 2. A fresh `CONFIG.Dice.D20Roll` (dnd5e / other d20 systems).
 * 3. Plain `globalThis.Roll` with the combatant's formula.
 *
 * Advantage/disadvantage is applied through the roll's `advantageMode` when the
 * class supports it (dnd5e's `D20Roll.ADV_MODE`), otherwise by rewriting the
 * formula (`1d20` → `2d20kh1`/`2d20kl1`).
 */
function buildInitiativeRoll(
  combatant: Combatant,
  mode: InitiativeRollMode,
  actor: Actor | null
): InitiativeRollLike | null {
  const advMode = advantageModeValue(mode);

  // 1. The combatant's own roll machinery (dnd5e → D20Roll with actor data).
  try {
    const own = (
      combatant as unknown as {
        getInitiativeRoll?: (formula?: string) => InitiativeRollLike | null;
      }
    ).getInitiativeRoll;
    if (typeof own === "function") {
      const roll = own.call(combatant);
      if (roll && typeof roll.evaluate === "function") {
        if (advMode !== undefined && roll.options) roll.options.advantageMode = advMode;
        return roll;
      }
    }
  } catch (err) {
    logger.warn(`buildInitiativeRoll (own): ${String(err)}`);
  }

  // 2/3. Construct the roll ourselves.
  const config = (
    globalThis as {
      CONFIG?: {
        Dice?: {
          D20Roll?: RollConstructor;
          rolls?: RollConstructor[];
        };
      };
      Roll?: RollConstructor;
    }
  ).CONFIG?.Dice;
  const source = baseInitiativeFormula(combatant);
  const formula = applyInitiativeMode(source, mode).trim() || "1d20";
  const data =
    (actor as unknown as { getRollData?: () => Record<string, unknown> })?.getRollData?.() ?? {};
  const options: Record<string, unknown> = {};
  if (advMode !== undefined) options.advantageMode = advMode;

  const candidates: Array<RollConstructor | undefined> = [
    config?.D20Roll,
    ...(config?.rolls ?? []),
    (globalThis as { Roll?: RollConstructor }).Roll
  ];
  for (const ctor of candidates) {
    if (typeof ctor !== "function") continue;
    try {
      const roll = new ctor(formula, data, options);
      if (roll && typeof roll.evaluate === "function") return roll;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** dnd5e's `D20Roll.ADV_MODE` value for a roll mode, when the system exposes it. */
function advantageModeValue(mode: InitiativeRollMode): number | undefined {
  if (mode === "normal") return undefined;
  const advMode = (
    globalThis as {
      CONFIG?: { Dice?: { D20Roll?: { ADV_MODE?: Record<string, number> } } };
    }
  ).CONFIG?.Dice?.D20Roll?.ADV_MODE;
  if (!advMode) return undefined;
  if (mode === "advantage") return advMode.ADVANTAGE;
  return advMode.DISADVANTAGE;
}

/**
 * Roll one combatant's initiative.
 *
 * The roll is produced by the **game system** (dnd5e → `CONFIG.Dice.D20Roll`)
 * and posted through `Roll#toMessage()`. That is the exact path Dice So Nice
 * documents and intercepts (`chatMessage.isRoll` + a `rolls` array), so the 3D
 * animation plays. We deliberately do NOT call `game.dice3d.showForRoll`
 * manually: per the DSN author that only shows the dice to the local user and
 * double-fires against the message animation.
 *
 * The total is written back onto the combatant so initiative order updates.
 * `mode` applies advantage (Alt) / disadvantage (Ctrl).
 */
/** The combatant (if any) of a trainer's currently active Pokémon. */
export function activePokemonCombatant(trainer: Combatant): Combatant | null {
  const combat = game.combat;
  if (!combat) return null;
  const actor = combatantActor(trainer);
  const active = activePokemonFor(actor);
  if (!active) return null;
  const combatants = Array.from(combat.combatants);
  return (
    combatants.find((c) => {
      if (active.token && combatantTokenId(c) === active.token.tokenId) return true;
      const a = combatantActor(c);
      return !!a && a.id === active.actor?.id;
    }) ?? null
  );
}

export async function rollCombatantInitiative(
  combatantId: string,
  mode: InitiativeRollMode = "normal"
): Promise<void> {
  const combat = game.combat;
  if (!combat) return;
  const combatant = Array.from(combat.combatants).find((c) => c.id === combatantId);
  if (!combatant) return;

  // Rule 1: never roll for a trainer with no active Pokémon (unless the user
  // owns the combatant — a player always keeps control of their own roll).
  const verdict = gateForCombatant(combatant);
  if (!verdict.allowed) {
    logger.info(
      `initiative refused: ${combatant.name ?? combatantId} (${verdict.blockedKey ?? "unknown"})`
    );
    ui.notifications?.warn(
      game.i18n.localize(verdict.blockedKey ?? "pokemon-hud-combat.error.noActivePokemon")
    );
    return;
  }

  const actor = combatantActor(combatant);
  const roll = buildInitiativeRoll(combatant, mode, actor);

  if (roll) {
    try {
      await roll.evaluate();
      const total = typeof roll.total === "number" ? roll.total : 0;

      let speaker: unknown;
      let whisper: string[] | undefined;
      try {
        const getSpeaker = (
          globalThis as {
            ChatMessage?: { getSpeaker?: (opts?: Record<string, unknown>) => unknown };
          }
        ).ChatMessage?.getSpeaker;
        if (typeof getSpeaker === "function") {
          speaker = getSpeaker({ actor: actor ?? undefined, token: combatant.token ?? undefined });
        }
        // V14 setting: `core.rollMode` ("public" | "gm" | "blind" | "self").
        const messageMode = game.settings?.get("core", "rollMode");
        if (messageMode === "gm" || messageMode === "blind") {
          const gms = Array.from(game.users ?? [])
            .filter((u) => u.isGM)
            .map((u) => u.id);
          if (gms.length) whisper = gms;
        } else if (messageMode === "self") {
          whisper = [game.user?.id ?? ""].filter(Boolean) as string[];
        }
      } catch {
        speaker = undefined;
      }

      const flavor =
        game.i18n?.format("pokemon-hud-combat.hud.initiativeFlavor", { name: combatant.name }) ??
        "Initiative";

      // The flag lets the GM's client validate a relayed initiative request
      // against this message (the server authenticates its author/content).
      const message = await roll.toMessage({
        speaker,
        whisper,
        flavor,
        flags: {
          "pokemon-hud-combat": { initiative: { combatantId: combatantId, total } }
        }
      });

      const updateInitiative = (
        combatant as unknown as {
          update?: (data: { initiative: number | null }) => Promise<unknown>;
        }
      ).update;
      let written = false;
      // Only attempt the local write-back when the user actually owns the
      // combatant: otherwise Foundry's server rejects it (`User X lacks
      // permission to update Combatant …`) and the GM relay takes over.
      const canWriteLocally =
        game.user?.isGM === true ||
        (!!game.user && userOwnsCombatant(game.user, combatant));
      if (canWriteLocally && typeof updateInitiative === "function") {
        try {
          await updateInitiative.call(combatant, { initiative: total });
          written = true;
        } catch (err) {
          // Foundry refuses the update when the user does not own the actor.
          logger.warn(`rollCombatantInitiative (write back): ${String(err)}`);
        }
      }

      // Always hand the value to the GM as well: the GM's handler does
      // nothing when the combatant already carries an initiative, so a
      // successful write-back is never overwritten. When the user cannot
      // write locally (no ownership) this is the only path that saves it.
      const messageId = typeof message?.id === "string" ? message.id : "";
      const relayed =
        !game.user?.isGM &&
        !!messageId &&
        requestInitiativeApply({
          type: "applyInitiative",
          combatantId,
          total,
          messageId,
          userId: game.user?.id ?? ""
        });
      logger.debug(
        `initiative rolled: ${combatant.name ?? combatantId} = ${total} (written=${written}, relayed=${relayed})`
      );

      // The trainer's active Pokémon shares the trainer's initiative: keep it
      // in sync (and relay it when the player cannot write it themselves).
      await syncActivePokemonInitiative(combatant, total);

      if (!written) {
        if (relayed) {
          ui.notifications?.info(game.i18n.localize("pokemon-hud-combat.error.initiativeRelayed"));
        } else {
          ui.notifications?.warn(game.i18n.localize("pokemon-hud-combat.error.initiativeNotSaved"));
        }
      }
      return;
    } catch (err) {
      logger.warn(`rollCombatantInitiative (system roll): ${String(err)}`);
    }
  }

  // Fallback: let Foundry build and post the initiative roll itself.
  const nativeRoll = (
    combatant as unknown as { rollInitiative?: (formula?: string) => Promise<unknown> }
  ).rollInitiative;
  if (typeof nativeRoll !== "function") {
    logger.warn("Combatant#rollInitiative unavailable");
    return;
  }
  await nativeRoll.call(combatant);
}

/** Keep a trainer's active Pokémon on the same initiative as the trainer.
 *
 * Called after a roll (with a chat message, so the value can be relayed) and
 * also from the combat hooks when a Pokémon is summoned/withdrawn or when the
 * trainer's initiative changes by any other means.
 */
async function syncActivePokemonInitiative(
  trainer: Combatant,
  total: number
): Promise<void> {
  const poke = activePokemonCombatant(trainer);
  if (!poke || poke.id === trainer.id) return;
  if (poke.initiative === total) return;

  const isGM = game.user?.isGM === true;
  if (!isGM && game.user && !userOwnsCombatant(game.user, poke)) return;

  const update = (poke as { update?: (data: { initiative: number | null }) => Promise<unknown> }).update;
  if (typeof update === "function") {
    try {
      await update.call(poke, { initiative: total });
    } catch (err) {
      logger.warn(`syncActivePokemonInitiative: ${String(err)}`);
    }
  }
}

let _syncingPokemon = false;
export async function syncPokemonInitiatives(): Promise<void> {
  if (_syncingPokemon) return;
  _syncingPokemon = true;
  try {
    const combat = game.combat;
    if (!combat) return;
    const combatants = Array.from(combat.combatants);
    for (const trainer of combatants) {
      const actor = combatantActor(trainer);
      if (!isTrainerActor(actor)) continue;
      if (typeof trainer.initiative !== "number") continue;
      const total = trainer.initiative;
      const poke = activePokemonCombatant(trainer);
      if (!poke || poke.id === trainer.id) continue;
      if (poke.initiative === total) continue;
      const isGM = game.user?.isGM === true;
      if (!isGM && game.user && !userOwnsCombatant(game.user, poke)) continue;
      const update = (poke as { update?: (data: { initiative: number | null }) => Promise<unknown> }).update;
      if (typeof update === "function") {
        try {
          await update.call(poke, { initiative: total });
        } catch (err) {
          logger.warn(`syncPokemonInitiatives: ${String(err)}`);
        }
      }
    }
  } finally {
    _syncingPokemon = false;
  }
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
