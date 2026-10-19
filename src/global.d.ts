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
    "core.uiConfig": foundry.applications.settings.menus.UIConfig.GameUIConfiguration;
  }

  interface ModuleConfig {
    "pokemon-hud-combat": {
      api: import("./modules/api").PokemonHudCombatApi;
    };
  }
}
