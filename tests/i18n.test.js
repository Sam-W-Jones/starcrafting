// Every localization key the module uses must exist in lang/en.json, with the placeholders it is given.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const lang = JSON.parse(read("lang/en.json"));
const lookup = key => key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), lang.STARCRAFTING);

const scripts = readdirSync(new URL("scripts/", root)).filter(f => f.endsWith(".js")).map(f => [f, read(`scripts/${f}`)]);
const templates = [];
const walk = dir => {
  for ( const entry of readdirSync(new URL(dir, root), { withFileTypes: true }) ) {
    if ( entry.isDirectory() ) walk(`${dir}${entry.name}/`);
    else if ( entry.name.endsWith(".hbs") ) templates.push([entry.name, read(`${dir}${entry.name}`)]);
  }
};
walk("templates/");

const used = new Set();
// Full keys anywhere ("STARCRAFTING.Settings.ConfirmCast.Name", {{localize "STARCRAFTING.Title"}})
for ( const [, src] of [...scripts, ...templates] ) {
  for ( const m of src.matchAll(/"STARCRAFTING\.([A-Za-z0-9.]+)"/g) ) used.add(m[1]);
}
// Short keys through util.t(): t("Key"), t(cond ? "A" : "B")
for ( const [, src] of scripts ) {
  for ( const m of src.matchAll(/\bt\(\s*"([^"$]+)"/g) ) used.add(m[1]);
  for ( const m of src.matchAll(/\bt\(\s*[^"()]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g) ) { used.add(m[1]); used.add(m[2]); }
}
// Keys built at runtime
const errorCodes = new Set();
for ( const [, src] of scripts ) for ( const m of src.matchAll(/InfusionError\(\s*"([A-Za-z]+)"/g) ) errorCodes.add(m[1]);
for ( const reason of ["slotsOccupied", "slotComplete"] ) { errorCodes.add(reason); used.add(`Spellbook.Reason.${reason}`); }
for ( const code of errorCodes ) used.add(`Error.${code}`);
for ( const status of ["infusing", "complete", "fresh"] ) used.add(`Status.${status}`);
for ( let n = 1; n <= 9; n++ ) used.add(`Ordinal.${n}`);

const missing = [...used].filter(k => typeof lookup(k) !== "string").sort();
assert.deepEqual(missing, [], `Missing from lang/en.json: ${missing.join(", ")}`);

// Placeholders that callers rely on
const expectPlaceholders = {
  "WindowTitle": ["name"],
  "Error.slotTooLow": ["level"],
  "Error.notUnenchanted": ["item"],
  "Chronicle.Truncated": ["shown"],
  "Spellbook.PillTooltip": ["ordinal", "value", "max", "gain"],
  "Chat.Progress": ["progress", "required", "pct"],
  "Chat.CastLine": ["actor", "spell", "item", "slot"],
  "Chat.CastLinePact": ["actor", "spell", "item", "slot"]
};
for ( const [key, names] of Object.entries(expectPlaceholders) ) {
  for ( const name of names ) assert.ok(lookup(key).includes(`{${name}}`), `${key} lacks {${name}}`);
}
console.log(`i18n: ${used.size} keys checked`);
