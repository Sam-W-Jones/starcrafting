/**
 * Everything that reads or writes dnd5e data lives here, written to work on dnd5e 2.x and 3.x.
 */
import { KNOWN_CASTERS_DEFAULT, MODULE_ID, SCHOOL_FALLBACK_LABELS } from "./constants.js";
import { InfusionError, spellKey } from "./infusion.js";

/** Preparation modes that spend spell slots, if the system doesn't say */
const SLOT_MODES_FALLBACK = ["always", "pact", "prepared"];

const toInt = n => parseInt(n) || 0;
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);

/**
 * The localized name of a spell school. dnd5e 3.x stores {label, icon, ...} per school, 2.x a plain string.
 * Never stringify a 3.x entry: its toString() logs a deprecation warning.
 */
export function schoolLabel(key) {
  const entry = CONFIG.DND5E?.spellSchools?.[key];
  const label = (entry && (typeof entry === "object")) ? entry.label : entry;
  if ( (typeof label === "string") && label ) return game.i18n.localize(label);
  return SCHOOL_FALLBACK_LABELS[key] ?? (key || "");
}

/** dnd5e's own heading for a spell level, e.g. "3rd Level" */
export function spellLevelHeading(level) {
  const label = CONFIG.DND5E?.spellLevels?.[level];
  return (typeof label === "string") ? game.i18n.localize(label) : String(level);
}

/** Actors that have spell slots can use the Starforge */
export function canCraft(actor) {
  return !!actor && ["character", "npc"].includes(actor.type) && !!actor.system?.spells;
}

/** Weapons, armour, gear, loot, containers... anything with a quantity */
export function isPhysicalItem(item) {
  return !!item?.system && (item.type !== "spell") && ("quantity" in item.system);
}

/** dnd5e's Magical property: a Set entry on 3.x items, an object key on 2.x weapons */
export function isMagical(item) {
  const properties = item?.system?.properties;
  if ( !properties ) return false;
  if ( typeof properties.has === "function" ) return properties.has("mgc");
  if ( Array.isArray(properties) ) return properties.includes("mgc");
  return !!properties.mgc;
}

/**
 * Whether spells of this preparation mode are cast with spell slots.
 * dnd5e 3.1+ flags each mode with `upcast`; 3.0 and 2.x list the slot modes in spellUpcastModes.
 */
export function usesSlots(mode) {
  const config = CONFIG.DND5E?.spellPreparationModes?.[mode];
  if ( config && (typeof config === "object") && ("upcast" in config) ) return !!config.upcast;
  return (CONFIG.DND5E?.spellUpcastModes ?? SLOT_MODES_FALLBACK).includes(mode);
}

/** "Eldritch Knight" -> "eldritch-knight", matching how dnd5e derives identifiers from names */
function slug(text) {
  return String(text ?? "").trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
}

/** Classes and subclasses the GM has listed as knowing their spells rather than preparing them */
export function knownCasterIdentifiers() {
  let raw = KNOWN_CASTERS_DEFAULT;
  try {
    raw = game.settings.get(MODULE_ID, "knownCasters");
  } catch {
    // Not registered yet (e.g. during startup): use the default list
  }
  return new Set(String(raw ?? "").split(",").map(slug).filter(Boolean));
}

/** Whether a class or subclass tracks spells known, as dnd5e's SRD sorcerer and warlock do with a "spells-known" scale */
function tracksSpellsKnown(item) {
  const advancement = item?.system?.advancement;
  const list = Array.isArray(advancement) ? advancement : Object.values(advancement ?? {});
  return list.some(a => (a?.type === "ScaleValue")
    && (slug(a.configuration?.identifier || a.identifier || a.title) === "spells-known"));
}

/** The actor's spellcasting classes: the names each answers to, and whether it tracks spells known */
function spellcastingClasses(actor) {
  const casters = [];
  for ( const cls of Object.values(actor?.classes ?? {}) ) {
    const subclass = cls.subclass ?? null;
    const progression = cls.spellcasting?.progression
      ?? subclass?.system?.spellcasting?.progression ?? cls.system?.spellcasting?.progression;
    if ( !progression || (progression === "none") ) continue;
    const id = slug(cls.identifier || cls.system?.identifier || cls.name);
    const names = [id, cls.name, subclass?.identifier, subclass?.system?.identifier, subclass?.name].map(slug).filter(Boolean);
    casters.push({ id, names, tracksKnown: tracksSpellsKnown(cls) || tracksSpellsKnown(subclass) });
  }
  return casters;
}

/**
 * A spell counts as known (so needs no "prepared" tick) when it comes from a known-spell caster: one the GM
 * has listed (by identifier or name), or one whose class or subclass tracks spells known.
 * dnd5e 3.3+ can record a spell's class; a spell without one counts only if every spellcasting class
 * the actor has knows its spells, so a multiclass sorcerer/wizard still ticks spells as prepared.
 */
export function isKnownSpell(spell) {
  const casters = spellcastingClasses(spell?.actor);
  if ( !casters.length ) return false;
  const known = knownCasterIdentifiers();
  const isKnownCaster = c => c.tracksKnown || c.names.some(name => known.has(name));
  const source = slug(spell.system?.sourceClass);
  if ( source ) {
    const caster = casters.find(c => c.id === source);
    if ( caster ) return isKnownCaster(caster);
  }
  return casters.every(isKnownCaster);
}

/**
 * Whether a spell can be cast into an item, and if not, why not.
 * Castable means 1st level or higher, cast with spell slots, and ready to cast: always prepared,
 * a pact spell, ticked as prepared, from a known-spell caster, or an NPC's (as on dnd5e's own sheet).
 * @returns {{castable: boolean, reason: string|null}}  reason: "cantrip", "noSlots" or "notPrepared"
 */
export function spellStatus(spell) {
  if ( (spell?.type !== "spell") || (toInt(spell.system?.level) < 1) ) return { castable: false, reason: "cantrip" };
  const mode = spell.system?.preparation?.mode || "prepared";
  if ( !usesSlots(mode) ) return { castable: false, reason: "noSlots" };
  if ( mode !== "prepared" ) return { castable: true, reason: null };
  if ( spell.system.preparation?.prepared || (spell.actor?.type === "npc") || isKnownSpell(spell) ) {
    return { castable: true, reason: null };
  }
  return { castable: false, reason: "notPrepared" };
}

export function isCastable(spell) {
  return spellStatus(spell).castable;
}

/**
 * Every spell of 1st level or higher, castable or not, each with its status:
 * lowest level first, castable spells before the rest, then by name.
 */
export function spellbookSpells(actor) {
  const spells = (actor?.items?.filter(i => (i.type === "spell") && (toInt(i.system?.level) >= 1)) ?? [])
    .map(spell => ({ spell, status: spellStatus(spell) }));
  return spells.sort((a, b) => (toInt(a.spell.system.level) - toInt(b.spell.system.level))
    || (Number(b.status.castable) - Number(a.status.castable))
    || a.spell.name.localeCompare(b.spell.name, game.i18n.lang));
}

/** The details of a spell that an infusion remembers */
export function spellSnapshot(spell) {
  return {
    key: spellKey(spell.name),
    name: spell.name,
    img: spell.img,
    level: toInt(spell.system.level),
    school: spell.system.school ?? "",
    uuid: spell.uuid
  };
}

/**
 * Every pool of spell slots the actor has, lowest level first, with the pact pool last.
 * Mirrors how dnd5e itself offers slots: a pool counts only if it has a maximum above zero.
 * @returns {{key: string, level: number, value: number, max: number, pact: boolean}[]}
 */
export function slotPools(actor) {
  const spells = actor?.system?.spells;
  if ( !spells ) return [];
  const pools = [];
  for ( let level = 1; level <= 9; level++ ) {
    const slot = spells[`spell${level}`];
    if ( !slot ) continue;
    const max = toInt(slot.override || slot.max || 0);
    if ( max <= 0 ) continue;
    pools.push({ key: `spell${level}`, level, value: clamp(toInt(slot.value), 0, max), max, pact: false });
  }
  const pact = spells.pact;
  if ( pact ) {
    const max = toInt(pact.override || pact.max || 0);
    const level = toInt(pact.level);
    if ( (max > 0) && (level > 0) ) pools.push({ key: "pact", level, value: clamp(toInt(pact.value), 0, max), max, pact: true });
  }
  return pools;
}

/**
 * Spend one slot from a pool, as dnd5e does when a spell is cast.
 * update() resolves to undefined when the change was rejected, so that counts as no slot spent.
 */
export async function spendSlot(actor, key) {
  const value = toInt(actor.system.spells?.[key]?.value);
  if ( value <= 0 ) throw new InfusionError("noSlotLeft");
  const updated = await actor.update({ [`system.spells.${key}.value`]: Math.max(value - 1, 0) });
  if ( !updated ) throw new InfusionError("noSlotLeft");
}

/** Give back a slot spent on a cast that could not be recorded */
export async function refundSlot(actor, key) {
  const value = toInt(actor.system.spells?.[key]?.value);
  await actor.update({ [`system.spells.${key}.value`]: value + 1 });
}
