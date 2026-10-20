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
  #confirmed = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onKeyBound?: (event: KeyboardEvent) => void;
  #onClickBound?: (event: Event) => void;
  #onResizeBound?: () => void;

  /**
   * Frame height (in px) sized so at least `PORTRAITS_PER_ROW` portraits fit
   * in a single row on each side, while keeping the 150:400 ratio (0.375) and
   * never overflowing the screen height. Written as the `--phc-vs-h` CSS
   * custom property; a plain pixel number avoids any `min()`/`calc()`/unit
   * resolution trouble inside Foundry's stylesheet.
   */
  #fitFrames(): void {
    try {
      const el = this.element as HTMLElement | null;
      if (!el) return;
      const vw = window.innerWidth || document.documentElement.clientWidth || 1280;
      const vh = window.innerHeight || document.documentElement.clientHeight || 720;
      const ratio = 0.375; // 150:400
      const perRow = 5;
      // Roughly what each side gets: half the width, minus the middle spacer,
      // page padding and the gaps required by one row of frames.
      const gutter = Math.max(4, Math.min(14, vw * 0.009));
      const gapTotal = gutter * (perRow - 1);
      const middle = Math.max(70, Math.min(170, vw * 0.09));
      const padding = Math.max(16, vh * 0.036);
      const sideWidth = (vw - middle - padding) / 2;
      const byWidth = (sideWidth - gapTotal) / perRow / ratio;
      // Never taller than ~68% of the viewport (leaves room for the picker,
      // the team name and the hint), and never absurdly small.
      const byHeight = vh * 0.68;
      const h = Math.max(120, Math.min(byWidth, byHeight));
      el.style.setProperty("--phc-vs-h", `${Math.floor(h)}px`);
    } catch (err) {
      this.#handleError("fitFrames", err);
    }
  }

  override async _prepareContext(
    _options: DeepPartial<BattleIntroRenderOptions> & { isFirstRender?: boolean }
  ): Promise<BattleIntroContext> {
    const view = buildBattleIntroView(this.#rivalTeam);
    const isGM = game.user?.isGM === true;
    const rivalNames = view.rivalTeams;
    return {
      isGM,
      showPicker: isGM && !this.#confirmed,
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
      this.#onResizeBound = () => this.#fitFrames();
      this.element.addEventListener("click", this.#onClickBound);
      window.addEventListener("keydown", this.#onKeyBound);
      window.addEventListener("resize", this.#onResizeBound);
      // Keep the combat bar out of sight while the VS screen is up.
      setCombatHudSuppressed(true);
      // Size the portraits before the first paint so nothing flashes.
      this.#fitFrames();
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
    this.#fitFrames();
    this.#scheduleAutoClose();
  }

  override _onClose(options: DeepPartial<BattleIntroRenderOptions>): void {
    this.#clearTimer();
    try {
      if (this.#onClickBound) this.element.removeEventListener("click", this.#onClickBound);
      if (this.#onKeyBound) window.removeEventListener("keydown", this.#onKeyBound);
      if (this.#onResizeBound) window.removeEventListener("resize", this.#onResizeBound);
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
    if (action === "start") {
      // Confirmed: drop the GM picker so only the portraits remain on screen.
      this.#confirmed = true;
      void this.render({ force: true });
      return;
    }
    if (action === "noop") return;
    // Clicking the backdrop (or any non-control surface) skips the intro.
    this.#closeNow();
  }

  /**
   * Rebuild the view from live combat data. Called while the screen is open
   * when combatants arrive after the Combat document itself, which is the
   * normal order on player clients (so they get the portraits too).
   *
   * Skipped while the GM is still choosing, so an open dropdown is never
   * re-rendered out from under them; the GM's view refreshes on confirmation.
   */
  refreshView(): void {
    if (!this.rendered) return;
    if (!this.#confirmed && game.user?.isGM === true) return;
    try {
      void this.render();
    } catch (err) {
      this.#handleError("refreshView", err);
    }
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
  // Suppress the bar immediately (synchronously) so the `createCombat` hook's
  // `syncCombatHud()` right after this can never flash the tracker on screen.
  setCombatHudSuppressed(true);
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

/**
 * Rebuild the open VS screen from live combat data. Safe to call at any time;
 * a no-op when the screen is closed.
 */
export function refreshBattleIntro(): void {
  activeInstance?.refreshView();
}

export function toggleBattleIntro(): void {
  if (activeInstance) hideBattleIntro();
  else showBattleIntro();
}
