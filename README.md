# Pokémon HUD Combat Tracker

A Pokémon-style combat tracker HUD for **Foundry VTT v14**. It replaces the sidebar
Combat Tracker with a bar pinned to the top of the screen where every trainer is a card
and their active Pokémon sits in a smaller card right below them.

## Features

- **Trainer cards ordered by initiative** — portrait, name, initiative badge and a dice
  button to roll right from the HUD.
- **Active Pokémon nested under its trainer** — always directly below, no matter what
  initiative anyone rolled. Withdrawing one Pokémon and summoning another updates the
  card in place.
- **Wild Pokémon act on their own** — they appear as top-level cards and keep their own
  individual initiative.
- **Initiative rule** — a trainer without an active (summoned) Pokémon cannot roll
  initiative. The rule is enforced for the HUD button *and* Foundry's native tracker
  (per-combatant roll and "Roll All"). GMs can bypass it with a world setting.
- **Native tracker hidden** — the sidebar Combat tab is removed by default; the HUD has
  a GM button to show/hide it for the session.
- **No flicker** — every update is diffed into the live bar instead of re-rendering it.

## Requirements

- Foundry VTT **v14**.
- Optional but recommended: [pokemon-hud-like](https://github.com/MMillones9914/pokemon-hud-like)
  — provides the trainer `hudType` flag and the `summoner` token flag used to detect the
  active Pokémon. Without it, the module falls back to a `pokemon-hud-combat.activePokemon`
  actor flag (the Pokémon's actor id, which must have a token on the current scene).

## Installation

1. In Foundry, open **Add-on Modules → Install Module**.
2. Paste the manifest URL:
   `https://github.com/MMillones9914/pokemon-hud-combat/releases/latest/download/module.json`
3. Enable **Pokémon HUD Combat Tracker** in your world.

## Usage

1. Add trainers and wild Pokémon to a combat as usual.
2. The HUD opens automatically while a combat exists. Roll initiative from a card's dice
   button, or from Foundry's native tracker.
3. Trainers without an active Pokémon show a lock instead of the dice button.
4. GM controls: start combat, previous/next turn, roll all, show/hide the native tracker
   and end combat.
5. `Shift + Alt + C` toggles the bar (configurable in **Configure Controls**).

## Settings

| Setting | Scope | Default | Description |
| --- | --- | --- | --- |
| Enable combat HUD | world | on | Master switch for the bar and the initiative rule. |
| Show automatically | client | on | Open the HUD whenever a combat exists. |
| Hide Foundry's combat tracker | client | on | Remove the native Combat tab from the sidebar. |
| GMs bypass the initiative rule | world | on | Let the GM roll for a trainer without an active Pokémon. |
| Debug logging | client | off | Extra diagnostics in the browser console. |

## API

```js
const api = game.modules.get("pokemon-hud-combat").api;
api.show();
api.hide();
api.toggle();
api.isVisible();
api.getView();                       // ordered groups (trainer + nested Pokémon)
api.canRollInitiative(combatant);    // { allowed, blockedKey }
```

## Development

```bash
npm install
npm run dev     # vite build --watch
npm run test    # lint + typecheck + unit tests + build
```

Node 22 is required. Releases are built by `.github/workflows/release.yml` on a version tag.
