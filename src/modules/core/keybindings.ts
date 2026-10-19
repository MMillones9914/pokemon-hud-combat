import { toggleCombatHud } from "../apps/CombatHudApp";
import { logger } from "./logger";

const MODULE_ID = "pokemon-hud-combat";

export function registerKeybindings(): void {
  game.keybindings.register(MODULE_ID, "toggle-hud", {
    name: "pokemon-hud-combat.keybindings.toggle.name",
    hint: "pokemon-hud-combat.keybindings.toggle.hint",
    editable: [{ key: "KeyC", modifiers: ["SHIFT", "ALT"] }],
    restricted: false,
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => {
      try {
        toggleCombatHud();
      } catch (err) {
        logger.error(
          "keybindings toggle-hud failed",
          err instanceof Error ? (err.stack ?? err.message) : String(err)
        );
      }
      return true;
    }
  });
}
