/**
 * The rules of spell infusion, kept free of Foundry calls so they can be tested on their own.
 * Every function here takes a plain infusion record and returns a new one; nothing is changed in place.
 *
 * An infusion record (stored at flags.starcrafting.infusion on the item):
 * {
 *   v: 1,                       record version
 *   etching: "none",            "none", a school key ("abj", "evo", ...) or "mastercrafted"
 *   status: "infusing",         "infusing" or "complete", always derived from the slots
 *   started: 1700000000000,     when the item entered the crafting log (ms)
 *   completed: null,            when the last slot filled (ms), or null
 *   slots: [{ spell, progress, casts }],   one slot, or two when mastercrafted
 *   history: [{ at, slot, spell, slotLevel, slotKey, value, by, byName }]
 * }
 * A slot's spell is a snapshot: { key, name, img, level, school, uuid }.
 */
import {
  CASTS_PER_LEVEL, DATA_VERSION, ETCHINGS, ETCHING_MASTER, ETCHING_NONE, HISTORY_LIMIT, SCHOOLS
} from "./constants.js";

/** A rule was broken. `code` names which one, so the interface can explain it. */
export class InfusionError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "InfusionError";
    this.code = code;
    this.details = details;
  }
}

const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const toInt = n => Math.trunc(Number(n) || 0);

/** Casts needed to fully infuse a spell of this level. Cantrips (level 0) cannot be infused. */
export function requiredCasts(level) {
  const lvl = toInt(level);
  return lvl > 0 ? lvl * CASTS_PER_LEVEL : 0;
}

/** How many spells an item with this etching can hold */
export function slotCountFor(etching) {
  return etching === ETCHING_MASTER ? 2 : 1;
}

export function isSchoolEtching(etching) {
  return SCHOOLS.includes(etching);
}

/** A school etching doubles casts of its own school; anything else counts normally */
export function etchingMultiplier(etching, school) {
  return isSchoolEtching(etching) && etching === school ? 2 : 1;
}

/**
 * How much progress one cast adds: one, plus one more for each level the slot is above the
 * spell's own level, all doubled when the etching matches the spell's school.
 * Returns 0 when the slot is too low to cast the spell at all.
 */
export function castValue({ spellLevel, slotLevel, etching, school }) {
  const spell = toInt(spellLevel);
  const slot = toInt(slotLevel);
  if ( (spell < 1) || (slot < spell) ) return 0;
  return (1 + slot - spell) * etchingMultiplier(etching, school);
}

/** A stable key for matching a spell by name, e.g. "Melf's Acid Arrow" -> "melf-s-acid-arrow" */
export function spellKey(name) {
  return String(name ?? "").trim().toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

function emptySlot() {
  return { spell: null, progress: 0, casts: 0 };
}

/** A fresh record for an item that has just been placed in the forge */
export function createInfusion({ etching = ETCHING_NONE, now = 0 } = {}) {
  if ( !ETCHINGS.includes(etching) ) etching = ETCHING_NONE;
  return {
    v: DATA_VERSION,
    etching,
    status: "infusing",
    started: now,
    completed: null,
    slots: Array.from({ length: slotCountFor(etching) }, emptySlot),
    history: []
  };
}

/** Tidy a stored spell snapshot, or return null if it cannot be infused */
export function normalizeSpell(raw) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const name = String(raw.name ?? "").trim();
  const level = clamp(toInt(raw.level), 0, 9);
  if ( !name || (level < 1) ) return null;
  return {
    key: raw.key ? String(raw.key) : spellKey(name),
    name,
    img: raw.img ? String(raw.img) : "icons/svg/book.svg",
    level,
    school: String(raw.school ?? ""),
    uuid: raw.uuid ? String(raw.uuid) : null
  };
}

/**
 * One chronicle entry with every field forced to its expected type.
 * Item flags are writable by the item's owner, so stored entries are never trusted as-is.
 */
function normalizeHistoryEntry(h) {
  return {
    at: Number(h.at) || 0,
    slot: clamp(toInt(h.slot), 0, 1),
    spell: String(h.spell ?? ""),
    slotLevel: clamp(toInt(h.slotLevel), 0, 9),
    slotKey: (h.slotKey === "pact") || /^spell[1-9]$/.test(h.slotKey) ? h.slotKey : null,
    value: toInt(h.value),
    progress: toInt(h.progress),
    gm: !!h.gm,
    by: h.by ? String(h.by) : null,
    byName: h.byName ? String(h.byName) : null
  };
}

/** Whether two spell snapshots are the same spell: same name, or the same spell item even if renamed */
export function sameSpell(a, b) {
  if ( !a || !b ) return false;
  return (a.key === b.key) || (!!a.uuid && (a.uuid === b.uuid));
}

/** A bound spell's identity refreshed from the live spell, keeping the level and school it was bound at */
function refreshSnapshot(stored, live) {
  return { ...stored, key: live.key, name: live.name, img: live.img, uuid: live.uuid ?? stored.uuid };
}

/**
 * Bring any stored record (possibly old, hand-edited or partial) into the current shape.
 * Returns null when there is no record at all.
 */
export function normalizeInfusion(raw) {
  if ( !raw || (typeof raw !== "object") ) return null;
  const etching = ETCHINGS.includes(raw.etching) ? raw.etching : ETCHING_NONE;
  const slots = [];
  for ( let i = 0; i < slotCountFor(etching); i++ ) {
    const stored = Array.isArray(raw.slots) ? raw.slots[i] : null;
    const spell = normalizeSpell(stored?.spell);
    if ( !spell ) {
      slots.push(emptySlot());
      continue;
    }
    slots.push({
      spell,
      progress: clamp(toInt(stored.progress), 0, requiredCasts(spell.level)),
      casts: Math.max(0, toInt(stored.casts))
    });
  }
  const history = Array.isArray(raw.history)
    ? raw.history.filter(h => h && (typeof h === "object")).slice(-HISTORY_LIMIT).map(normalizeHistoryEntry)
    : [];
  const data = {
    v: DATA_VERSION,
    etching,
    status: "infusing",
    started: Number(raw.started) || 0,
    completed: Number(raw.completed) || null,
    slots,
    history
  };
  return withStatus(data, data.completed);
}

/** Set status from the slots, stamping or clearing the completion time to match */
function withStatus(data, now) {
  const complete = isComplete(data);
  data.status = complete ? "complete" : "infusing";
  data.completed = complete ? (data.completed || now || null) : null;
  return data;
}

/** Every slot holds a spell and every one of them is full */
export function isComplete(data) {
  if ( !data?.slots?.length ) return false;
  return data.slots.every(s => s.spell && (s.progress >= requiredCasts(s.spell.level)));
}

/** The etching is set in stone once any cast has gone into the item */
export function isLocked(data) {
  return !!data?.slots?.some(s => (s.progress > 0) || (s.casts > 0));
}

/** Progress figures for one slot, ready for a progress bar */
export function slotProgress(slot) {
  const required = slot?.spell ? requiredCasts(slot.spell.level) : 0;
  const progress = slot?.spell ? clamp(toInt(slot.progress), 0, required) : 0;
  const pct = required ? Math.round((progress / required) * 1000) / 10 : 0;
  return { required, progress, remaining: required - progress, pct, complete: !!required && (progress >= required) };
}

/** Overall progress across every slot, for the log's summary */
export function overallProgress(data) {
  let required = 0;
  let progress = 0;
  for ( const slot of data?.slots ?? [] ) {
    const p = slotProgress(slot);
    required += p.required;
    progress += p.progress;
  }
  return { required, progress, pct: required ? Math.round((progress / required) * 1000) / 10 : 0 };
}

/**
 * Choose a new etching. Allowed until the first cast; after that only with `force` (the GM).
 * Moving away from mastercrafted drops the second slot.
 */
export function setEtching(data, etching, { force = false } = {}) {
  if ( !ETCHINGS.includes(etching) ) throw new InfusionError("unknownEtching", { etching });
  if ( isLocked(data) && !force ) throw new InfusionError("etchingLocked");
  const next = structuredClone(data);
  next.etching = etching;
  const count = slotCountFor(etching);
  while ( next.slots.length < count ) next.slots.push(emptySlot());
  next.slots.length = count;
  return withStatus(next, next.completed);
}

/**
 * Tie a spell to a slot without casting it. A slot already holding casts of a different spell
 * cannot be rebound, and a mastercrafted item cannot hold the same spell twice.
 */
export function bindSpell(data, index, rawSpell) {
  const spell = normalizeSpell(rawSpell);
  if ( !spell ) throw new InfusionError("cantripOrInvalid");
  const slot = data.slots[index];
  if ( !slot ) throw new InfusionError("noSuchSlot", { index });
  const elsewhere = data.slots.findIndex((s, i) => (i !== index) && sameSpell(s.spell, spell));
  if ( elsewhere >= 0 ) throw new InfusionError("alreadyBound", { spell: spell.name });
  const keep = sameSpell(slot.spell, spell);
  const hasCasts = (slot.progress > 0) || (slot.casts > 0);
  if ( slot.spell && !keep && hasCasts ) throw new InfusionError("slotLocked", { spell: slot.spell.name });
  const next = structuredClone(data);
  next.slots[index] = keep && hasCasts
    ? { spell: refreshSnapshot(slot.spell, spell), progress: slot.progress, casts: slot.casts }
    : { spell, progress: 0, casts: 0 };
  return withStatus(next, next.completed);
}

/** Empty a slot. A slot with casts in it can only be emptied with `force` (the GM). */
export function unbindSpell(data, index, { force = false } = {}) {
  const slot = data.slots[index];
  if ( !slot ) throw new InfusionError("noSuchSlot", { index });
  if ( ((slot.progress > 0) || (slot.casts > 0)) && !force ) throw new InfusionError("slotLocked", { spell: slot.spell?.name });
  const next = structuredClone(data);
  next.slots[index] = emptySlot();
  return withStatus(next, next.completed);
}

/**
 * Which slot a cast of this spell would go into.
 * @param {object} data
 * @param {object|string} spell   The spell's snapshot, or just its key
 * @returns {{index: number, bind?: boolean, reason?: string}}  bind means the spell will be tied to an
 *   empty slot; index -1 comes with the reason it cannot go anywhere
 */
export function findTargetSlot(data, spell) {
  const snap = (typeof spell === "string") ? { key: spell } : spell;
  const bound = data.slots.findIndex(s => sameSpell(s.spell, snap));
  if ( bound >= 0 ) {
    if ( slotProgress(data.slots[bound]).complete ) return { index: -1, reason: "slotComplete", slot: bound };
    return { index: bound, bind: false };
  }
  const empty = data.slots.findIndex(s => !s.spell);
  if ( empty >= 0 ) return { index: empty, bind: true };
  return { index: -1, reason: "slotsOccupied" };
}

/**
 * Record one cast. Binds the spell to the slot first if the slot is empty.
 * Progress never goes past what the slot needs; any excess from the final cast is lost.
 * @returns {{data: object, value: number, gained: number, slotComplete: boolean, itemComplete: boolean}}
 */
export function applyCast(data, { index, spell: rawSpell, slotLevel, slotKey = null, now = 0, by = null, byName = null }) {
  if ( data.status === "complete" ) throw new InfusionError("itemComplete");
  const spell = normalizeSpell(rawSpell);
  if ( !spell ) throw new InfusionError("cantripOrInvalid");
  let next = data.slots[index]?.spell ? structuredClone(data) : bindSpell(data, index, spell);
  const slot = next.slots[index];
  if ( !slot ) throw new InfusionError("noSuchSlot", { index });
  if ( !sameSpell(slot.spell, spell) ) throw new InfusionError("slotLocked", { spell: slot.spell.name });
  slot.spell = refreshSnapshot(slot.spell, spell);

  const required = requiredCasts(slot.spell.level);
  if ( slot.progress >= required ) throw new InfusionError("slotComplete");
  const value = castValue({ spellLevel: slot.spell.level, slotLevel, etching: next.etching, school: slot.spell.school });
  if ( value <= 0 ) throw new InfusionError("slotTooLow", { level: slot.spell.level });

  const gained = Math.min(value, required - slot.progress);
  slot.progress += gained;
  slot.casts += 1;
  next.history.push({ at: now, slot: index, spell: slot.spell.name, slotLevel: toInt(slotLevel), slotKey, value: gained, by, byName });
  if ( next.history.length > HISTORY_LIMIT ) next.history = next.history.slice(-HISTORY_LIMIT);

  next = withStatus(next, now);
  return {
    data: next,
    value,
    gained,
    slotComplete: slot.progress >= required,
    itemComplete: next.status === "complete"
  };
}

/**
 * GM tool: set a slot's progress directly (clamped to what the spell needs).
 * The change is written to the chronicle when it actually moves the progress.
 */
export function setProgress(data, index, progress, { now = 0, by = null, byName = null } = {}) {
  const slot = data.slots[index];
  if ( !slot?.spell ) throw new InfusionError("noSuchSlot", { index });
  const next = structuredClone(data);
  const value = clamp(toInt(progress), 0, requiredCasts(slot.spell.level));
  if ( value !== slot.progress ) {
    next.history.push({ at: now, slot: index, spell: slot.spell.name, gm: true, progress: value, value: value - slot.progress, by, byName });
    if ( next.history.length > HISTORY_LIMIT ) next.history = next.history.slice(-HISTORY_LIMIT);
  }
  next.slots[index].progress = value;
  return withStatus(next, now);
}
