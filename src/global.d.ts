export {};

declare global {
  interface AssumeHookRan {
    ready: object;
  }

  interface SettingConfig {
    "pokemon-hud-combat.enabled": boolean;
    "pokemon-hud-combat.autoShow": boolean;
    "pokemon-hud-combat.hideNativeTracker": boolean;
    "pokemon-hud-combat.gmBypass": boolean;
    "pokemon-hud-combat.debug": boolean;
    "pokemon-hud-combat.imageSource": string;
    "pokemon-hud-combat.tokenSize": string;
    "pokemon-hud-combat.battleIntro": boolean;
    "pokemon-hud-combat.playerTeamName": string;
    "core.uiConfig": foundry.applications.settings.menus.UIConfig.GameUIConfiguration;
  }

  /** Flags this module stores on the Combat document. */
  interface FlagConfig {
    Combat: {
      "pokemon-hud-combat": {
        battleIntro: import("./modules/core/battle-intro").BattleIntroConfig;
      };
    };
  }

  interface ModuleConfig {
    "pokemon-hud-combat": {
      api: import("./modules/api").PokemonHudCombatApi;
    };
  }
}
