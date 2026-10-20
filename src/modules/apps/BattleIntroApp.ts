import type { DeepPartial } from "fvtt-types/utils";
import { buildBattleIntroView } from "../core/battle-intro";
import {
  encounterLabelKey,
  ENCOUNTER_KINDS,
  isEncounterImplemented,
  normalizeEncounterKind,
  type EncounterKind
} from "../core/encounters";
import { logger } from "../core/logger";
import { getSettings } from "../core/settings";
import { setCombatHudSuppressed } from "./CombatHudApp";

const MODULE_ID = "pokemon-hud-combat";
const KEYS = "pokemon-hud-combat.battleIntro";

interface KindOption {
  value: EncounterKind;
  label: string;
  implemented: boolean;
  selected: boolean;
}

interface TeamOption {
  label: string;
  selected: boolean;
}

interface BattleIntroContext
  extends
    foundry.applications.api.HandlebarsApplicationMixin.RenderContext,
    foundry.applications.api.ApplicationV2.RenderContext {
  isGM: boolean;
  showPicker: boolean;
  kinds: KindOption[];
  players: Array<{ id: string; name: string; img: string }>;
  rivals: Array<{ id: string; name: string; img: string }>;
  playerTeam: string;
  rivalTeam: string;
  rivalTeams: TeamOption[];
  durationMs: number;
}

interface BattleIntroConfiguration
  extends
    foundry.applications.api.HandlebarsApplicationMixin.Configuration,
    foundry.applications.api.ApplicationV2.Configuration {}

interface BattleIntroRenderOptions
  extends
    foundry.applications.api.HandlebarsApplicationMixin.RenderOptions,
    foundry.applications.api.ApplicationV2.RenderOptions {}

function localize(key: string, data?: Record<string, unknown>): string {
  try {
    const value = data ? game.i18n.format(key, data) : game.i18n.localize(key);
    return typeof value === "string" && value.length ? value : key;
  } catch {
    return key;
  }
}

/**
 * Full-screen "VS" battle intro (ApplicationV2).
 *
 * - Right/left sides come from the current combat (player trainers vs. rivals).
 * - Shown to every client at once when a combat is created.
 * - The GM picks the encounter kind and the rival team right on the screen;
 *   the picker is a no-op for players (they only see the result).
 * - Auto-closes after the configured number of seconds, and can be skipped with
 *   a click or any key press.
 */
export class BattleIntroApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
)<BattleIntroContext, BattleIntroConfiguration, BattleIntroRenderOptions> {
  static override DEFAULT_OPTIONS: DeepPartial<BattleIntroConfiguration> = {
    id: `${MODULE_ID}.battle-intro`,
    tag: "div",
    classes: [MODULE_ID, "phc-vs-overlay"],
    window: {
      frame: false,
      resizable: false,
      positioned: false,
      title: `${KEYS}.title`
    },
    position: {
      width: 960,
      height: 720
    }
  };

  static override PARTS: Record<
    string,
    foundry.applications.api.HandlebarsApplicationMixin.HandlebarsTemplatePart
  > = {
    intro: {
      template: `modules/${MODULE_ID}/templates/apps/battle-intro.hbs`,
      root: true
    }
  };

  #kind: EncounterKind = "trainers";
  #rivalTeam: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onKeyBound?: (event: KeyboardEvent) => void;
  #onClickBound?: (event: Event) => void;

  override async _prepareContext(
    _options: DeepPartial<BattleIntroRenderOptions> & { isFirstRender?: boolean }
  ): Promise<BattleIntroContext> {
    const view = buildBattleIntroView(this.#rivalTeam);
    const isGM = game.user?.isGM === true;
    const rivalNames = view.rivalTeams;
    return {
      isGM,
      showPicker: isGM,
      kinds: ENCOUNTER_KINDS.map((value) => ({
        value,
        label: localize(encounterLabelKey(value)),
        implemented: isEncounterImplemented(value),
        selected: value === this.#kind
      })),
      players: view.players.map((p) => ({ id: p.id, name: p.name, img: p.img })),
      rivals: view.rivals.map((r) => ({ id: r.id, name: r.name, img: r.img })),
      playerTeam: view.playerTeam,
      rivalTeam: view.rivalTeam,
      rivalTeams: rivalNames.map((team) => ({
        label: team,
        selected: team === view.rivalTeam
      })),
      durationMs: view.durationMs
    };
  }

  protected override async _onFirstRender(
    _context: DeepPartial<BattleIntroContext>,
    _options: DeepPartial<BattleIntroRenderOptions>
  ): Promise<void> {
    try {
      await super._onFirstRender(_context, _options);
    } catch (err) {
      this.#handleError("_onFirstRender", err);
    }
    try {
      this.#onClickBound = (event: Event) => void this.#onClick(event);
      this.#onKeyBound = (event: KeyboardEvent) => this.#onKey(event);
      this.element.addEventListener("click", this.#onClickBound);
      window.addEventListener("keydown", this.#onKeyBound);
      // Keep the combat bar out of sight while the VS screen is up.
      setCombatHudSuppressed(true);
    } catch (err) {
      this.#handleError("bind events", err);
    }
  }

  protected override async _onRender(
    _context: DeepPartial<BattleIntroContext>,
    _options: DeepPartial<BattleIntroRenderOptions>
  ): Promise<void> {
    try {
      await super._onRender(_context, _options);
    } catch (err) {
      this.#handleError("_onRender", err);
    }
    this.#scheduleAutoClose();
  }

  override _onClose(options: DeepPartial<BattleIntroRenderOptions>): void {
    this.#clearTimer();
    try {
      if (this.#onClickBound) this.element.removeEventListener("click", this.#onClickBound);
      if (this.#onKeyBound) window.removeEventListener("keydown", this.#onKeyBound);
    } catch {
      /* element already detached */
    }
    if (activeInstance === this) activeInstance = null;
    // Bring the combat bar back now that the presentation is over.
    setCombatHudSuppressed(false);
    super._onClose(options);
  }

  /** GM picks the encounter kind. Only implemented kinds are selectable. */
  #onPickKind(select: HTMLSelectElement): void {
    const kind = normalizeEncounterKind(select.value);
    if (!isEncounterImplemented(kind)) {
      select.value = this.#kind;
      return;
    }
    this.#kind = kind;
  }

  /** GM picks which rival team is shown on the right side. */
  #onPickTeam(select: HTMLSelectElement): void {
    this.#rivalTeam = select.value || null;
    void this.render({ force: true });
  }

  async #onClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    const control = target?.closest<HTMLElement>("[data-action]");
    const action = control?.dataset.action;
    if (action === "pick-kind" && control instanceof HTMLSelectElement) {
      this.#onPickKind(control);
      return;
    }
    if (action === "pick-team" && control instanceof HTMLSelectElement) {
      this.#onPickTeam(control);
      return;
    }
    if (action === "noop") return;
    // Clicking the backdrop (or any non-control surface) skips the intro.
    this.#closeNow();
  }

  #onKey(event: KeyboardEvent): void {
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") event.preventDefault();
    this.#closeNow();
  }

  #closeNow(): void {
    this.#clearTimer();
    void this.close();
  }

  #scheduleAutoClose(): void {
    this.#clearTimer();
    const root = this.element?.querySelector<HTMLElement>(".phc-vs") ?? this.element;
    const duration = Number(root?.dataset?.duration ?? 0);
    const wait = Number.isFinite(duration) && duration > 0 ? duration : 0;
    if (wait <= 0) return;
    this.#timer = setTimeout(() => this.#closeNow(), wait);
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #handleError(where: string, err: unknown): void {
    const detail = err instanceof Error ? err.message || err.stack : String(err);
    logger.error(`battle-intro ${where}: ${detail}`);
  }
}

let activeInstance: BattleIntroApp | null = null;

/** True while the VS screen is on screen. */
export function isBattleIntroVisible(): boolean {
  return activeInstance?.rendered === true;
}

/** Show the VS screen (no-op when the feature is off). */
export function showBattleIntro(): void {
  if (!getSettings().battleIntro) return;
  if (!activeInstance) activeInstance = new BattleIntroApp();
  void activeInstance.render({ force: true });
}

export function hideBattleIntro(): void {
  const app = activeInstance;
  activeInstance = null;
  if (app) void app.close();
  // Safety net: `_onClose` restores this, but clear it even when there is no
  // live instance (e.g. the setting was turned off mid-presentation).
  else setCombatHudSuppressed(false);
}

export function toggleBattleIntro(): void {
  if (activeInstance) hideBattleIntro();
  else showBattleIntro();
}
