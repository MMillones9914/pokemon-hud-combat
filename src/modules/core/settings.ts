const SCOPE = "pokemon-hud-combat";

export const SETTINGS = {
  enabled: "enabled",
  autoShow: "autoShow",
  hideNativeTracker: "hideNativeTracker",
  gmBypass: "gmBypass",
  debug: "debug",
  imageSource: "imageSource",
  tokenSize: "tokenSize",
  battleIntro: "battleIntro",
  battleIntroDuration: "battleIntroDuration",
  playerTeamName: "playerTeamName",
  rivalTeams: "rivalTeams"
} as const;

export interface SettingsHooks {
  onHideNativeTrackerChange?: (hidden: boolean) => void;
  onEnabledChange?: (enabled: boolean) => void;
  onAutoShowChange?: (autoShow: boolean) => void;
  onTokenSizeChange?: () => void;
  onImageSourceChange?: () => void;
  onBattleIntroChange?: () => void;
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

  game.settings.register(SCOPE, SETTINGS.imageSource, {
    name: "pokemon-hud-combat.settings.imageSource.name",
    hint: "pokemon-hud-combat.settings.imageSource.hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      token: "pokemon-hud-combat.settings.imageSource.choices.token",
      actor: "pokemon-hud-combat.settings.imageSource.choices.actor"
    },
    default: "token",
    onChange: () => hooks?.onImageSourceChange?.()
  });

  game.settings.register(SCOPE, SETTINGS.tokenSize, {
    name: "pokemon-hud-combat.settings.tokenSize.name",
    hint: "pokemon-hud-combat.settings.tokenSize.hint",
    scope: "client",
    config: true,
    type: String,
    choices: {
      small: "pokemon-hud-combat.settings.tokenSize.choices.small",
      medium: "pokemon-hud-combat.settings.tokenSize.choices.medium",
      large: "pokemon-hud-combat.settings.tokenSize.choices.large"
    },
    default: "medium",
    onChange: () => hooks?.onTokenSizeChange?.()
  });

  game.settings.register(SCOPE, SETTINGS.battleIntro, {
    name: "pokemon-hud-combat.settings.battleIntro.name",
    hint: "pokemon-hud-combat.settings.battleIntro.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => hooks?.onBattleIntroChange?.()
  });

  game.settings.register(SCOPE, SETTINGS.battleIntroDuration, {
    name: "pokemon-hud-combat.settings.battleIntroDuration.name",
    hint: "pokemon-hud-combat.settings.battleIntroDuration.hint",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 1, max: 15, step: 1 },
    default: 3,
    onChange: () => hooks?.onBattleIntroChange?.()
  });

  game.settings.register(SCOPE, SETTINGS.playerTeamName, {
    name: "pokemon-hud-combat.settings.playerTeamName.name",
    hint: "pokemon-hud-combat.settings.playerTeamName.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => hooks?.onBattleIntroChange?.()
  });

  game.settings.register(SCOPE, SETTINGS.rivalTeams, {
    name: "pokemon-hud-combat.settings.rivalTeams.name",
    hint: "pokemon-hud-combat.settings.rivalTeams.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    onChange: () => hooks?.onBattleIntroChange?.()
  });
}

export function getSettings(): {
  enabled: boolean;
  autoShow: boolean;
  hideNativeTracker: boolean;
  gmBypass: boolean;
  debug: boolean;
  imageSource: "token" | "actor";
  tokenSize: "small" | "medium" | "large";
  battleIntro: boolean;
  battleIntroDuration: number;
  playerTeamName: string;
  rivalTeams: string;
} {
  const rawSize = game.settings.get(SCOPE, SETTINGS.tokenSize) as string;
  const tokenSize = (rawSize === "small" || rawSize === "large" ? rawSize : "medium") as
    | "small"
    | "medium"
    | "large";
  const rawImg = game.settings.get(SCOPE, SETTINGS.imageSource) as string;
  const imageSource = rawImg === "actor" ? "actor" : "token";
  const rawDuration = Number(game.settings.get(SCOPE, SETTINGS.battleIntroDuration));
  const battleIntroDuration = Number.isFinite(rawDuration)
    ? Math.min(Math.max(Math.round(rawDuration), 1), 15)
    : 3;
  return {
    enabled: game.settings.get(SCOPE, SETTINGS.enabled) as boolean,
    autoShow: game.settings.get(SCOPE, SETTINGS.autoShow) as boolean,
    hideNativeTracker: game.settings.get(SCOPE, SETTINGS.hideNativeTracker) as boolean,
    gmBypass: game.settings.get(SCOPE, SETTINGS.gmBypass) as boolean,
    debug: game.settings.get(SCOPE, SETTINGS.debug) as boolean,
    imageSource,
    tokenSize,
    battleIntro: game.settings.get(SCOPE, SETTINGS.battleIntro) as boolean,
    battleIntroDuration,
    playerTeamName: (game.settings.get(SCOPE, SETTINGS.playerTeamName) as string) ?? "",
    rivalTeams: (game.settings.get(SCOPE, SETTINGS.rivalTeams) as string) ?? ""
  };
}

export function isDebug(): boolean {
  return getSettings().debug;
}
