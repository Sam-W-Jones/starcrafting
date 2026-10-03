/**
 * Everything that reads or writes dnd5e data lives here, written to work on dnd5e 2.x and 3.x.
 */
import { MODULE_ID, SCHOOL_FALLBACK_LABELS } from "./constants.js";
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

/** Starsteel means the name contains the keyword, unless the GM has switched the check off */
export function isStarsteel(item) {
  if ( !game.settings.get(MODULE_ID, "requireKeyword") ) return true;
  const keyword = String(game.settings.get(MODULE_ID, "keyword") ?? "").trim().toLowerCase();
  if ( !keyword ) return true;
  return String(item?.name ?? "").toLowerCase().includes(keyword);
}

/** dnd5e's Magical property: a Set entry on 3.x items, an object key on 2.x weapons */
export function isMagical(item) {
  const properties = item?.system?.properties;
  if ( !properties ) return false;
  if ( typeof properties.has === "function" ) return properties.has("mgc");
  if ( Array.isArray(properties) ) return properties.includes("mgc");
  return !!properties.mgc;
}

export function starsteelKeyword() {
  return String(game.settings.get(MODULE_ID, "keyword") ?? "").trim();
}

/**
 * A spell can be cast into an item if it is 1st level or higher and is a spell that spends slots
 * and is ready to cast: always prepared, a pact spell, or a prepared spell that is checked as prepared.
 * NPC spells count as prepared, as they do on dnd5e's own sheet.
 */
export function isCastable(spell) {
  if ( spell?.type !== "spell" ) return false;
  if ( toInt(spell.system?.level) < 1 ) return false;
  const mode = spell.system?.preparation?.mode || "prepared";
  const slotModes = CONFIG.DND5E?.spellUpcastModes ?? SLOT_MODES_FALLBACK;
  if ( !slotModes.includes(mode) ) return false;
  if ( mode !== "prepared" ) return true;
  return !!spell.system.preparation?.prepared || (spell.actor?.type === "npc");
}

/** The actor's castable spells, lowest level first, then by name */
export function castableSpells(actor) {
  return (actor?.items?.filter(isCastable) ?? [])
    .sort((a, b) => (toInt(a.system.level) - toInt(b.system.level)) || a.name.localeCompare(b.name, game.i18n.lang));
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
