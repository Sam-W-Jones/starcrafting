// Unit tests for scripts/system.js with dnd5e 3.x- and 2.x-shaped data
import assert from "node:assert/strict";

const settings = {};
globalThis.game = {
  settings: { get: (ns, k) => settings[k] },
  i18n: { lang: "en", localize: k => ({ "DND5E.SchoolAbj": "Abjuration" }[k] ?? k) }
};
const school3 = { label: "Abjuration", icon: "x.svg", toString() { throw new Error("toString must not be used"); } };
globalThis.CONFIG = { DND5E: { spellSchools: { abj: school3 }, spellLevels: { 1: "1st Level" }, spellUpcastModes: ["always", "pact", "prepared"] } };

const S = await import("../scripts/system.js");
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error("FAIL", name, "\n", e); process.exitCode = 1; } };
const spell = (level, mode, prepared, actorType = "character") => ({ type: "spell", name: "X", system: { level, school: "abj", preparation: { mode, prepared } }, actor: { type: actorType } });

t("school label 3.x object", () => assert.equal(S.schoolLabel("abj"), "Abjuration"));
t("school label 2.x string", () => { CONFIG.DND5E.spellSchools.abj = "DND5E.SchoolAbj"; assert.equal(S.schoolLabel("abj"), "Abjuration"); CONFIG.DND5E.spellSchools.abj = school3; });
t("school label fallback", () => assert.equal(S.schoolLabel("nec"), "Necromancy"));
t("school label unknown", () => assert.equal(S.schoolLabel("zzz"), "zzz"));

t("castable prepared", () => assert.equal(S.isCastable(spell(1, "prepared", true)), true));
t("not castable unprepared", () => assert.equal(S.isCastable(spell(1, "prepared", false)), false));
t("npc unprepared counts", () => assert.equal(S.isCastable(spell(1, "prepared", false, "npc")), true));
t("always", () => assert.equal(S.isCastable(spell(2, "always", false)), true));
t("pact", () => assert.equal(S.isCastable(spell(1, "pact", false)), true));
t("innate excluded", () => assert.equal(S.isCastable(spell(1, "innate", true)), false));
t("atwill excluded", () => assert.equal(S.isCastable(spell(1, "atwill", true)), false));
t("cantrip excluded", () => assert.equal(S.isCastable(spell(0, "prepared", true)), false));
t("blank mode = prepared", () => assert.equal(S.isCastable(spell(1, "", true)), true));
t("no upcast modes config (2.x fallback)", () => {
  const m = CONFIG.DND5E.spellUpcastModes; delete CONFIG.DND5E.spellUpcastModes;
  assert.equal(S.isCastable(spell(1, "pact", false)), true); assert.equal(S.isCastable(spell(1, "innate", true)), false);
  CONFIG.DND5E.spellUpcastModes = m;
});
t("non-spell", () => assert.equal(S.isCastable({ type: "weapon", system: {} }), false));

const actor = spells => ({ system: { spells } });
t("slot pools", () => {
  const pools = S.slotPools(actor({
    spell1: { value: 3, max: 4, override: null }, spell2: { value: 0, max: 3, override: null },
    spell3: { value: 9, max: 2, override: null }, spell4: { value: 0, max: 0, override: null },
    pact: { value: 1, max: 2, level: 3, override: null }
  }));
  assert.deepEqual(pools, [
    { key: "spell1", level: 1, value: 3, max: 4, pact: false },
    { key: "spell2", level: 2, value: 0, max: 3, pact: false },
    { key: "spell3", level: 3, value: 2, max: 2, pact: false },
    { key: "pact", level: 3, value: 1, max: 2, pact: true }
  ]);
});
t("override max", () => assert.equal(S.slotPools(actor({ spell1: { value: 1, max: 2, override: 5 } }))[0].max, 5));
t("no pact level -> no pact pool", () => assert.equal(S.slotPools(actor({ pact: { value: 1, max: 1, level: 0 } })).length, 0));
t("no spells (vehicle)", () => assert.deepEqual(S.slotPools({ system: {} }), []));

t("physical 3.x DataModel-like", () => {
  class Sys { constructor() { this.quantity = 1; } }
  assert.equal(S.isPhysicalItem({ type: "weapon", system: new Sys() }), true);
});
t("physical: feat no", () => assert.equal(S.isPhysicalItem({ type: "feat", system: {} }), false));
t("physical: spell no", () => assert.equal(S.isPhysicalItem({ type: "spell", system: { quantity: 1 } }), false));

t("no name restriction remains", () => { assert.equal(S.isStarsteel, undefined); assert.equal(S.starsteelKeyword, undefined); });

t("canCraft", () => {
  assert.equal(S.canCraft({ type: "character", system: { spells: {} } }), true);
  assert.equal(S.canCraft({ type: "vehicle", system: {} }), false);
  assert.equal(S.canCraft(null), false);
});

t("snapshot", () => assert.deepEqual(S.spellSnapshot({ name: "Melf's Acid Arrow", img: "a.png", uuid: "u", system: { level: 2, school: "evo" } }),
  { key: "melf-s-acid-arrow", name: "Melf's Acid Arrow", img: "a.png", level: 2, school: "evo", uuid: "u" }));

// spendSlot / refundSlot
const mk = (value, resolveUndefined = false) => {
  const a = { system: { spells: { spell1: { value } } }, updates: [] };
  a.update = async u => { a.updates.push(u); if ( resolveUndefined ) return undefined; a.system.spells.spell1.value = u["system.spells.spell1.value"]; return a; };
  return a;
};
let a1 = mk(2); await S.spendSlot(a1, "spell1"); t("spend", () => assert.equal(a1.system.spells.spell1.value, 1));
let a2 = mk(0); let threw = null; try { await S.spendSlot(a2, "spell1"); } catch (e) { threw = e.code; }
t("spend none left", () => { assert.equal(threw, "noSlotLeft"); assert.equal(a2.updates.length, 0); });
let a3 = mk(2, true); threw = null; try { await S.spendSlot(a3, "spell1"); } catch (e) { threw = e.code; }
t("spend rejected update", () => assert.equal(threw, "noSlotLeft"));
let a4 = mk(1); await S.refundSlot(a4, "spell1"); t("refund", () => assert.equal(a4.system.spells.spell1.value, 2));

t("isMagical", () => {
  assert.equal(S.isMagical({ system: { properties: new Set(["mgc"]) } }), true);
  assert.equal(S.isMagical({ system: { properties: new Set(["fin"]) } }), false);
  assert.equal(S.isMagical({ system: { properties: { mgc: true } } }), true);
  assert.equal(S.isMagical({ system: { properties: ["mgc"] } }), true);
  assert.equal(S.isMagical({ system: {} }), false);
});
console.log(`system: ${n} tests passed`);
