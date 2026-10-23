import "./styles/module.scss";
import { registerApi } from "./modules/api";
import {
  awaitBattleIntro,
  hideBattleIntro,
  refreshBattleIntro,
  showBattleIntro,
  syncBattleIntro
} from "./modules/apps/BattleIntroApp";
import { hideCombatHud, refreshCombatHud, syncCombatHud } from "./modules/apps/CombatHudApp";
import { registerHandlebarsHelpers } from "./modules/core/handlebars";
import { gateForCombatant, syncPokemonInitiatives } from "./modules/core/hud-context";
import { registerKeybindings } from "./modules/core/keybindings";
import { logger } from "./modules/core/logger";
import { applyNativeTrackerVisibility } from "./modules/core/native-tracker";
import { getSettings, registerSettings } from "./modules/core/settings";
import { registerSocketHandlers } from "./modules/core/socket";

const MODULE_ID = "pokemon-hud-combat";

Hooks.once("init", () => {
  registerSettings({
    onHideNativeTrackerChange: () => applyNativeTrackerVisibility(),
    onEnabledChange: (enabled) => {
      applyNativeTrackerVisibility();
      if (enabled) syncCombatHud();
      else hideCombatHud();
    },
    onAutoShowChange: () => syncCombatHud(),
    onTokenSizeChange: () => refreshCombatHud(),
    onImageSourceChange: () => refreshCombatHud(),
    onBattleIntroChange: () => {
      if (!getSettings().battleIntro) hideBattleIntro();
    }
  });
  registerKeybindings();
  registerHandlebarsHelpers();
  registerSocketHandlers();
  installInitiativeGate();
});

Hooks.once("ready", () => {
  applyNativeTrackerVisibility();
  registerApi();
  syncCombatHud();
  const version = game.modules.get(MODULE_ID)?.version ?? "?";
  logger.info(`Pokémon HUD Combat Tracker v${version} ready`);
});

Hooks.on("createCombat", (combat: Combat) => {
  maybeShowBattleIntro(combat);
  syncCombatHud();
});
Hooks.on("deleteCombat", () => {
  hideCombatHud();
  hideBattleIntro();
});
Hooks.on("updateCombat", (combat: Combat) => {
  refreshCombatHud();
  refreshBattleIntro();
  syncBattleIntro(combat);
});
Hooks.on("createCombatant", () => {
  refreshCombatHud();
  refreshBattleIntro();
  void syncPokemonInitiatives();
});
Hooks.on("updateCombatant", () => {
  refreshCombatHud();
  refreshBattleIntro();
  void syncPokemonInitiatives();
});
Hooks.on("deleteCombatant", () => {
  refreshCombatHud();
  refreshBattleIntro();
});
Hooks.on("combatStart", () => refreshCombatHud());
Hooks.on("combatRound", () => refreshCombatHud());
Hooks.on("combatTurn", () => refreshCombatHud());
Hooks.on("updateActor", () => {
  refreshCombatHud();
  void syncPokemonInitiatives();
});
Hooks.on("createToken", () => {
  refreshCombatHud();
  void syncPokemonInitiatives();
});
Hooks.on("updateToken", () => {
  refreshCombatHud();
  void syncPokemonInitiatives();
});
Hooks.on("deleteToken", () => refreshCombatHud());

interface RollablePrototype {
  rollInitiative?: (...args: unknown[]) => Promise<unknown>;
  __phcGated?: boolean;
}

/** Last combat id the GM setup / player-wait was prepared for. */
let introShownForCombat: string | null = null;

function maybeShowBattleIntro(combat: Combat): void {
  try {
    if (!getSettings().battleIntro) return;
    const id = combat?.id ?? null;
    if (!id || introShownForCombat === id) return;
    introShownForCombat = id;
    if (game.user?.isGM === true) showBattleIntro();
    else awaitBattleIntro();
  } catch (err) {
    logger.warn(`maybeShowBattleIntro: ${String(err)}`);
  }
}

function warnBlocked(blockedKey: string | null): void {
  const key = blockedKey ?? "pokemon-hud-combat.error.noActivePokemon";
  ui.notifications?.warn(game.i18n.localize(key));
}

/**
 * Rule 1: a trainer cannot roll initiative without an active Pokémon. Both
 * entry points are guarded:
 * - `Combatant#rollInitiative` — HUD dice button and the native per-row roll;
 * - `Combat#rollInitiative` — the native "Roll All" / "Roll NPCs" batches, which
 *   build every roll at once and would otherwise skip the per-combatant check.
 */
function installInitiativeGate(): void {
  patchCombatantRoll();
  patchCombatRoll();
}

function patchCombatantRoll(): void {
  try {
    const proto = (globalThis as { Combatant?: { prototype: unknown } }).Combatant?.prototype as
      RollablePrototype | undefined;
    if (!proto || typeof proto.rollInitiative !== "function" || proto.__phcGated) return;

    const original = proto.rollInitiative;
    proto.rollInitiative = function (this: Combatant, ...args: unknown[]): Promise<unknown> {
      try {
        if (getSettings().enabled) {
          const verdict = gateForCombatant(this);
          if (!verdict.allowed) {
            warnBlocked(verdict.blockedKey);
            return Promise.resolve(undefined);
          }
        }
      } catch (err) {
        logger.warn(`initiative gate (combatant): ${String(err)}`);
      }
      return original.apply(this, args);
    };
    proto.__phcGated = true;
  } catch (err) {
    logger.error(`patchCombatantRoll: ${String(err)}`);
  }
}

function patchCombatRoll(): void {
  try {
    const proto = (globalThis as { Combat?: { prototype: unknown } }).Combat?.prototype as
      RollablePrototype | undefined;
    if (!proto || typeof proto.rollInitiative !== "function" || proto.__phcGated) return;

    const original = proto.rollInitiative;
    proto.rollInitiative = function (
      this: Combat,
      ids: unknown,
      options?: unknown
    ): Promise<unknown> {
      try {
        if (getSettings().enabled) {
          const combatants = Array.from(this.combatants);
          const requested = Array.isArray(ids) ? ids : [ids];
          const allowed: unknown[] = [];
          for (const id of requested) {
            const combatant = combatants.find((c) => c.id === id);
            if (!combatant) continue;
            const verdict = gateForCombatant(combatant);
            if (verdict.allowed) allowed.push(id);
            else warnBlocked(verdict.blockedKey);
          }
          if (allowed.length === 0) return Promise.resolve(this);
          return original.call(this, allowed, options);
        }
      } catch (err) {
        logger.warn(`initiative gate (combat): ${String(err)}`);
      }
      return original.call(this, ids, options);
    };
    proto.__phcGated = true;
  } catch (err) {
    logger.error(`patchCombatRoll: ${String(err)}`);
  }
}
