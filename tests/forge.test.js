// Integration tests for scripts/forge.js with mocked documents
import assert from "node:assert/strict";

const settings = { requireMundane: true, castChat: "public", completeChat: "public" };
const chat = [];
globalThis.game = {
  users: [{ id: "u1", isGM: false }, { id: "p2", isGM: false }, { id: "gm", isGM: true }],
  settings: { get: (ns, k) => settings[k] },
  i18n: { lang: "en", localize: k => k, format: (k, d) => `${k}:${JSON.stringify(d)}` },
  user: { id: "u1", name: "Sam", isGM: false }
};
globalThis.CONFIG = { DND5E: { spellSchools: {}, spellLevels: {}, spellUpcastModes: ["always", "pact", "prepared"] } };
globalThis.CONST = { CHAT_MESSAGE_TYPES: { OTHER: 0 } };
globalThis.ChatMessage = { create: async d => { chat.push(d); return d; }, getSpeaker: () => ({}), getWhisperRecipients: () => [{ id: "gm" }] };
let lastRender = null;
globalThis.renderTemplate = async (path, data) => { lastRender = data; return `${path}`; };

const F = await import("../scripts/forge.js");
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error("FAIL", name, "\n", e); process.exitCode = 1; } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function setProp(obj, path, value) {
  const parts = path.split("."); let o = obj;
  for ( const p of parts.slice(0, -1) ) o = (o[p] ??= {});
  o[parts.at(-1)] = structuredClone(value);
}
function makeActor({ owner = true, slots = { spell1: 3, spell3: 1 } } = {}) {
  const actor = { uuid: "Actor.a", name: "Aria", type: "character", isOwner: owner, testUserPermission: (u) => ["u1", "p2"].includes(u.id), items: new Map(), system: { spells: {} }, failNextItemUpdate: false };
  for ( let l = 1; l <= 9; l++ ) actor.system.spells[`spell${l}`] = { value: slots[`spell${l}`] ?? 0, max: slots[`spell${l}`] ?? 0, override: null };
  actor.system.spells.pact = { value: 0, max: 0, level: 0 };
  actor.update = async u => { await wait(10); for ( const [k, v] of Object.entries(u) ) setProp(actor, k, v); return actor; };
  actor.items.filter = fn => Array.from(actor.items.values()).filter(fn);
  return actor;
}
function addItem(actor, data) {
  const item = { flags: {}, ...data, uuid: `${actor.uuid}.Item.${data.id}` };
  Object.defineProperty(item, "parent", { value: actor });
  Object.defineProperty(item, "actor", { value: actor });
  Object.defineProperty(item, "isOwner", { get: () => actor.isOwner });
  item.update = async u => {
    await wait(10);
    if ( actor.failNextItemUpdate ) { actor.failNextItemUpdate = false; return undefined; }
    for ( const [k, v] of Object.entries(u) ) setProp(item, k, v);
    return item;
  };
  item.unsetFlag = async (scope, key) => { delete item.flags[scope]?.[key]; return item; };
  actor.items.set(item.id, item);
  return item;
}

const actor = makeActor();
const sword = addItem(actor, { id: "sword", name: "Starsteel Sword", type: "weapon", system: { quantity: 1 } });
const dagger = addItem(actor, { id: "dagger", name: "Iron Dagger", type: "weapon", system: { quantity: 1 } });
const shield = addItem(actor, { id: "shield", name: "Shield", type: "spell", img: "s.png", system: { level: 1, school: "abj", preparation: { mode: "prepared", prepared: true } } });
const fireball = addItem(actor, { id: "fireball", name: "Fireball", type: "spell", img: "f.png", system: { level: 3, school: "evo", preparation: { mode: "prepared", prepared: true } } });

await t("add starsteel", async () => { const r = await F.addItem(actor, sword); assert.equal(r.added, true); assert.ok(F.getInfusion(sword)); });
await t("add again returns existing", async () => { const r = await F.addItem(actor, sword); assert.equal(r.added, false); });
await t("any physical item can be placed, whatever its name", async () => {
  const staff = addItem(actor, { id: "staff", name: "Yew Quarterstaff", type: "weapon", system: { quantity: 1 } });
  assert.equal((await F.addItem(actor, staff)).added, true);
  assert.equal((await F.addItem(actor, dagger)).added, true);
});
await t("reject spell as item", async () => { await assert.rejects(F.addItem(actor, shield), e => e.code === "notPhysical"); });
await t("reject other actor's item", async () => {
  const other = makeActor(); other.uuid = "Actor.b";
  const theirs = addItem(other, { id: "x", name: "Starsteel Axe", type: "weapon", system: { quantity: 1 } });
  await assert.rejects(F.addItem(actor, theirs), e => e.code === "notOwned");
});

await t("etching then cast doubles", async () => {
  await F.chooseEtching(sword, "abj");
  const cast = await F.castInto(actor, sword, shield, "spell1");
  assert.equal(cast.gained, 2); assert.equal(actor.system.spells.spell1.value, 2);
  assert.equal(F.getInfusion(sword).slots[0].progress, 2); assert.equal(chat.length, 1);
});
await t("etching locked for player", async () => { await assert.rejects(F.chooseEtching(sword, "evo"), e => e.code === "etchingLocked"); });
await t("force needs GM", async () => { await assert.rejects(F.chooseEtching(sword, "evo", { force: true }), e => e.code === "gmOnly"); });

await t("double click spends one slot and counts one cast", async () => {
  const before = actor.system.spells.spell1.value;
  const [a, b] = await Promise.all([F.castInto(actor, sword, shield, "spell1"), F.castInto(actor, sword, shield, "spell1")]);
  assert.ok(a); assert.equal(b, null);
  assert.equal(actor.system.spells.spell1.value, before - 1);
  assert.equal(F.getInfusion(sword).slots[0].casts, 2);
});
await t("wrong spell rejected without spending", async () => {
  const before = actor.system.spells.spell3.value;
  await assert.rejects(F.castInto(actor, sword, fireball, "spell3"), e => e.code === "slotsOccupied");
  assert.equal(actor.system.spells.spell3.value, before);
});
await t("refund when save rejected", async () => {
  const before = actor.system.spells.spell1.value;
  const progress = F.getInfusion(sword).slots[0].progress;
  actor.failNextItemUpdate = true;
  await assert.rejects(F.castInto(actor, sword, shield, "spell1"), e => e.code === "noPermission");
  assert.equal(actor.system.spells.spell1.value, before);
  assert.equal(F.getInfusion(sword).slots[0].progress, progress);
});
await t("no slot left", async () => {
  actor.system.spells.spell1.value = 0;
  await assert.rejects(F.castInto(actor, sword, shield, "spell1"), e => e.code === "noSlotLeft");
  actor.system.spells.spell1.value = 3;
});
await t("unprepared spell rejected", async () => {
  shield.system.preparation.prepared = false;
  await assert.rejects(F.castInto(actor, sword, shield, "spell1"), e => e.code === "notPrepared");
  shield.system.preparation.prepared = true;
});
await t("player cannot unbind cast slot or remove locked item", async () => {
  await assert.rejects(F.unbindSlot(sword, 0), e => e.code === "slotLocked");
  await assert.rejects(F.removeFromLog(sword), e => e.code === "gmOnly");
});
await t("non-owner cannot cast", async () => {
  actor.isOwner = false;
  await assert.rejects(F.castInto(actor, sword, shield, "spell1"), e => e.code === "noPermission");
  actor.isOwner = true;
});
await t("GM sets progress -> complete card", async () => {
  game.user.isGM = true;
  const cards = chat.length;
  await F.setAllProgress(actor, sword, [15]);
  assert.equal(F.getInfusion(sword).status, "complete");
  assert.equal(chat.length, cards + 1);
  assert.equal(chat.at(-1).flags.starcrafting.card, "complete");
  await assert.rejects(F.castInto(actor, sword, shield, "spell1"), e => e.code === "itemComplete");
  game.user.isGM = false;
});
await t("finishing cast posts both cards", async () => {
  const circlet = addItem(actor, { id: "circlet", name: "Starsteel Circlet", type: "equipment", system: { quantity: 1 } });
  await F.addItem(actor, circlet);
  game.user.isGM = true; await F.bindSpellToSlot(actor, circlet, 0, shield); await F.setAllProgress(actor, circlet, [14]); game.user.isGM = false;
  const cards = chat.length;
  const cast = await F.castInto(actor, circlet, shield, "spell3");
  assert.equal(cast.value, 3); assert.equal(cast.gained, 1); assert.equal(cast.itemComplete, true);
  assert.equal(chat.length, cards + 2);
});
await t("whisper mode", async () => {
  settings.castChat = "gm";
  const boots = addItem(actor, { id: "boots", name: "Starsteel Boots", type: "equipment", system: { quantity: 1 } });
  await F.addItem(actor, boots);
  await F.castInto(actor, boots, shield, "spell1");
  assert.deepEqual(chat.at(-1).whisper.sort(), ["gm", "p2", "u1"]);
  settings.castChat = "off";
  const cards = chat.length; await F.castInto(actor, boots, shield, "spell1"); assert.equal(chat.length, cards);
});
await t("loggedItems", async () => assert.deepEqual(F.loggedItems(actor).map(i => i.id).sort(), ["boots", "circlet", "dagger", "staff", "sword"]));

await t("casts into two items at once spend one slot each (actor lock)", async () => {
  settings.castChat = "public";
  const ring = addItem(actor, { id: "ring", name: "Starsteel Ring", type: "equipment", system: { quantity: 1 } });
  const torc = addItem(actor, { id: "torc", name: "Starsteel Torc", type: "equipment", system: { quantity: 1 } });
  await F.addItem(actor, ring); await F.addItem(actor, torc);
  actor.system.spells.spell1.value = 3;
  const [x, y] = await Promise.all([F.castInto(actor, ring, shield, "spell1"), F.castInto(actor, torc, shield, "spell1")]);
  assert.ok(x); assert.equal(y, null);
  assert.equal(actor.system.spells.spell1.value, 2);
  assert.equal(F.getInfusion(torc).slots[0].casts, 0);
  assert.equal(F.isCasting(actor), false);
});
await t("edits wait for an in-flight cast", async () => {
  const p = F.castInto(actor, F.loggedItems(actor).find(i => i.id === "ring"), shield, "spell1");
  assert.equal(F.isCasting(actor), true);
  await assert.rejects(F.chooseEtching(F.loggedItems(actor).find(i => i.id === "torc"), "abj"), e => e.code === "busy");
  await p;
  await F.chooseEtching(F.loggedItems(actor).find(i => i.id === "torc"), "abj");
});
await t("magical items refused unless allowed", async () => {
  const plus1 = addItem(actor, { id: "plus1", name: "Starsteel Blade +1", type: "weapon", system: { quantity: 1, properties: new Set(["mgc"]) } });
  await assert.rejects(F.addItem(actor, plus1), e => e.code === "notUnenchanted");
  const legacy = addItem(actor, { id: "legacy", name: "Starsteel Old +1", type: "weapon", system: { quantity: 1, properties: { mgc: true } } });
  await assert.rejects(F.addItem(actor, legacy), e => e.code === "notUnenchanted");
  settings.requireMundane = false;
  assert.equal((await F.addItem(actor, plus1)).added, true);
  settings.requireMundane = true;
});
await t("crafter-and-GM whisper includes the owners when the GM posts", async () => {
  settings.castChat = "gm"; game.user = { id: "gm", name: "GM", isGM: true };
  const amulet = addItem(actor, { id: "amulet2", name: "Starsteel Amulet", type: "equipment", system: { quantity: 1 } });
  await F.addItem(actor, amulet);
  await F.castInto(actor, amulet, shield, "spell1");
  assert.deepEqual(chat.at(-1).whisper.sort(), ["gm", "p2", "u1"]);
  game.user = { id: "u1", name: "Sam", isGM: false }; settings.castChat = "public";
});
await t("cast card names the item, escaped", async () => {
  settings.castChat = "public";
  const staff = addItem(actor, { id: "oakstaff", name: "Oak <Staff>", type: "weapon", system: { quantity: 1 } });
  await F.addItem(actor, staff);
  actor.system.spells.spell1.value = 3;
  await F.castInto(actor, staff, shield, "spell1");
  const prefix = "STARCRAFTING.Chat.CastLine:";
  assert.ok(lastRender.line.startsWith(prefix), lastRender.line);
  assert.equal(JSON.parse(lastRender.line.slice(prefix.length)).item, "Oak &lt;Staff&gt;");
});
await t("lock is released before the chat card is posted", async () => {
  const cuff = addItem(actor, { id: "cuff", name: "Starsteel Cuff", type: "equipment", system: { quantity: 1 } });
  await F.addItem(actor, cuff);
  actor.system.spells.spell1.value = 3;
  const original = ChatMessage.create;
  let lockedDuringCard = null;
  ChatMessage.create = async d => { lockedDuringCard = F.isCasting(actor); await wait(30); return original(d); };
  try {
    await F.castInto(actor, cuff, shield, "spell1");
  } finally {
    ChatMessage.create = original;
  }
  assert.equal(lockedDuringCard, false);
});
await t("a cast while an edit is saving does nothing, and works once it lands", async () => {
  const brooch = addItem(actor, { id: "brooch", name: "Starsteel Brooch", type: "equipment", system: { quantity: 1 } });
  await F.addItem(actor, brooch);
  const before = actor.system.spells.spell1.value;
  const edit = F.chooseEtching(brooch, "abj");
  assert.equal(await F.castInto(actor, brooch, shield, "spell1"), null);
  await edit;
  assert.equal(actor.system.spells.spell1.value, before);
  const cast = await F.castInto(actor, brooch, shield, "spell1");
  assert.equal(cast.gained, 2);
  assert.equal(F.getInfusion(brooch).etching, "abj");
});
await t("a failed edit releases the lock", async () => {
  const torc = F.loggedItems(actor).find(i => i.id === "torc");
  await assert.rejects(F.chooseEtching(torc, "nonsense"), e => e.code === "unknownEtching");
  assert.equal(F.isCasting(actor), false);
});
console.log(`forge: ${n} tests passed`);
