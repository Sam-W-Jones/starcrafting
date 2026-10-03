// Load every module script with stubbed Foundry globals, to catch syntax errors and broken imports/exports.
const hooks = {};
globalThis.Hooks = {
  on: (name, fn) => { (hooks[name] ??= []).push(fn); },
  once: (name, fn) => { (hooks[name] ??= []).push(fn); },
  callAll: () => true, call: () => true
};
globalThis.Application = class Application {
  static RENDER_STATES = { CLOSING: -2, CLOSED: -1, NONE: 0, RENDERING: 1, RENDERED: 2, ERROR: 3 };
  static get defaultOptions() { return { classes: [], dragDrop: [], scrollY: [] }; }
  constructor(options = {}) { this.options = { ...this.constructor.defaultOptions, ...options }; }
};
globalThis.foundry = { utils: {
  mergeObject: (a, b) => ({ ...a, ...b }),
  debounce: (fn) => fn
} };
globalThis.window = { innerWidth: 1600, innerHeight: 1000 };

const mods = ["constants", "infusion", "system", "util", "settings", "chat", "forge", "app", "main"];
for (const m of mods) {
  const ns = await import(`../scripts/${m}.js`);
  if (!Object.keys(ns).length && m !== "main") throw new Error(`${m} exports nothing`);
}
const expected = ["init", "getActorSheetHeaderButtons", "getSceneControlButtons", "dnd5e.getItemContextOptions",
  "createItem", "updateItem", "deleteItem", "updateActor", "deleteActor"];
for (const h of expected) if (!hooks[h]) throw new Error(`hook not registered: ${h}`);
console.log(`imports: ${mods.length} modules loaded, ${Object.keys(hooks).length} hooks registered`);
