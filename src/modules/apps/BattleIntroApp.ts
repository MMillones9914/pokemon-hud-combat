import type { DeepPartial } from "fvtt-types/utils";
import {
  buildBattleIntroView,
  readBattleIntroConfig,
  writeBattleIntroConfig,
  type BattleIntroConfig,
  type BattleIntroEntry
} from "../core/battle-intro";
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

interface BattleIntroContext
  extends
    foundry.applications.api.HandlebarsApplicationMixin.RenderContext,
    foundry.applications.api.ApplicationV2.RenderContext {
  isGM: boolean;
  /** True while the GM is still choosing: only the GM ever sees this. */
  setup: boolean;
  kinds: KindOption[];
  players: BattleIntroEntry[];
  rivals: BattleIntroEntry[];
  playerTeam: string;
  encounterName: string;
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
 * Two phases:
 *
 * - **setup** (GM only): the GM sees the portraits, picks the encounter kind
 *   and types the encounter name in the text bar on the rival side. Players see
 *   nothing at all — the tracker stays hidden until the GM is done.
 * - **presentation** (everybody): once the GM presses "Comenzar combate" the
 *   choice is stored on the Combat document and the portraits + names are shown
 *   to everyone. It auto-closes after the configured number of seconds and can
 *   be skipped with a click or any key press.
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

  #phase: "setup" | "presentation" = "setup";
  #kind: EncounterKind = "trainers";
  #encounterName = "";
  /** `null` while the GM has not confirmed: the live world setting is used. */
  #playerTeam: string | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onKeyBound?: (event: KeyboardEvent) => void;
  #onClickBound?: (event: Event) => void;
  #onInputBound?: (event: Event) => void;
  #onResizeBound?: () => void;
  /** Focus state of the name bar, kept across re-renders. */
  #focusName = false;
  #caret = 0;

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

  /** Open the GM setup screen (encounter kind + name bar). */
  openSetup(): void {
    this.#phase = "setup";
    void this.render({ force: true });
  }

  /** Switch to the final presentation, shared by every client. */
  present(config: BattleIntroConfig): void {
    this.#phase = "presentation";
    this.#kind = config.kind;
    this.#encounterName = config.encounterName ?? "";
    this.#playerTeam = config.playerTeam ?? "";
    void this.render({ force: true });
  }

  override async _prepareContext(
    _options: DeepPartial<BattleIntroRenderOptions> & { isFirstRender?: boolean }
  ): Promise<BattleIntroContext> {
    const isGM = game.user?.isGM === true;
    const setup = this.#phase === "setup" && isGM;
    // Remember where the caret was so the name bar survives a re-render.
    const active = document.activeElement as HTMLInputElement | null;
    this.#focusName =
      setup && !!active && active.dataset?.action === "pick-name" && !!this.element?.contains(active);
    this.#caret = this.#focusName ? (active?.selectionStart ?? 0) : 0;
    const playerTeam = this.#playerTeam ?? (getSettings().playerTeamName ?? "").trim();
    const view = buildBattleIntroView({
      encounterName: this.#encounterName,
      playerTeam
    });
    return {
      isGM,
      setup,
      kinds: ENCOUNTER_KINDS.map((value) => ({
        value,
        label: localize(encounterLabelKey(value)),
        implemented: isEncounterImplemented(value),
        selected: value === this.#kind
      })),
      players: view.players,
      rivals: view.rivals,
      playerTeam: view.playerTeam,
      encounterName: view.encounterName,
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
      this.#onInputBound = (event: Event) => void this.#onInput(event);
      this.#onResizeBound = () => this.#fitFrames();
      this.element.addEventListener("click", this.#onClickBound);
      this.element.addEventListener("input", this.#onInputBound);
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
    this.#restoreNameFocus();
    this.#scheduleAutoClose();
  }

  override _onClose(options: DeepPartial<BattleIntroRenderOptions>): void {
    this.#clearTimer();
    try {
      if (this.#onClickBound) this.element.removeEventListener("click", this.#onClickBound);
      if (this.#onInputBound) this.element.removeEventListener("input", this.#onInputBound);
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

  /** The GM types the encounter name; the value is kept without re-rendering. */
  #onInput(event: Event): void {
    const target = event.target as HTMLInputElement | null;
    if (!target || target.dataset?.action !== "pick-name") return;
    this.#encounterName = target.value ?? "";
  }

  /** Current content of the name bar (the live input wins over the cached one). */
  #readName(): string {
    const input = this.element?.querySelector<HTMLInputElement>('[data-action="pick-name"]');
    const value = typeof input?.value === "string" ? input.value : this.#encounterName;
    return value.trim();
  }

  /** Restore the caret in the name bar after a re-render. */
  #restoreNameFocus(): void {
    if (!this.#focusName) return;
    const input = this.element?.querySelector<HTMLInputElement>('[data-action="pick-name"]');
    if (!input) return;
    input.focus();
    const pos = Math.min(this.#caret, input.value.length);
    try {
      input.setSelectionRange(pos, pos);
    } catch {
      /* input without selection support */
    }
  }

  /** The GM confirms the encounter: everybody plays the intro. */
  async #onStart(): Promise<void> {
    try {
      const combat = game.combat ?? null;
      const config: BattleIntroConfig = {
        kind: this.#kind,
        encounterName: this.#readName(),
        playerTeam: this.#playerTeam ?? (getSettings().playerTeamName ?? "").trim(),
        state: "confirmed",
        startedAt: Date.now()
      };
      // Show it here and now; the flag write tells the other clients.
      presentBattleIntro(combat?.id ?? null, config);
      await writeBattleIntroConfig(combat, config);
    } catch (err) {
      this.#handleError("start", err);
    }
  }

  /** The GM skips the intro: nobody sees it and the tracker comes back. */
  async #onSkip(): Promise<void> {
    try {
      const combat = game.combat ?? null;
      const config: BattleIntroConfig = {
        kind: this.#kind,
        encounterName: this.#readName(),
        playerTeam: this.#playerTeam ?? (getSettings().playerTeamName ?? "").trim(),
        state: "cancelled",
        startedAt: Date.now()
      };
      cancelBattleIntro();
      await writeBattleIntroConfig(combat, config);
    } catch (err) {
      this.#handleError("skip", err);
    }
  }

  async #onClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement && target.dataset?.action === "pick-name") {
      return;
    }
    const control = target?.closest<HTMLElement>("[data-action]");
    const action = control?.dataset.action;
    if (action === "pick-kind" && control instanceof HTMLSelectElement) {
      this.#onPickKind(control);
      return;
    }
    if (action === "pick-name") return;
    if (action === "start") {
      await this.#onStart();
      return;
    }
    if (action === "skip") {
      await this.#onSkip();
      return;
    }
    if (action === "noop") return;
    // While the GM is configuring, only the explicit buttons act.
    if (this.#phase === "setup") return;
    // Clicking the backdrop (or any non-control surface) skips the intro.
    this.#closeNow();
  }

  /**
   * Rebuild the view from live combat data. Called while the screen is open
   * when combatants arrive after the Combat document itself, which is the
   * normal order on player clients (so they get the portraits too).
   *
   * While the GM is choosing, the re-render keeps the name bar focused and the
   * caret in place, so typing is never interrupted.
   */
  refreshView(): void {
    if (!this.rendered) return;
    try {
      void this.render();
    } catch (err) {
      this.#handleError("refreshView", err);
    }
  }

  #onKey(event: KeyboardEvent): void {
    // Never close (nor swallow keys) while the GM is filling the name bar.
    if (this.#phase === "setup") return;
    if (event.key === "Escape" || event.key === "Enter" || event.key === " ") event.preventDefault();
    this.#closeNow();
  }

  #closeNow(): void {
    this.#clearTimer();
    void this.close();
  }

  #scheduleAutoClose(): void {
    this.#clearTimer();
    // The setup screen waits for the GM: it must not time out on its own.
    if (this.#phase !== "presentation") return;
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
/** Combat ids whose intro already played, so it never opens twice. */
const presentedCombatIds = new Set<string>();

/** True while the VS screen is on screen. */
export function isBattleIntroVisible(): boolean {
  return activeInstance?.rendered === true;
}

/**
 * Show the setup screen to the GM (no-op when the feature is off).
 *
 * Players never get this: they wait for the GM to confirm the encounter.
 */
export function showBattleIntro(): void {
  if (!getSettings().battleIntro) return;
  // Suppress the bar immediately (synchronously) so the `createCombat` hook's
  // `syncCombatHud()` right after this can never flash the tracker on screen.
  setCombatHudSuppressed(true);
  if (!activeInstance) activeInstance = new BattleIntroApp();
  activeInstance.openSetup();
}

/**
 * Players: the GM has not confirmed the encounter yet, so nothing is shown —
 * but the tracker stays hidden until the intro is over.
 */
export function awaitBattleIntro(): void {
  if (!getSettings().battleIntro) return;
  setCombatHudSuppressed(true);
}

/**
 * Play the intro for everybody with the encounter the GM confirmed.
 *
 * `combatId` guards against replaying the same encounter twice (a re-connect
 * or any later update of the Combat document).
 */
export function presentBattleIntro(combatId: string | null, config: BattleIntroConfig): void {
  try {
    if (combatId) {
      if (presentedCombatIds.has(combatId)) return;
      presentedCombatIds.add(combatId);
    }
    setCombatHudSuppressed(true);
    if (!activeInstance) activeInstance = new BattleIntroApp();
    activeInstance.present(config);
  } catch (err) {
    logger.error(`presentBattleIntro: ${String(err)}`);
  }
}

/** The GM skipped the encounter: close everything and give the tracker back. */
export function cancelBattleIntro(): void {
  hideBattleIntro();
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

/**
 * React to a change of the Combat document: the GM confirmed or cancelled the
 * encounter and every client has to follow.
 */
export function syncBattleIntro(combat: Combat | null | undefined): void {
  try {
    if (!getSettings().battleIntro) return;
    const config = readBattleIntroConfig(combat);
    if (!config) return;
    if (config.state === "cancelled") {
      cancelBattleIntro();
      return;
    }
    if (config.state !== "confirmed") return;
    presentBattleIntro(combat?.id ?? null, config);
  } catch (err) {
    logger.error(`syncBattleIntro: ${String(err)}`);
  }
}

export function toggleBattleIntro(): void {
  if (activeInstance) hideBattleIntro();
  else showBattleIntro();
}
