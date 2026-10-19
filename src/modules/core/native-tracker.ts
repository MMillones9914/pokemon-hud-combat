import { getSettings } from "./settings";

/** Body class consumed by the SCSS to hide Foundry's own Combat Tracker tab. */
const HIDDEN_CLASS = "phc-native-hidden";

/** Apply the persisted (or a session-only) native tracker visibility. */
export function applyNativeTrackerVisibility(hidden?: boolean): void {
  try {
    const settings = getSettings();
    const value =
      typeof hidden === "boolean" ? hidden : settings.enabled && settings.hideNativeTracker;
    document.body.classList.toggle(HIDDEN_CLASS, value);
  } catch {
    /* the HUD must never break on document access */
  }
}

export function isNativeTrackerHidden(): boolean {
  return document.body.classList.contains(HIDDEN_CLASS);
}

/** Flip the tracker for this session (the setting is untouched); returns the new state. */
export function toggleNativeTracker(): boolean {
  const hidden = !isNativeTrackerHidden();
  applyNativeTrackerVisibility(hidden);
  return hidden;
}
