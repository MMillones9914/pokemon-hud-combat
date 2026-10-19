const SCOPE = "pokemon-hud-combat";

export const SETTINGS = {
  enabled: "enabled",
  autoShow: "autoShow",
  hideNativeTracker: "hideNativeTracker",
  gmBypass: "gmBypass",
  debug: "debug"
} as const;

export interface SettingsHooks {
  onHideNativeTrackerChange?: (hidden: boolean) => void;
  onEnabledChange?: (enabled: boolean) => void;
  onAutoShowChange?: (autoShow: boolean) => void;
}

export function registerSettings(hooks?: SettingsHooks): void {
  game.settings.register(SCOPE, SETTINGS.enabled, {
    name: "pokemon-hud-combat.settings.enabled.name",
    hint: "pokemon-hud-combat.settings.enabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: (value: unknown) => hooks?.onEnabledChange?.(value === true)
  });

  game.settings.register(SCOPE, SETTINGS.autoShow, {
    name: "pokemon-hud-combat.settings.autoShow.name",
    hint: "pokemon-hud-combat.settings.autoShow.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (value: unknown) => hooks?.onAutoShowChange?.(value === true)
  });

  game.settings.register(SCOPE, SETTINGS.hideNativeTracker, {
    name: "pokemon-hud-combat.settings.hideNativeTracker.name",
    hint: "pokemon-hud-combat.settings.hideNativeTracker.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: (value: unknown) => hooks?.onHideNativeTrackerChange?.(value === true)
  });

  game.settings.register(SCOPE, SETTINGS.gmBypass, {
    name: "pokemon-hud-combat.settings.gmBypass.name",
    hint: "pokemon-hud-combat.settings.gmBypass.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(SCOPE, SETTINGS.debug, {
    name: "pokemon-hud-combat.settings.debug.name",
    hint: "pokemon-hud-combat.settings.debug.hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
}

export function getSettings(): {
  enabled: boolean;
  autoShow: boolean;
  hideNativeTracker: boolean;
  gmBypass: boolean;
  debug: boolean;
} {
  return {
    enabled: game.settings.get(SCOPE, SETTINGS.enabled) as boolean,
    autoShow: game.settings.get(SCOPE, SETTINGS.autoShow) as boolean,
    hideNativeTracker: game.settings.get(SCOPE, SETTINGS.hideNativeTracker) as boolean,
    gmBypass: game.settings.get(SCOPE, SETTINGS.gmBypass) as boolean,
    debug: game.settings.get(SCOPE, SETTINGS.debug) as boolean
  };
}

export function isDebug(): boolean {
  return getSettings().debug;
}
