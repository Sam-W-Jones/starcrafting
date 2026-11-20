// A minimal stand-in for the parts of Foundry v11 + dnd5e 3.1+ that the Starcrafting module touches,
// so the real module code, templates and CSS can be exercised in a plain browser.
// Mirrors verified v11.315 behaviour: Application render flow (renders dropped while rendering),
// DragDrop binding, update merge semantics (objects merge, arrays replace), hooks, settings, i18n, Dialog.

const EN = await (await fetch("/modules/starcrafting/lang/en.json")).json();
const getProp = (obj, path) => path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isObj = v => v && (typeof v === "object") && !Array.isArray(v) && !(v instanceof Set);

/* ---------------- foundry.utils ---------------- */
function mergeObject(original, other = {}, { inplace = true } = {}) {
  const target = inplace ? original : structuredClone(original);
  for ( const [k, v] of Object.entries(other) ) {
    if ( k.startsWith("-=") ) { delete target[k.slice(2)]; continue; }
    if ( isObj(v) && isObj(target[k]) ) mergeObject(target[k], v);
    else target[k] = (isObj(v) || Array.isArray(v)) ? structuredClone(v) : v;
  }
  return target;
}
function expandObject(obj) {
  const out = {};
  for ( const [k, v] of Object.entries(obj) ) {
    const parts = k.split(".");
    let o = out;
    parts.slice(0, -1).forEach(p => { o = (o[p] ??= {}); });
    o[parts.at(-1)] = isObj(v) ? expandObject(v) : v;
  }
  return out;
}
function debounce(fn, ms) {
  let timer;
  return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
}
globalThis.foundry = { utils: { mergeObject: (a, b, o = {}) => mergeObject(a, b, { inplace: o.inplace ?? true }), debounce, expandObject } };

/* ---------------- Hooks ---------------- */
const hooks = {};
globalThis.Hooks = {
  on(name, fn) { (hooks[name] ??= []).push(fn); },
  once(name, fn) { (hooks[name] ??= []).push(fn); },
  callAll(name, ...args) { for ( const fn of hooks[name] ?? [] ) fn(...args); return true; },
  call(name, ...args) { for ( const fn of hooks[name] ?? [] ) if ( fn(...args) === false ) return false; return true; }
};

/* ---------------- i18n, settings, users, notifications ---------------- */
const settings = new Map();
globalThis.game = {
  i18n: {
    lang: "en",
    localize(key) { const v = getProp(EN, key); return (typeof v === "string") ? v : key; },
    format(key, data = {}) { return this.localize(key).replace(/{[^}]+}/g, m => data[m.slice(1, -1)]); }
  },
  settings: {
    register(ns, key, data) { settings.set(key, { ...data, value: data.default }); },
    get(ns, key) { if ( !settings.has(key) ) throw new Error(`Not a registered game setting: ${key}`); return settings.get(key).value; },
    async set(ns, key, value) { const s = settings.get(key); s.value = value; s.onChange?.(value); return value; },
    _all: settings
  },
  user: { id: "user1", name: "Sam", isGM: false, character: null },
  users: [{ id: "user1", isGM: false }, { id: "gm1", isGM: true }],
  modules: new Map([["starcrafting", { id: "starcrafting", active: true }]]),
  actors: []
};
globalThis.ui = { notifications: {} };
for ( const type of ["info", "warn", "error"] ) {
  ui.notifications[type] = msg => {
    const li = document.createElement("li");
    li.className = `notification ${type === "warn" ? "warning" : type}`;
    li.innerHTML = msg;
    document.getElementById("notifications").append(li);
    setTimeout(() => li.remove(), 5000);
  };
}

/* ---------------- Templates ---------------- */
const templateCache = new Map();
Handlebars.registerHelper("localize", (key, options) => {
  const data = options?.hash ?? {};
  return Object.keys(data).length ? game.i18n.format(key, data) : game.i18n.localize(key);
});
Handlebars.registerHelper("eq", (a, b) => a === b);
async function getTemplate(path) {
  if ( !templateCache.has(path) ) {
    const compiled = Handlebars.compile(await (await fetch(`/${path}`)).text());
    Handlebars.registerPartial(path, compiled);
    templateCache.set(path, compiled);
  }
  return templateCache.get(path);
}
globalThis.loadTemplates = paths => Promise.all(paths.map(getTemplate));
globalThis.renderTemplate = async (path, data) => (await getTemplate(path))(data, { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true });

/* ---------------- Documents ---------------- */
const registry = new Map();
globalThis.fromUuid = async uuid => registry.get(uuid) ?? null;
globalThis.fromUuidSync = uuid => registry.get(uuid) ?? null;

class Collection extends Map {
  filter(fn) { return Array.from(this.values()).filter(fn); }
  find(fn) { return Array.from(this.values()).find(fn); }
  map(fn) { return Array.from(this.values()).map(fn); }
  some(fn) { return Array.from(this.values()).some(fn); }
}

/** Dotted keys expand, objects merge, arrays and primitives replace; then the update hook fires */
async function applyUpdate(doc, changes, hookName) {
  await new Promise(r => setTimeout(r, 30 + Math.random() * 40)); // network round trip
  const expanded = expandObject(changes);
  mergeObject(doc, expanded);
  Hooks.callAll(hookName, doc, expanded, {}, game.user.id);
  return doc;
}

export class MockItem {
  constructor(actor, data) {
    const { system, ...rest } = data;
    Object.assign(this, structuredClone({ flags: {}, ...rest }));
    this.system = system?.properties instanceof Set
      ? { ...structuredClone({ ...system, properties: undefined }), properties: new Set(system.properties) }
      : structuredClone(system ?? {});
    Object.defineProperty(this, "parent", { value: actor, enumerable: false });
    this.uuid = `${actor.uuid}.Item.${this.id}`;
    registry.set(this.uuid, this);
  }
  get actor() { return this.parent; }
  get isOwner() { return this.parent.isOwner; }
  get sheet() { return { render: () => ui.notifications.info(`(Would open the sheet for ${this.name})`) }; }
  toDragData() { return { type: "Item", uuid: this.uuid }; }
  update(changes) { return applyUpdate(this, changes, "updateItem"); }
  async unsetFlag(scope, key) {
    await new Promise(r => setTimeout(r, 30));
    delete this.flags?.[scope]?.[key];
    Hooks.callAll("updateItem", this, {}, {}, game.user.id);
    return this;
  }
}
globalThis.Item = MockItem;

export class MockActor {
  constructor(data) {
    const { items = [], classes = {}, ...rest } = data;
    Object.assign(this, structuredClone(rest));
    this.uuid = `Actor.${this.id}`;
    this.classes = classes;
    this.items = new Collection();
    for ( const i of items ) this.items.set(i.id, new MockItem(this, i));
    registry.set(this.uuid, this);
    game.actors.push(this);
  }
  get isOwner() { return game.user.isGM || this.ownedByPlayer; }
  testUserPermission(user) { return user.isGM || (this.ownedByPlayer && (user.id === "user1")); }
  async update(changes) {
    for ( const [k, v] of Object.entries(changes) ) if ( k.startsWith("system.spells.") && (v < 0) ) changes[k] = 0;
    return applyUpdate(this, changes, "updateActor");
  }
}

/** A class item as dnd5e exposes it on actor.classes */
export const mockClass = (identifier, progression = "full", subclass = null) => ({
  identifier, system: { identifier, spellcasting: { progression } }, spellcasting: { progression },
  subclass: subclass ? { identifier: subclass, system: { identifier: subclass } } : null
});

/* ---------------- Application ---------------- */
let appCount = 0;
let zTop = 100;
globalThis.Application = class Application {
  static RENDER_STATES = { CLOSING: -2, CLOSED: -1, NONE: 0, RENDERING: 1, RENDERED: 2, ERROR: 3 };
  static get defaultOptions() {
    return { baseApplication: null, width: null, height: null, popOut: true, minimizable: true, resizable: false,
      id: "", classes: [], dragDrop: [], tabs: [], filters: [], title: "", template: null, scrollY: [] };
  }
  constructor(options = {}) {
    this.options = mergeObject(this.constructor.defaultOptions, options, { inplace: false });
    this.appId = ++appCount;
    this._state = Application.RENDER_STATES.NONE;
    this.renderCount = 0;
  }
  get id() { return this.options.id || `app-${this.appId}`; }
  get element() { return $(document.getElementById(this.id) ?? []); }
  get rendered() { return this._state === Application.RENDER_STATES.RENDERED; }
  get title() { return game.i18n.localize(this.options.title); }
  render(force = false, options = {}) {
    this._render(force, options).catch(err => { this._state = Application.RENDER_STATES.ERROR; console.error("Render error", err); });
    return this;
  }
  async _render(force = false) {
    const S = Application.RENDER_STATES;
    if ( [S.CLOSING, S.RENDERING].includes(this._state) ) return;
    if ( !force && (this._state <= S.NONE) ) return;
    this._state = S.RENDERING;
    const data = await this.getData(this.options);
    let el = document.getElementById(this.id);
    const scroll = {};
    if ( el ) for ( const sel of this.options.scrollY ) scroll[sel] = Array.from(el.querySelectorAll(sel)).map(e => e.scrollTop);
    const html = await renderTemplate(this.options.template, data);
    if ( !el ) el = this._renderOuter();
    const content = el.querySelector(".window-content");
    content.innerHTML = html;
    el.querySelector(".window-title").textContent = this.title;
    this._bindDragDrop(content);
    this.activateListeners($(content.children));
    for ( const sel of this.options.scrollY ) content.querySelectorAll(sel).forEach((e, i) => { e.scrollTop = scroll[sel]?.[i] || 0; });
    this.renderCount++;
    this._state = S.RENDERED;
    if ( force ) el.style.zIndex = ++zTop;
  }
  _renderOuter() {
    const el = document.createElement("div");
    el.id = this.id;
    el.className = `app window-app ${this.options.classes.join(" ")}`;
    Object.assign(el.style, { left: "10px", top: "10px", width: `${this.options.width}px`, height: `${this.options.height}px` });
    el.innerHTML = `<header class="window-header flexrow"><h4 class="window-title"></h4>
      <a class="header-button control close"><i class="fas fa-times"></i>Close</a></header>
      <section class="window-content"></section>`;
    el.querySelector(".close").addEventListener("click", () => this.close());
    document.body.append(el);
    return el;
  }
  _bindDragDrop(content) {
    for ( const d of this.options.dragDrop ) {
      if ( d.dragSelector && this._canDragStart(d.dragSelector) ) {
        content.querySelectorAll(d.dragSelector).forEach(el => { el.draggable = true; el.ondragstart = ev => this._onDragStart(ev); });
      }
      if ( this._canDragDrop(d.dropSelector) ) {
        const zones = (!d.dropSelector || content.matches(d.dropSelector)) ? [content] : content.querySelectorAll(d.dropSelector);
        zones.forEach(el => {
          el.ondragover = ev => { ev.preventDefault(); this._onDragOver(ev); };
          el.ondrop = ev => { ev.preventDefault(); return this._onDrop(ev); };
        });
      }
    }
  }
  async getData() { return {}; }
  activateListeners() {}
  _canDragStart() { return game.user.isGM; }
  _canDragDrop() { return game.user.isGM; }
  _onDragStart() {}
  _onDragOver() {}
  _onDrop() {}
  async close() { document.getElementById(this.id)?.remove(); this._state = Application.RENDER_STATES.CLOSED; }
};

/* ---------------- Dialog ---------------- */
globalThis.Dialog = class Dialog {
  static async wait(data, options = {}) {
    return new Promise(resolve => {
      const app = document.createElement("div");
      app.className = `app window-app ${(options.classes ?? ["dialog"]).join(" ")}`;
      Object.assign(app.style, { left: "35%", top: "25%", width: `${options.width ?? 400}px`, zIndex: ++zTop });
      const buttons = Object.entries(data.buttons ?? {}).map(([id, b]) =>
        `<button class="dialog-button ${id}${id === data.default ? " default bright" : ""}" data-button="${id}">${b.icon ?? ""} ${b.label}</button>`).join("");
      app.innerHTML = `<header class="window-header flexrow"><h4 class="window-title">${data.title}</h4>
        <a class="header-button control close"><i class="fas fa-times"></i>Close</a></header>
        <section class="window-content"><div class="dialog-content">${data.content}</div>
        <div class="dialog-buttons flexrow">${buttons}</div></section>`;
      document.body.append(app);
      app.querySelector(".default")?.focus();
      let done = false;
      const finish = value => { if ( done ) return; done = true; app.remove(); resolve(value); };
      app.querySelectorAll("[data-button]").forEach(btn => btn.addEventListener("click", () => {
        const id = btn.dataset.button;
        const r = data.buttons[id].callback?.($(app));
        finish(r === undefined ? id : r);
      }));
      app.querySelector(".close").addEventListener("click", () => finish(data.close ? data.close() : null));
    });
  }
  static async confirm({ title, content, defaultYes = true, options = {} } = {}) {
    return Dialog.wait({
      title, content,
      buttons: {
        yes: { icon: '<i class="fas fa-check"></i>', label: "Yes", callback: () => true },
        no: { icon: '<i class="fas fa-times"></i>', label: "No", callback: () => false }
      },
      default: defaultYes ? "yes" : "no",
      close: () => null
    }, options);
  }
};

/* ---------------- Chat, editor, config ---------------- */
globalThis.CONST = { CHAT_MESSAGE_TYPES: { OTHER: 0 } };
globalThis.ChatMessage = {
  getSpeaker: ({ actor } = {}) => ({ alias: actor?.name }),
  getWhisperRecipients: name => (name === "GM" ? [{ id: "gm1", isGM: true }] : []),
  async create(data) {
    const li = document.createElement("li");
    li.className = "chat-message message flexcol";
    li.innerHTML = `<header class="message-header flexrow"><h4 class="message-sender">${data.speaker.alias}</h4></header>
      <div class="message-content">${data.content}</div>`;
    const log = document.getElementById("chat-log");
    log.append(li);
    log.scrollTop = log.scrollHeight;
    window.__chat = (window.__chat ?? []).concat([data]);
    return data;
  }
};
globalThis.TextEditor = {
  getDragEventData(event) {
    try { return JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return {}; }
  }
};
globalThis.canvas = { ready: false };

// dnd5e 3.1+ shapes: schools as objects, preparation modes with upcast flags (3.2 adds "ritual")
const school = (label, file) => ({ label, icon: `systems/dnd5e/icons/svg/schools/${file}.svg` });
globalThis.CONFIG = {
  DND5E: {
    spellSchools: {
      abj: school("Abjuration", "abjuration"), con: school("Conjuration", "conjuration"),
      div: school("Divination", "divination"), enc: school("Enchantment", "enchantment"),
      evo: school("Evocation", "evocation"), ill: school("Illusion", "illusion"),
      nec: school("Necromancy", "necromancy"), trs: school("Transmutation", "transmutation")
    },
    spellLevels: { 0: "Cantrip", 1: "1st Level", 2: "2nd Level", 3: "3rd Level", 4: "4th Level", 5: "5th Level",
      6: "6th Level", 7: "7th Level", 8: "8th Level", 9: "9th Level" },
    spellPreparationModes: {
      prepared: { label: "Prepared", upcast: true, prepares: true },
      pact: { label: "Pact Magic", upcast: true, cantrips: true },
      always: { label: "Always Prepared", upcast: true, prepares: true },
      atwill: { label: "At-Will" }, innate: { label: "Innate Spellcasting" }, ritual: { label: "Ritual Only" }
    },
    spellUpcastModes: ["always", "pact", "prepared"]
  }
};

export function fireInit() {
  for ( const fn of hooks.init ?? [] ) fn();
}
