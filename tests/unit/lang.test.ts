import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The language files are copied verbatim into `dist/lang/` and loaded by
 * Foundry at boot. A single malformed byte (a trailing comma, a missing
 * quote) makes Foundry silently drop the whole file: every label then falls
 * back to its raw key, which is what the settings panel and the VS screen
 * showed ("pokemon-hud-combat.battleIntro.skip" instead of "Omitir").
 *
 * These tests guard both files: they must parse, and they must expose exactly
 * the same key set so no translation is silently missing.
 */

interface LangTree {
  [key: string]: string | LangTree;
}

function readLang(name: string): LangTree {
  const path = new URL(`../../src/lang/${name}`, import.meta.url);
  return JSON.parse(readFileSync(path, "utf8")) as LangTree;
}

/** Flatten a nested language tree into dotted keys. */
function flatKeys(tree: LangTree, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") out.push(...flatKeys(value, path));
    else out.push(path);
  }
  return out;
}

describe("language files", () => {
  it("es.json is valid JSON", () => {
    expect(() => readLang("es.json")).not.toThrow();
  });

  it("en.json is valid JSON", () => {
    expect(() => readLang("en.json")).not.toThrow();
  });

  it("both files expose the same keys", () => {
    const es = flatKeys(readLang("es.json")["pokemon-hud-combat"] as LangTree);
    const en = flatKeys(readLang("en.json")["pokemon-hud-combat"] as LangTree);
    expect([...es].sort()).toEqual([...en].sort());
  });

  it("ships the labels the battle intro screen needs", () => {
    const en = readLang("en.json")["pokemon-hud-combat"] as LangTree;
    const intro = en.battleIntro as LangTree;
    for (const key of [
      "title",
      "encounterKind",
      "encounterName",
      "encounterNamePlaceholder",
      "start",
      "skip",
      "skipHint"
    ]) {
      expect(typeof intro[key], `battleIntro.${key}`).toBe("string");
      expect((intro[key] as string).length).toBeGreaterThan(0);
    }
  });

  it("ships a label for every registered setting", () => {
    const es = readLang("es.json")["pokemon-hud-combat"] as LangTree;
    const settings = es.settings as LangTree;
    for (const key of [
      "enabled",
      "autoShow",
      "hideNativeTracker",
      "gmBypass",
      "debug",
      "imageSource",
      "tokenSize",
      "battleIntro",
      "playerTeamName"
    ]) {
      const entry = settings[key] as LangTree | undefined;
      expect(entry, `settings.${key}`).toBeTruthy();
      expect(typeof entry?.name).toBe("string");
      expect(typeof entry?.hint).toBe("string");
    }
  });
});
