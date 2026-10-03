// Packaging checks: every file the module points at exists, and every file name is safe to unpack on Windows.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const exists = path => existsSync(new URL(path, root));
const manifest = JSON.parse(readFileSync(new URL("module.json", root), "utf8"));

// Files named in module.json
const declared = [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)];
for ( const path of declared ) assert.ok(exists(path), `module.json points at a missing file: ${path}`);

// Files named by url(...) in the stylesheets (paths are relative to styles/)
for ( const sheet of manifest.styles ) {
  const css = readFileSync(new URL(sheet, root), "utf8");
  for ( const [, ref] of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g) ) {
    if ( /^(data:|https?:)/.test(ref) ) continue;
    assert.ok(exists(new URL(ref, new URL(sheet, root)).href.slice(root.href.length)), `${sheet} points at a missing file: ${ref}`);
  }
}

// Templates the scripts load
const constants = readFileSync(new URL("scripts/constants.js", root), "utf8");
for ( const [, path] of constants.matchAll(/`modules\/\$\{MODULE_ID\}\/([^`]+)`/g) ) {
  assert.ok(exists(path), `constants.js points at a missing template: ${path}`);
}

// Windows can't create files named CON, PRN, AUX, NUL, COM1-9 or LPT1-9 (with any extension)
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const INVALID = /[<>:"|?*\\]/;
const walk = dir => {
  for ( const entry of readdirSync(new URL(dir, root), { withFileTypes: true }) ) {
    if ( [".git", "node_modules", ".claude"].includes(entry.name) ) continue;
    assert.ok(!RESERVED.test(entry.name), `${dir}${entry.name} uses a name Windows reserves`);
    assert.ok(!INVALID.test(entry.name) && !/[. ]$/.test(entry.name), `${dir}${entry.name} isn't a valid Windows file name`);
    if ( entry.isDirectory() ) walk(`${dir}${entry.name}/`);
  }
};
walk("");
console.log(`files: ${declared.length} declared files present, names Windows-safe`);
