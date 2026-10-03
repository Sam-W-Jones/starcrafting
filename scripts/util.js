import { ETCHING_MASTER, ETCHING_NONE } from "./constants.js";
import { InfusionError, isSchoolEtching } from "./infusion.js";
import { schoolLabel } from "./system.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" };

/** Escape text for HTML. Notifications, tooltips and chat cards all render HTML. */
export function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, c => ESCAPES[c]);
}

export const t = (key, data) => (data ? game.i18n.format(`STARCRAFTING.${key}`, data) : game.i18n.localize(`STARCRAFTING.${key}`));

/** "3rd" (out-of-range levels, which only appear in damaged records, show as the bare number) */
export function ordinal(level) {
  const n = Math.trunc(Number(level));
  return ((n >= 1) && (n <= 9)) ? t(`Ordinal.${n}`) : String(Number.isFinite(n) ? n : "?");
}

/** "3rd level" */
export function levelLabel(level) {
  return t("LevelLabel", { ordinal: ordinal(level) });
}

/** "Abjuration Etching", "Mastercrafted", "No Etching" */
export function etchingName(etching) {
  if ( isSchoolEtching(etching) ) return t("Etching.School.Name", { school: schoolLabel(etching) });
  if ( etching === ETCHING_MASTER ) return t("Etching.mastercrafted.Name");
  return t("Etching.none.Name");
}

/** What the etching does, for the note beneath the rune picker */
export function etchingHint(etching) {
  if ( isSchoolEtching(etching) ) return t("Etching.School.Hint", { school: schoolLabel(etching) });
  if ( etching === ETCHING_MASTER ) return t("Etching.mastercrafted.Hint");
  return t("Etching.none.Hint");
}

/** Whether an etching earns the "superior effects" note */
export function isEtched(etching) {
  return !!etching && (etching !== ETCHING_NONE);
}

/** Tell the user why something failed: a friendly warning for rule breaks, an error for anything else */
export function report(err) {
  if ( err instanceof InfusionError ) {
    const details = Object.fromEntries(Object.entries(err.details ?? {}).map(([k, v]) => [k, esc(v)]));
    ui.notifications.warn(t(`Error.${err.code}`, details));
    return;
  }
  console.error("Starcrafting |", err);
  ui.notifications.error(esc(err?.message ?? String(err)));
}

/** A short local date and time for the chronicle, e.g. "3 Oct, 17:42" */
export function formatWhen(ms) {
  if ( !ms ) return "";
  try {
    return new Date(ms).toLocaleString(game.i18n.lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return new Date(ms).toLocaleString();
  }
}
