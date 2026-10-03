import assert from "node:assert/strict";
import * as I from "../scripts/infusion.js";
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error("FAIL", name, "\n", e); process.exitCode = 1; } };
const fireball = { name: "Fireball", level: 3, school: "evo", img: "f.png", uuid: "Actor.a.Item.f" };
const shield = { name: "Shield", level: 1, school: "abj", img: "s.png" };
const cure = { name: "Cure Wounds", level: 1, school: "evo" };

t("required casts", () => { assert.equal(I.requiredCasts(1), 15); assert.equal(I.requiredCasts(2), 30); assert.equal(I.requiredCasts(9), 135); assert.equal(I.requiredCasts(0), 0); });
t("cast value base", () => assert.equal(I.castValue({ spellLevel: 1, slotLevel: 1, etching: "none", school: "abj" }), 1));
t("cast value upcast", () => assert.equal(I.castValue({ spellLevel: 1, slotLevel: 3, etching: "none", school: "evo" }), 3));
t("cast value etched", () => assert.equal(I.castValue({ spellLevel: 1, slotLevel: 1, etching: "abj", school: "abj" }), 2));
t("cast value etched upcast", () => assert.equal(I.castValue({ spellLevel: 3, slotLevel: 5, etching: "evo", school: "evo" }), 6));
t("cast value wrong school", () => assert.equal(I.castValue({ spellLevel: 1, slotLevel: 1, etching: "abj", school: "evo" }), 1));
t("mastercrafted no double", () => assert.equal(I.castValue({ spellLevel: 1, slotLevel: 1, etching: "mastercrafted", school: "abj" }), 1));
t("slot too low", () => assert.equal(I.castValue({ spellLevel: 3, slotLevel: 2, etching: "none", school: "evo" }), 0));
t("spellKey", () => { assert.equal(I.spellKey("Melf's Acid Arrow"), "melf-s-acid-arrow"); assert.equal(I.spellKey("  Fireball "), "fireball"); });

t("create", () => { const d = I.createInfusion({ now: 5 }); assert.equal(d.slots.length, 1); assert.equal(d.etching, "none"); assert.equal(d.started, 5); });
t("create master", () => assert.equal(I.createInfusion({ etching: "mastercrafted" }).slots.length, 2));

t("etching change unlocked + slot growth/shrink", () => {
  let d = I.createInfusion();
  d = I.setEtching(d, "mastercrafted"); assert.equal(d.slots.length, 2);
  d = I.bindSpell(d, 1, shield); d = I.setEtching(d, "abj"); assert.equal(d.slots.length, 1); assert.equal(d.slots[0].spell, null);
});
t("etching locked after cast", () => {
  let d = I.createInfusion();
  d = I.applyCast(d, { index: 0, spell: shield, slotLevel: 1 }).data;
  assert.throws(() => I.setEtching(d, "abj"), e => e.code === "etchingLocked");
  assert.equal(I.setEtching(d, "abj", { force: true }).etching, "abj");
});
t("unknown etching", () => assert.throws(() => I.setEtching(I.createInfusion(), "foo"), e => e.code === "unknownEtching"));

t("cantrip rejected", () => assert.throws(() => I.bindSpell(I.createInfusion(), 0, { name: "Fire Bolt", level: 0 }), e => e.code === "cantripOrInvalid"));
t("bind twice same spell in master rejected", () => {
  let d = I.createInfusion({ etching: "mastercrafted" }); d = I.bindSpell(d, 0, shield);
  assert.throws(() => I.bindSpell(d, 1, shield), e => e.code === "alreadyBound");
});
t("rebind with progress rejected", () => {
  const d = I.applyCast(I.createInfusion(), { index: 0, spell: shield, slotLevel: 1 }).data;
  assert.throws(() => I.bindSpell(d, 0, cure), e => e.code === "slotLocked");
  assert.throws(() => I.unbindSpell(d, 0), e => e.code === "slotLocked");
  assert.equal(I.unbindSpell(d, 0, { force: true }).slots[0].spell, null);
});
t("rebind without progress ok", () => { let d = I.bindSpell(I.createInfusion(), 0, shield); d = I.bindSpell(d, 0, cure); assert.equal(d.slots[0].spell.name, "Cure Wounds"); });

t("findTargetSlot", () => {
  let d = I.createInfusion({ etching: "mastercrafted" });
  assert.deepEqual(I.findTargetSlot(d, "shield"), { index: 0, bind: true });
  d = I.bindSpell(d, 0, shield);
  assert.deepEqual(I.findTargetSlot(d, "shield"), { index: 0, bind: false });
  assert.deepEqual(I.findTargetSlot(d, "fireball"), { index: 1, bind: true });
  d = I.bindSpell(d, 1, fireball);
  assert.equal(I.findTargetSlot(d, "cure-wounds").reason, "slotsOccupied");
});

t("full infusion of 1st level unetched = 15 casts", () => {
  let d = I.createInfusion({ now: 1 }); let r;
  for (let i = 0; i < 15; i++) { r = I.applyCast(d, { index: 0, spell: shield, slotLevel: 1, now: 100 + i }); d = r.data; }
  assert.equal(d.slots[0].progress, 15); assert.equal(d.slots[0].casts, 15);
  assert.equal(r.itemComplete, true); assert.equal(d.status, "complete"); assert.equal(d.completed, 114);
  assert.throws(() => I.applyCast(d, { index: 0, spell: shield, slotLevel: 1 }), e => e.code === "itemComplete");
});
t("abjuration etching halves casts", () => {
  let d = I.createInfusion({ etching: "abj" }); let c = 0;
  while (d.status !== "complete") { d = I.applyCast(d, { index: 0, spell: shield, slotLevel: 1 }).data; c++; }
  assert.equal(c, 8); assert.equal(d.slots[0].progress, 15);
});
t("overflow capped and reported", () => {
  let d = I.createInfusion(); d = I.setProgress(I.bindSpell(d, 0, shield), 0, 14);
  const r = I.applyCast(d, { index: 0, spell: shield, slotLevel: 4 });
  assert.equal(r.value, 4); assert.equal(r.gained, 1); assert.equal(r.slotComplete, true);
});
t("slot too low throws", () => assert.throws(() => I.applyCast(I.createInfusion(), { index: 0, spell: fireball, slotLevel: 2 }), e => e.code === "slotTooLow"));
t("wrong spell into bound slot throws", () => {
  const d = I.bindSpell(I.createInfusion(), 0, shield);
  assert.throws(() => I.applyCast(d, { index: 0, spell: cure, slotLevel: 1 }), e => e.code === "slotLocked");
});
t("mastercrafted completes only when both full", () => {
  let d = I.createInfusion({ etching: "mastercrafted" });
  for (let i = 0; i < 15; i++) d = I.applyCast(d, { index: 0, spell: shield, slotLevel: 1 }).data;
  assert.equal(d.status, "infusing");
  assert.equal(I.findTargetSlot(d, "shield").reason, "slotComplete");
  let r; for (let i = 0; i < 15; i++) { r = I.applyCast(d, { index: 1, spell: cure, slotLevel: 1, now: 9 }); d = r.data; }
  assert.equal(r.itemComplete, true); assert.equal(d.completed, 9);
});
t("history capped", () => {
  const wish = { name: "Wish", level: 9, school: "con" };
  let d = I.bindSpell(I.createInfusion(), 0, wish);
  for (let i = 0; i < 130; i++) d = I.applyCast(d, { index: 0, spell: wish, slotLevel: 9 }).data;
  assert.equal(d.history.length, 100); assert.equal(d.slots[0].casts, 130);
});
t("normalize garbage", () => {
  assert.equal(I.normalizeInfusion(null), null);
  const d = I.normalizeInfusion({ etching: "bogus", slots: [{ spell: { name: "Shield", level: 1 }, progress: 999 }, { spell: fireball }] });
  assert.equal(d.etching, "none"); assert.equal(d.slots.length, 1); assert.equal(d.slots[0].progress, 15); assert.equal(d.status, "complete");
});
t("normalize keeps master second slot", () => {
  const d = I.normalizeInfusion({ etching: "mastercrafted", slots: [{ spell: shield, progress: 3, casts: 3 }] });
  assert.equal(d.slots.length, 2); assert.equal(d.slots[1].spell, null); assert.equal(d.status, "infusing"); assert.equal(d.completed, null);
});
t("immutability", () => {
  const d = I.createInfusion(); const snap = JSON.stringify(d);
  I.applyCast(d, { index: 0, spell: shield, slotLevel: 1 }); I.setEtching(d, "mastercrafted"); I.bindSpell(d, 0, shield);
  assert.equal(JSON.stringify(d), snap);
});
t("progress helpers", () => {
  const p = I.slotProgress({ spell: { level: 3 }, progress: 15 });
  assert.deepEqual(p, { required: 45, progress: 15, remaining: 30, pct: 33.3, complete: false });
  assert.deepEqual(I.overallProgress({ slots: [{ spell: { level: 1 }, progress: 15 }, { spell: null, progress: 0 }] }), { required: 15, progress: 15, pct: 100 });
});
t("setProgress un-completes", () => {
  let d = I.createInfusion(); d = I.setProgress(I.bindSpell(d, 0, shield), 0, 15, { now: 7 });
  assert.equal(d.status, "complete"); assert.equal(d.completed, 7);
  d = I.setProgress(d, 0, 3); assert.equal(d.status, "infusing"); assert.equal(d.completed, null);
});
t("renamed spell still matches by uuid and refreshes its name", () => {
  const before = { name: "Misty Step", level: 2, school: "con", uuid: "Actor.a.Item.m" };
  let d = I.createInfusion({ etching: "mastercrafted" });
  d = I.applyCast(d, { index: 0, spell: before, slotLevel: 2 }).data;
  const renamed = { name: "Fey Step", level: 2, school: "con", uuid: "Actor.a.Item.m" };
  assert.deepEqual(I.findTargetSlot(d, renamed), { index: 0, bind: false });
  assert.throws(() => I.bindSpell(d, 1, renamed), e => e.code === "alreadyBound");
  const r = I.applyCast(d, { index: 0, spell: renamed, slotLevel: 2 });
  assert.equal(r.data.slots[0].spell.name, "Fey Step"); assert.equal(r.data.slots[0].progress, 2);
});
t("bound level survives a sheet edit", () => {
  let d = I.applyCast(I.createInfusion(), { index: 0, spell: { name: "Fireball", level: 3, school: "evo", uuid: "u" }, slotLevel: 3 }).data;
  const edited = { name: "Fireball", level: 2, school: "evo", uuid: "u" };
  assert.throws(() => I.applyCast(d, { index: 0, spell: edited, slotLevel: 2 }), e => e.code === "slotTooLow");
  assert.equal(I.applyCast(d, { index: 0, spell: edited, slotLevel: 3 }).data.slots[0].spell.level, 3);
});
t("history entries are typed", () => {
  const d = I.normalizeInfusion({ etching: "none", slots: [], history: [
    { at: "5", slot: 7, spell: 42, slotLevel: "<img src=x onerror=alert(1)>", slotKey: "<b>", value: "<script>", progress: {}, gm: "yes", byName: ["x"] }
  ] });
  assert.deepEqual(d.history[0], { at: 5, slot: 1, spell: "42", slotLevel: 0, slotKey: null, value: 0, progress: 0, gm: true, by: null, byName: "x" });
  const ok = I.normalizeInfusion({ history: [{ slotKey: "pact" }, { slotKey: "spell3" }] });
  assert.deepEqual(ok.history.map(h => h.slotKey), ["pact", "spell3"]);
});
console.log(`infusion: ${n} tests passed`);
