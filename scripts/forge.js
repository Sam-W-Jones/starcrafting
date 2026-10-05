/**
 * The crafting actions: each one checks the rules, writes the item's infusion record and posts any chat cards.
 * Infusion records live on the item itself (flags.starcrafting.infusion), so progress travels with the item.
 */
import { FLAG, MODULE_ID } from "./constants.js";
import {
  InfusionError, applyCast, bindSpell, createInfusion, findTargetSlot, isLocked, normalizeInfusion,
  setEtching, setProgress, unbindSpell
} from "./infusion.js";
import { postCastCard, postCompleteCard } from "./chat.js";
import {
  isCastable, isMagical, isPhysicalItem, refundSlot, slotPools, spellSnapshot, spendSlot
} from "./system.js";

/**
 * Crafters with a write in flight. Foundry updates are not optimistic: until the server answers,
 * the actor still shows the old slot count and the item the old record. So while one cast or edit
 * is saving, any other cast or edit for the same crafter would work from stale data.
 * The lock covers only the writes themselves, never the chat cards that follow.
 */
const busy = new Set();

function lockKey(document) {
  return document?.actor?.uuid ?? document?.uuid;
}

/** Run a record write while holding its crafter's lock, reading the record only once the lock is held */
async function withLock(document, write) {
  const key = lockKey(document);
  if ( busy.has(key) ) throw new InfusionError("busy");
  busy.add(key);
  try {
    return await write();
  } finally {
    busy.delete(key);
  }
}

/** The item's infusion record, tidied, or null if it has none */
export function getInfusion(item) {
  return normalizeInfusion(item?.flags?.[MODULE_ID]?.[FLAG]);
}

export function hasInfusion(item) {
  return !!item?.flags?.[MODULE_ID]?.[FLAG];
}

/** Every item in the actor's inventory that is in the crafting log */
export function loggedItems(actor) {
  return actor?.items?.filter(hasInfusion) ?? [];
}

/**
 * Write a whole infusion record. Every key is always present and slots/history are arrays
 * (which Foundry replaces wholesale), so a single update fully replaces the old record.
 */
function save(item, data) {
  return item.update({ [`flags.${MODULE_ID}.${FLAG}`]: data });
}

function requireOwner(document) {
  if ( !document?.isOwner ) throw new InfusionError("noPermission");
}

function requireGM() {
  if ( !game.user.isGM ) throw new InfusionError("gmOnly");
}

function requireRecord(item) {
  const data = getInfusion(item);
  if ( !data ) throw new InfusionError("noItemSelected");
  return data;
}

/** Both documents belong to the same actor (works for unlinked token actors too) */
function sameActor(a, b) {
  return !!a && !!b && ((a === b) || (a.uuid === b.uuid));
}

/**
 * Place an item in the Starforge. An item already in the log is simply returned.
 * @returns {Promise<{item: Item, added: boolean}>}
 */
export async function addItem(actor, item) {
  if ( !sameActor(item?.parent, actor) ) throw new InfusionError("notOwned", { actor: actor.name });
  requireOwner(item);
  if ( hasInfusion(item) ) return { item, added: false };
  if ( !isPhysicalItem(item) ) throw new InfusionError("notPhysical");
  if ( game.settings.get(MODULE_ID, "requireMundane") && isMagical(item) ) {
    throw new InfusionError("notUnenchanted", { item: item.name });
  }
  await save(item, createInfusion({ now: Date.now() }));
  return { item, added: true };
}

/** Choose an etching. The GM can pass force to change it after casts have been made. */
export async function chooseEtching(item, etching, { force = false } = {}) {
  requireOwner(item);
  if ( force ) requireGM();
  return withLock(item, async () => {
    const data = requireRecord(item);
    if ( data.etching === etching ) return data;
    const next = setEtching(data, etching, { force });
    await save(item, next);
    return next;
  });
}

/** Tie one of the actor's castable spells to a slot without casting it */
export async function bindSpellToSlot(actor, item, index, spell) {
  requireOwner(item);
  if ( !sameActor(spell?.parent, actor) ) throw new InfusionError("notYourSpell", { actor: actor.name });
  if ( !isCastable(spell) ) {
    if ( Number(spell.system?.level) < 1 ) throw new InfusionError("cantripOrInvalid");
    throw new InfusionError("notPrepared", { spell: spell.name });
  }
  return withLock(item, async () => {
    const data = requireRecord(item);
    if ( data.status === "complete" ) throw new InfusionError("itemComplete");
    const next = bindSpell(data, index, spellSnapshot(spell));
    await save(item, next);
    return next;
  });
}

/** Empty a slot. Only the GM can empty a slot that already holds casts. */
export async function unbindSlot(item, index) {
  requireOwner(item);
  return withLock(item, async () => {
    const next = unbindSpell(requireRecord(item), index, { force: game.user.isGM });
    await save(item, next);
    return next;
  });
}

/**
 * What a cast would do, without doing it: which slot it lands in, which pool it spends, and the new record.
 * Throws an InfusionError if the cast isn't allowed.
 */
export function previewCast(actor, item, spell, slotKey) {
  if ( !sameActor(spell?.parent, actor) ) throw new InfusionError("notYourSpell", { actor: actor.name });
  if ( !isCastable(spell) ) throw new InfusionError("notPrepared", { spell: spell.name });
  const data = requireRecord(item);
  if ( data.status === "complete" ) throw new InfusionError("itemComplete");
  const pool = slotPools(actor).find(p => p.key === slotKey);
  if ( !pool || (pool.value <= 0) ) throw new InfusionError("noSlotLeft");
  const snapshot = spellSnapshot(spell);
  const target = findTargetSlot(data, snapshot);
  if ( target.index < 0 ) throw new InfusionError(target.reason, { spell: spell.name });
  const result = applyCast(data, {
    index: target.index,
    spell: snapshot,
    slotLevel: pool.level,
    slotKey,
    now: Date.now(),
    by: game.user.id,
    byName: actor.name
  });
  return { ...result, index: target.index, pool, snapshot };
}

/**
 * Cast a spell into an item: spend the slot, record the progress, post the chat cards.
 * If the record can't be saved, the slot is refunded. Returns null, doing nothing, when another
 * cast or edit for this crafter is still saving (a double-click, say).
 */
export async function castInto(actor, item, spell, slotKey) {
  requireOwner(actor);
  requireOwner(item);
  const key = actor.uuid;
  if ( busy.has(key) ) return null;
  busy.add(key);
  let cast;
  try {
    cast = previewCast(actor, item, spell, slotKey);
    await spendSlot(actor, slotKey);
    // A cast always changes the record, so an update that resolves to nothing was rejected
    let saved = null;
    try {
      saved = await save(item, cast.data);
    } finally {
      if ( !saved ) await refundSlot(actor, slotKey);
    }
    if ( !saved ) throw new InfusionError("noPermission");
  } finally {
    // Release before the chat round trips, so the re-render the save triggered shows the buttons ready
    busy.delete(key);
  }
  await postCastCard({ actor, item, data: cast.data, index: cast.index, pool: cast.pool, gained: cast.gained });
  if ( cast.itemComplete ) await postCompleteCard({ actor, item, data: cast.data });
  return cast;
}

/** Whether a cast for this crafter is still saving */
export function isCasting(actor) {
  return busy.has(actor?.uuid);
}

/** Take an item out of the log. Players can only do this before the first cast; the GM always can. */
export async function removeFromLog(item) {
  requireOwner(item);
  return withLock(item, () => {
    const data = getInfusion(item);
    if ( !game.user.isGM && data && (isLocked(data) || (data.status === "complete")) ) throw new InfusionError("gmOnly");
    return item.unsetFlag(MODULE_ID, FLAG);
  });
}

/**
 * GM tool: set every slot's progress at once.
 * @param {Actor} actor
 * @param {Item} item
 * @param {number[]} values   New progress for each slot, by index; NaN leaves a slot as it is
 */
export async function setAllProgress(actor, item, values) {
  requireGM();
  const { before, data } = await withLock(item, async () => {
    const before = requireRecord(item);
    let data = before;
    values.forEach((value, index) => {
      if ( data.slots[index]?.spell && Number.isFinite(value) ) {
        data = setProgress(data, index, value, { now: Date.now(), by: game.user.id, byName: game.user.name });
      }
    });
    if ( data !== before ) await save(item, data);
    return { before, data };
  });
  if ( (data.status === "complete") && (before.status !== "complete") ) await postCompleteCard({ actor, item, data });
  return data;
}
