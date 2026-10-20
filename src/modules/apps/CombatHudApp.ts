import type { DeepPartial } from "fvtt-types/utils";
import { patchChildren } from "../core/dom-patch";
import type { Faction } from "../core/faction";
import {
  endCombat,
  nextTurn,
  previousTurn,
  rollAllInitiatives,
  rollCombatantInitiative,
  startCombat
} from "../core/hud-context";
import { buildCombatView } from "../core/hud-context";
import type { InitiativeRollMode } from "../core/initiative-mode";
import { logger } from "../core/logger";
import { toggleNativeTracker } from "../core/native-tracker";
import { getSettings } from "../core/settings";
import type { CombatView, PokemonRow } from "../types/index";

const MODULE_ID = "pokemon-hud-combat";

const ROW_KEYS = "pokemon-hud-combat.hud";

/** Foundry's Handlebars renderer, used to build the bar off-DOM for in-place patching. */
function renderBarTemplate(path: string, data: unknown): Promise<string> | null {
  const render = (
    globalThis as {
      foundry?: {
        applications?: {
          handlebars?: { renderTemplate?: (p: string, d: unknown) => Promise<string> };
        };
      };
    }
  ).foundry?.applications?.handlebars?.renderTemplate;
  return typeof render === "function" ? render(path, data) : null;
}

export interface TemplatePokemon {
  combatantId: string | null;
  name: string;
  img: string;
  initiativeText: string;
  hasInitiative: boolean;
  defeated: boolean;
  active: boolean;
}

export interface TemplateGroup {
  combatantId: string;
  kind: "trainer" | "wild";
  isTrainer: boolean;
  name: string;
  img: string;
  initiative: number | null;
  initiativeText: string;
  hasInitiative: boolean;
  pending: boolean;
  defeated: boolean;
  active: boolean;
  faction: Faction;
  rollable: boolean;
  canRoll: boolean;
  /** Clicking the portrait rolls initiative (pending + allowed for this user). */
  canPortraitRoll: boolean;
  blockedKey: string | null;
  pokemon: TemplatePokemon | null;
}

interface CombatHudContext
  extends
    foundry.applications.api.HandlebarsApplicationMixin.RenderContext,
    foundry.applications.api.ApplicationV2.RenderContext {
  started: boolean;
  /** Current combat round (1-based once the combat has started). */
  round: number;
  /** Whether to paint the round counter (combat started and a round exists). */
  showRound: boolean;
  isGM: boolean;
  tokenHeight: string;
  groups: TemplateGroup[];
  hasGroups: boolean;
}

interface CombatHudConfiguration
  extends
    foundry.applications.api.HandlebarsApplicationMixin.Configuration,
    foundry.applications.api.ApplicationV2.Configuration {}

interface CombatHudRenderOptions
  extends
    foundry.applications.api.HandlebarsApplicationMixin.RenderOptions,
    foundry.applications.api.ApplicationV2.RenderOptions {}

function initiativeText(initiative: number | null): string {
  return typeof initiative === "number" ? String(initiative) : "—";
}

function pokemonRow(pokemon: PokemonRow): TemplatePokemon {
  return {
    combatantId: pokemon.combatantId,
    name: pokemon.name,
    img: pokemon.img,
    initiativeText: initiativeText(pokemon.initiative),
    hasInitiative: typeof pokemon.initiative === "number",
    defeated: pokemon.defeated,
    active: pokemon.active === true
  };
}

function toTemplateGroups(view: CombatView): TemplateGroup[] {
  return view.groups.map((group) => {
    const hasInitiative = typeof group.initiative === "number";
    const canRoll = canUserRoll(group.combatantId);
    const rollable = group.rollable;
    return {
      combatantId: group.combatantId,
      kind: group.kind,
      isTrainer: group.kind === "trainer",
      name: group.name,
      img: group.img,
      initiative: group.initiative,
      initiativeText: initiativeText(group.initiative),
      hasInitiative,
      pending: !hasInitiative,
      defeated: group.defeated,
      active: group.active || group.pokemon?.active === true,
      faction: group.faction,
      rollable,
      canRoll,
      canPortraitRoll: !hasInitiative && rollable && canRoll,
      blockedKey: group.blockedKey,
      pokemon: group.pokemon ? pokemonRow(group.pokemon) : null
    };
  });
}

/** Players only see the dice button on combatants they are allowed to update. */
function canUserRoll(combatantId: string): boolean {
  try {
    const combatant = Array.from(game.combat?.combatants ?? []).find((c) => c.id === combatantId);
    if (!combatant) return false;
    if (game.user?.isGM) return true;
    const canModify = (combatant as { canUserModify?: (user: User, action: string) => boolean })
      .canUserModify;
    return typeof canModify === "function" ? canModify.call(combatant, game.user, "update") : true;
  } catch {
    return true;
  }
}

export class CombatHudApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2
)<CombatHudContext, CombatHudConfiguration, CombatHudRenderOptions> {
  static override DEFAULT_OPTIONS: DeepPartial<CombatHudConfiguration> = {
    id: `${MODULE_ID}.bar`,
    tag: "section",
    classes: [MODULE_ID, "phc-top-bar", "phc-bar"],
    window: {
      title: `${ROW_KEYS}.title`,
      resizable: false,
      frame: false
    },
    position: {
      width: 960,
      height: "auto"
    }
  };

  static override PARTS: Record<
    string,
    foundry.applications.api.HandlebarsApplicationMixin.HandlebarsTemplatePart
  > = {
    bar: {
      template: `modules/${MODULE_ID}/templates/apps/combat-hud-0.3.2.hbs`,
      id: `${MODULE_ID}-bar`,
      root: true
    }
  };

  #onResizeBound?: () => void;
  #resizeObserver?: ResizeObserver;

  override async _prepareContext(
    _options: DeepPartial<CombatHudRenderOptions> & { isFirstRender?: boolean }
  ): Promise<CombatHudContext> {
    const view = buildCombatView();
    const groups = toTemplateGroups(view);
    return {
      started: view.started,
      round: view.round,
      showRound: view.started && view.round > 0,
      isGM: game.user?.isGM === true,
      tokenHeight: tokenHeightCss(),
      groups,
      hasGroups: groups.length > 0
    };
  }

  protected override async _onFirstRender(
    _context: DeepPartial<CombatHudContext>,
    _options: DeepPartial<CombatHudRenderOptions>
  ): Promise<void> {
    try {
      await super._onFirstRender(_context, _options);
    } catch (err) {
      this.#handleError("_onFirstRender", err);
    }
    try {
      this.element.addEventListener("click", this.#onClick);
      this.#bindPositioning();
    } catch (err) {
      this.#handleError("bind events", err);
    }
  }

  protected override async _onRender(
    _context: DeepPartial<CombatHudContext>,
    _options: DeepPartial<CombatHudRenderOptions>
  ): Promise<void> {
    try {
      await super._onRender(_context, _options);
      this.#applyRenderEffects();
    } catch (err) {
      this.#handleError("_onRender", err);
    }
  }

  override _onClose(options: DeepPartial<CombatHudRenderOptions>): void {
    this.#unbindPositioning();
    if (activeInstance === this) activeInstance = null;
    super._onClose(options);
  }

  #onClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (!action) return;
    if (action === "roll-initiative") void this.#onRollInitiative(button, event);
    else if (action === "roll-all") void this.#onRollAll();
    else if (action === "focus-combatant") this.#onFocusCombatant(button);
    else if (action === "start-combat") void this.#onStartCombat();
    else if (action === "next-turn") void this.#onNextTurn();
    else if (action === "previous-turn") void this.#onPreviousTurn();
    else if (action === "end-combat") void this.#onEndCombat();
    else if (action === "toggle-native") void this.#onToggleNative();
  };

  /** Alt = advantage, Ctrl/Cmd = disadvantage, plain click = normal roll. */
  #rollModeFromEvent(event: Event): InitiativeRollMode {
    const mouse = event as MouseEvent;
    if (mouse.altKey) return "advantage";
    if (mouse.ctrlKey || mouse.metaKey) return "disadvantage";
    return "normal";
  }

  async #onRollInitiative(element: HTMLElement, event: Event): Promise<void> {
    const combatantId = element.dataset.combatantId;
    if (!combatantId) return;
    try {
      await rollCombatantInitiative(combatantId, this.#rollModeFromEvent(event));
    } catch (err) {
      this.#handleError("roll-initiative", err);
    }
    await this.refreshInPlace();
  }

  async #onRollAll(): Promise<void> {
    if (!game.user?.isGM) return;
    try {
      await rollAllInitiatives();
    } catch (err) {
      this.#handleError("roll-all", err);
    }
    await this.refreshInPlace();
  }

  #onFocusCombatant(element: HTMLElement): void {
    const combatantId = element.dataset.combatantId;
    const combatant = combatantId
      ? Array.from(game.combat?.combatants ?? []).find((c) => c.id === combatantId)
      : undefined;
    try {
      const center = (
        combatant?.token as { object?: { center?: { x: number; y: number } } } | undefined
      )?.object?.center;
      if (!center) return;
      void (
        canvas as { animatePan?: (opts: { x: number; y: number }) => Promise<unknown> }
      ).animatePan?.({ x: center.x, y: center.y });
    } catch (err) {
      this.#handleError("focus-combatant", err);
    }
  }

  async #onStartCombat(): Promise<void> {
    if (!game.user?.isGM) return;
    try {
      await startCombat();
    } catch (err) {
      this.#handleError("start-combat", err);
    }
    await this.refreshInPlace();
  }

  async #onNextTurn(): Promise<void> {
    if (!game.user?.isGM) return;
    try {
      await nextTurn();
    } catch (err) {
      this.#handleError("next-turn", err);
    }
    await this.refreshInPlace();
  }

  async #onPreviousTurn(): Promise<void> {
    if (!game.user?.isGM) return;
    try {
      await previousTurn();
    } catch (err) {
      this.#handleError("previous-turn", err);
    }
    await this.refreshInPlace();
  }

  async #onEndCombat(): Promise<void> {
    if (!game.user?.isGM) return;
    let confirmed = true;
    try {
      const DialogV2 = (
        foundry.applications.api as unknown as {
          DialogV2?: {
            confirm?: (options: Record<string, unknown>) => Promise<boolean>;
          };
        }
      ).DialogV2;
      if (DialogV2?.confirm) {
        confirmed = await DialogV2.confirm({
          window: { title: game.i18n.localize(`${ROW_KEYS}.endCombat`) },
          content: `<p>${game.i18n.localize(`${ROW_KEYS}.endCombatConfirm`)}</p>`,
          yes: { default: true },
          rejectClose: false
        });
      }
    } catch (err) {
      logger.warn(`end-combat confirm: ${String(err)}`);
    }
    if (!confirmed) return;
    try {
      await endCombat();
    } catch (err) {
      this.#handleError("end-combat", err);
    }
  }

  async #onToggleNative(): Promise<void> {
    toggleNativeTracker();
    await this.refreshInPlace();
  }

  /** Rebuild the view off-DOM and diff it into the live bar (no flicker). */
  async refreshInPlace(): Promise<void> {
    if (!this.rendered || !this.element?.isConnected) return;
    let html: string | null;
    try {
      html = await renderBarTemplate(
        CombatHudApp.PARTS.bar.template,
        await this._prepareContext({ isFirstRender: false })
      );
    } catch (err) {
      this.#handleError("refreshInPlace", err);
      return;
    }
    if (!html) {
      await this.render({ force: true });
      return;
    }
    const freshRoot = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
    if (!freshRoot) {
      await this.render({ force: true });
      return;
    }
    patchChildren(this.element, freshRoot);
    this.#applyRenderEffects();
  }

  /** Everything `_onRender` does once the markup exists; patches need it too. */
  #applyRenderEffects(): void {
    try {
      this.#applyThemeClass();
      this.#applySize();
      this.#positionBar();
      this.#repositionAfterRender();
    } catch (err) {
      this.#handleError("applyRenderEffects", err);
    }
  }

  #applyThemeClass(): void {
    if (this.element.classList.contains("themed")) return;
    let raw = "";
    try {
      const scheme = game.settings.get("core", "uiConfig").colorScheme;
      raw = scheme.applications || scheme.interface || "";
    } catch {
      raw = "";
    }
    const dark =
      raw === "dark"
        ? true
        : raw === "light"
          ? false
          : matchMedia("(prefers-color-scheme: dark)").matches;
    this.element.classList.toggle("theme-dark", dark);
    this.element.classList.toggle("theme-light", !dark);
  }

  #applySize(): void {
    const el = this.element as HTMLElement;
    el.style.setProperty("--phc-token-h", tokenHeightCss(), "important");
    el.style.setProperty("--phc-poke-h", pokemonHeightCss(), "important");
  }

  #handleError(where: string, err: unknown): void {
    const detail = err instanceof Error ? err.message || err.stack : String(err);
    logger.error(`${where}: ${detail}`);
  }

  /** Fixed top bar, centered over the canvas but never under the sidebar. */
  #positionBar(): void {
    const el = this.element;
    if (!el.isConnected) return;
    const margin = 8;
    const sidebar = document.getElementById("sidebar");
    const sidebarLeft =
      sidebar && sidebar.offsetWidth > 0 ? sidebar.getBoundingClientRect().left : window.innerWidth;
    const available = Math.max(320, sidebarLeft - margin * 2);

    el.style.setProperty("max-width", `${available}px`, "important");
    el.style.setProperty("width", "fit-content", "important");
    const width = el.getBoundingClientRect().width;
    const left = Math.max(margin, Math.round((sidebarLeft - width) / 2));
    el.style.setProperty("left", `${left}px`, "important");
    el.style.setProperty("top", `${margin}px`, "important");
    el.style.setProperty("transform", "none", "important");
  }

  #repositionAfterRender(): void {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          this.#positionBar();
        } catch (err) {
          this.#handleError("repositionAfterRender", err);
        }
      });
    });
  }

  #bindPositioning(): void {
    try {
      this.#onResizeBound = () => this.#positionBar();
      window.addEventListener("resize", this.#onResizeBound);
      this.#resizeObserver = new ResizeObserver(this.#onResizeBound);
      this.#resizeObserver.observe(this.element);
      const sidebar = document.getElementById("sidebar");
      if (sidebar) this.#resizeObserver.observe(sidebar);
    } catch (err) {
      this.#handleError("bind positioning", err);
    }
  }

  #unbindPositioning(): void {
    if (this.#onResizeBound) window.removeEventListener("resize", this.#onResizeBound);
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    this.#onResizeBound = undefined;
  }
}

let activeInstance: CombatHudApp | null = null;
let scheduledFlush: number | null = null;
let pendingAction: "show" | "hide" | "refresh" | null = null;
/** While a battle intro (VS screen) is up the bar stays out of the way. */
let hudSuppressed = false;

/**
 * Hide the combat bar while the VS screen is on, and restore it afterwards.
 * Suppression is also mirrored as a body class so the CSS keeps the bar hidden
 * even during the frame before the intro paints its own overlay.
 */
export function setCombatHudSuppressed(suppressed: boolean): void {
  hudSuppressed = suppressed;
  try {
    document.body?.classList.toggle("phc-intro-open", suppressed);
  } catch {
    /* no DOM yet (pre-ready) */
  }
  if (suppressed) hideCombatHud();
  else syncCombatHud();
}

function flushSchedule(): void {
  scheduledFlush = null;
  const action = pendingAction;
  pendingAction = null;
  if (action === "show") {
    if (hudSuppressed) return;
    if (!activeInstance) activeInstance = new CombatHudApp();
    if (activeInstance.rendered) void activeInstance.refreshInPlace();
    else void activeInstance.render({ force: true });
    return;
  }
  if (action === "hide") {
    const app = activeInstance;
    activeInstance = null;
    if (app) void app.close();
    return;
  }
  if (action === "refresh") void activeInstance?.refreshInPlace();
}

function schedule(action: "show" | "hide" | "refresh"): void {
  if (action === "hide") pendingAction = "hide";
  else if (action === "show") pendingAction = "show";
  else if (pendingAction !== "hide" && pendingAction !== "show") pendingAction = "refresh";
  if (scheduledFlush !== null) return;
  scheduledFlush = requestAnimationFrame(flushSchedule);
}

/**
 * Combatant (trainer/wild) token HEIGHT from the `tokenSize` setting.
 * small → 100px, medium → 125px, large → 150px (default: medium).
 * Width is derived in CSS from the height (3:4 portrait ratio).
 */
function tokenHeightCss(): string {
  const size = getSettings().tokenSize;
  if (size === "small") return "100px";
  if (size === "large") return "150px";
  return "125px";
}

/**
 * Summoned Pokémon mini-token HEIGHT: small → 75px, medium → 100px,
 * large → 125px (always smaller than the trainer card).
 */
function pokemonHeightCss(): string {
  const size = getSettings().tokenSize;
  if (size === "small") return "75px";
  if (size === "large") return "125px";
  return "100px";
}

export function isCombatHudVisible(): boolean {
  return activeInstance?.rendered === true;
}

/** Show the bar (coalesced into one patch per frame). */
export function showCombatHud(): void {
  if (!getSettings().enabled || hudSuppressed) return;
  schedule("show");
}

export function hideCombatHud(): void {
  schedule("hide");
}

export function refreshCombatHud(): void {
  if (!activeInstance) return;
  schedule("refresh");
}

/** Auto behaviour: show while a Combat exists, hide when it is deleted. */
export function syncCombatHud(): void {
  const settings = getSettings();
  if (!settings.enabled || hudSuppressed) {
    hideCombatHud();
    return;
  }
  if (!game.combat) {
    hideCombatHud();
    return;
  }
  if (settings.autoShow) showCombatHud();
}

/** Keybinding entry point: cancel any pending flush and flip immediately. */
export function toggleCombatHud(): void {
  if (!getSettings().enabled) return;
  if (scheduledFlush !== null) {
    cancelAnimationFrame(scheduledFlush);
    scheduledFlush = null;
    pendingAction = null;
  }
  if (activeInstance) {
    const app = activeInstance;
    activeInstance = null;
    void app.close();
    return;
  }
  activeInstance = new CombatHudApp();
  void activeInstance.render({ force: true });
}
