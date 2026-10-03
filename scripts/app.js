import { ETCHINGS, ETCHING_MASTER, MODULE_ID, TEMPLATES } from "./constants.js";
import {
  InfusionError, castValue, etchingMultiplier, findTargetSlot, isLocked, overallProgress, requiredCasts, slotProgress
} from "./infusion.js";
import {
  addItem, bindSpellToSlot, castInto, chooseEtching, getInfusion, isCasting, loggedItems, previewCast,
  removeFromLog, setAllProgress, unbindSlot
} from "./forge.js";
import { canCraft, castableSpells, schoolLabel, slotPools, spellLevelHeading, spellSnapshot } from "./system.js";
import { esc, etchingHint, etchingName, formatWhen, isEtched, levelLabel, ordinal, report, t } from "./util.js";

/** How many chronicle entries the forge shows */
const CHRONICLE_SHOWN = 40;

/** Most diamonds a single slot well draws */
const MAX_PIPS = 8;

/**
 * The Starforge: one window per crafter, with their crafting log, the item on the anvil and their spellbook.
 */
export class StarforgeApp extends Application {
  /** Open windows, keyed by the crafter's uuid */
  static instances = new Map();

  constructor(actor, options = {}) {
    super(foundry.utils.mergeObject({ id: StarforgeApp.idFor(actor) }, options));
    this.actor = actor;
    /** Id of the item on the anvil */
    this.selectedId = null;
    /** Whether fully infused items are listed in the log */
    this.showComplete = true;
    /** Items whose locked etching the GM has opened up for changes */
    this.gmUnlocked = new Set();
    this.chronicleOpen = false;
    /** The slot that just took a cast, so the next render can play its surge */
    this._surge = null;
    this.refresh = foundry.utils.debounce(this.#refresh.bind(this), 80);
  }

  static idFor(actor) {
    return `starforge-${actor.uuid.replace(/\./g, "-")}`;
  }

  static get defaultOptions() {
    const width = Math.max(780, Math.min(1120, (window.innerWidth || 1200) - 120));
    const height = Math.max(540, Math.min(760, (window.innerHeight || 900) - 80));
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["starcrafting", "starforge"],
      template: TEMPLATES.app,
      width,
      height,
      resizable: true,
      minimizable: true,
      dragDrop: [{ dragSelector: ".sc-spell", dropSelector: ".sc-drop" }],
      scrollY: [".sc-log-list", ".sc-forge-body", ".sc-spell-list"]
    });
  }

  get title() {
    return t("WindowTitle", { name: this.actor.name });
  }

  /** Open (or bring forward) the Starforge for an actor, optionally with an item on the anvil */
  static open(actor, { itemId = null } = {}) {
    let app = StarforgeApp.instances.get(actor.uuid);
    if ( !app ) {
      // A window for this actor that is still sliding shut would be adopted by the new one, then removed
      const closing = document.getElementById(StarforgeApp.idFor(actor));
      if ( closing ) $(closing).stop(true, true);
      app = new StarforgeApp(actor);
      StarforgeApp.instances.set(actor.uuid, app);
    }
    if ( itemId ) app.selectedId = itemId;
    app.render(true);
    return app;
  }

  /** Re-render any open window that shows this actor */
  static refreshFor(actor) {
    if ( !actor ) return;
    for ( const app of StarforgeApp.instances.values() ) {
      if ( (app.actor === actor) || (app.actor.uuid === actor.uuid) ) app.refresh();
    }
  }

  static refreshAll() {
    for ( const app of StarforgeApp.instances.values() ) app.refresh();
  }

  /**
   * A render asked for while another is running is dropped by Foundry, so try again shortly.
   * Likewise wait out a write in flight, so the window never settles with its buttons locked.
   */
  #refresh() {
    if ( !this.rendered && (this._state !== Application.RENDER_STATES.RENDERING) ) return;
    if ( (this._state === Application.RENDER_STATES.RENDERING) || isCasting(this.actor) ) return this.refresh();
    this.render(false);
  }

  async close(options = {}) {
    const states = Application.RENDER_STATES;
    if ( !options.force && ![states.RENDERED, states.ERROR].includes(this._state) ) return;
    if ( StarforgeApp.instances.get(this.actor.uuid) === this ) StarforgeApp.instances.delete(this.actor.uuid);
    return super.close(options);
  }

  get selectedItem() {
    return this.selectedId ? (this.actor.items.get(this.selectedId) ?? null) : null;
  }

  /* -------------------------------------------- */
  /*  Data                                        */
  /* -------------------------------------------- */

  async getData() {
    const actor = this.actor;
    const isGM = game.user.isGM;
    const records = loggedItems(actor)
      .map(item => ({ item, data: getInfusion(item) }))
      .filter(r => r.data)
      .sort(compareRecords);

    if ( this.selectedId && !records.some(r => r.item.id === this.selectedId) ) this.selectedId = null;
    const selected = records.find(r => r.item.id === this.selectedId) ?? null;

    const completeCount = records.filter(r => r.data.status === "complete").length;
    const visible = records.filter(r => this.showComplete || (r.data.status !== "complete") || (r.item.id === this.selectedId));
    const hiddenComplete = records.length - visible.length;

    const pools = slotPools(actor);

    return {
      actor: { id: actor.id, name: actor.name, img: actor.img },
      crafters: this.#crafterChoices(),
      isGM,
      wells: pools.map(pool => this.#wellContext(pool)),
      entries: visible.map(r => this.#entryContext(r)),
      logEmpty: records.length === 0,
      hasComplete: completeCount > 0,
      showComplete: this.showComplete,
      completeToggleLabel: t(this.showComplete ? "Log.HideComplete" : "Log.ShowComplete"),
      hiddenComplete,
      hiddenCompleteLabel: t("Log.HiddenComplete", { count: hiddenComplete }),
      selected: selected ? this.#selectedContext(selected) : null,
      etchings: selected ? this.#etchingChoices(selected) : [],
      etching: selected ? {
        name: etchingName(selected.data.etching),
        hint: etchingHint(selected.data.etching),
        superior: isEtched(selected.data.etching)
      } : null,
      gmUnlocked: selected ? this.gmUnlocked.has(selected.item.id) : false,
      chronicleOpen: this.chronicleOpen,
      dropHint: game.settings.get(MODULE_ID, "requireKeyword") && game.settings.get(MODULE_ID, "keyword")
        ? t("Forge.DropHintKeyword", { keyword: game.settings.get(MODULE_ID, "keyword") })
        : t("Forge.DropHintAny"),
      spellGroups: this.#spellbookContext(selected, pools),
      spellbookHint: !selected ? t("Spellbook.SelectFirst")
        : (selected.data.status === "complete" ? t("Spellbook.ItemComplete") : "")
    };
  }

  /** Characters this user may switch the window to; null when there is no choice to make */
  #crafterChoices() {
    const actors = game.actors.filter(a => canCraft(a) && a.isOwner && (a.type === "character"));
    if ( !actors.some(a => a.uuid === this.actor.uuid) ) actors.push(this.actor);
    if ( actors.length < 2 ) return null;
    return actors
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(a => ({ id: a.uuid, name: a.name, selected: a.uuid === this.actor.uuid }));
  }

  #wellContext(pool) {
    const label = pool.pact ? t("Wells.Pact") : ordinal(pool.level);
    const pips = Array.from({ length: Math.min(pool.max, MAX_PIPS) }, (_, i) => i < pool.value);
    const tooltip = pool.pact
      ? t("Wells.PactTooltip", { ordinal: ordinal(pool.level), value: pool.value, max: pool.max })
      : t("Wells.Tooltip", { label, value: pool.value, max: pool.max });
    return { label, pact: pool.pact, value: pool.value, pips, tooltip };
  }

  #entryContext({ item, data }) {
    return {
      id: item.id,
      name: item.name,
      img: item.img,
      etching: data.etching,
      etchingName: etchingName(data.etching),
      selected: item.id === this.selectedId,
      complete: data.status === "complete",
      statusLabel: t(`Status.${data.status}`),
      slots: data.slots.map(slot => ({
        ...slotProgress(slot),
        spell: slot.spell,
        // Core inserts data-tooltip as HTML, so player-chosen names go in escaped
        spellTooltip: esc(slot.spell?.name ?? ""),
        emptyLabel: t("Slot.Empty")
      }))
    };
  }

  #selectedContext({ item, data }) {
    const isGM = game.user.isGM;
    const locked = isLocked(data);
    const complete = data.status === "complete";
    const master = data.etching === ETCHING_MASTER;
    const overall = overallProgress(data);
    const castTotal = data.slots.reduce((n, s) => n + s.casts, 0);
    const status = complete ? "complete" : (locked ? "infusing" : "fresh");
    let summary = t("Summary.Fresh");
    if ( complete ) summary = t("Summary.Complete");
    else if ( locked ) summary = t("Summary.Infusing", { progress: overall.progress, required: overall.required });

    // Play the surge once, on the first render that shows the cast's new progress
    const surge = ((this._surge?.itemId === item.id) && !this._surge.played) ? this._surge : null;
    const slots = data.slots.map((slot, index) => {
      const p = slotProgress(slot);
      const hasCasts = (slot.progress > 0) || (slot.casts > 0);
      return {
        index,
        etching: data.etching,
        spell: slot.spell,
        ...p,
        label: master ? t("Slot.Numbered", { n: index + 1 }) : t("Slot.Single"),
        levelLabel: slot.spell ? levelLabel(slot.spell.level) : "",
        schoolLabel: slot.spell ? schoolLabel(slot.spell.school) : "",
        doubled: !!slot.spell && (etchingMultiplier(data.etching, slot.spell.school) > 1),
        doubledHint: t("Slot.Doubled", { etching: esc(etchingName(data.etching)) }),
        completeLabel: t("Slot.Complete"),
        emptyLabel: t("Slot.Empty"),
        emptyHint: t("Slot.EmptyHint"),
        progressText: slot.spell ? t("Slot.Progress", { progress: p.progress, required: p.required }) : t("Slot.ProgressEmpty"),
        canUnbind: !!slot.spell && !complete && (isGM || !hasCasts) && item.isOwner,
        unbindLabel: t("Slot.Unbind"),
        surge: (surge?.slot === index) && (p.pct === surge.expectPct)
      };
    });

    return {
      id: item.id,
      name: item.name,
      img: item.img,
      etching: data.etching,
      status,
      statusLabel: t(`Status.${status}`),
      summary,
      complete,
      master,
      locked,
      etchingFrozen: ((locked || complete) && !this.gmUnlocked.has(item.id)) || !item.isOwner,
      lockedNote: (isGM && this.gmUnlocked.has(item.id)) ? t("Etching.GMOverride") : t("Etching.LockedNote"),
      slots,
      castTotal,
      history: data.history.slice(-CHRONICLE_SHOWN).reverse().map(h => ({ when: formatWhen(h.at), text: chronicleText(h) })),
      historyNote: ((data.history.length > CHRONICLE_SHOWN) || (castTotal > data.history.length))
        ? t("Chronicle.Truncated", { shown: Math.min(data.history.length, CHRONICLE_SHOWN) })
        : "",
      canRemove: item.isOwner && !locked && !complete
    };
  }

  #etchingChoices({ item, data }) {
    const frozen = ((isLocked(data) || (data.status === "complete")) && !this.gmUnlocked.has(item.id)) || !item.isOwner;
    return ETCHINGS.map(key => ({
      key,
      name: etchingName(key),
      active: key === data.etching,
      disabled: frozen && (key !== data.etching)
    }));
  }

  /** Spells grouped by level, each with a button for every slot pool that can cast it */
  #spellbookContext(selected, pools) {
    const record = selected?.data ?? null;
    const canCast = !!record && (record.status !== "complete") && this.actor.isOwner && !isCasting(this.actor);
    const groups = new Map();
    for ( const spell of castableSpells(this.actor) ) {
      const snap = spellSnapshot(spell);
      const target = record ? findTargetSlot(record, snap) : null;
      const targetSlot = (target && (target.index >= 0)) ? record.slots[target.index] : null;
      // Once bound, a spell keeps the level and school it was bound at, whatever its sheet says now
      const basis = targetSlot?.spell ?? snap;
      const remaining = targetSlot?.spell ? slotProgress(targetSlot).remaining : requiredCasts(basis.level);
      const usable = pools.filter(p => p.level >= basis.level);
      const pills = usable.map(pool => {
        const gain = castValue({ spellLevel: basis.level, slotLevel: pool.level, etching: record?.etching, school: basis.school });
        let tooltip = t(pool.pact ? "Spellbook.PactPillTooltip" : "Spellbook.PillTooltip", {
          ordinal: ordinal(pool.level), value: pool.value, max: pool.max, gain
        });
        if ( record && (gain > remaining) ) tooltip += `<br><em>${t("Spellbook.Overflow", { gained: remaining })}</em>`;
        return {
          key: pool.key,
          spellId: spell.id,
          pact: pool.pact,
          label: pool.pact ? t("Spellbook.PactShort") : ordinal(pool.level),
          gain,
          tooltip,
          disabled: !canCast || !target || (target.index < 0) || (pool.value <= 0)
        };
      });
      let reason = "";
      if ( record?.status === "complete" ) reason = "";
      else if ( record && target && (target.index < 0) ) reason = t(`Spellbook.Reason.${target.reason}`);
      else if ( !usable.length || usable.every(p => p.value <= 0) ) reason = t("Spellbook.NoSlotsLeft");

      const level = snap.level;
      if ( !groups.has(level) ) groups.set(level, { level, label: spellLevelHeading(level), spells: [] });
      groups.get(level).spells.push({
        id: spell.id,
        name: spell.name,
        img: spell.img,
        school: snap.school,
        schoolLabel: schoolLabel(snap.school),
        doubled: !!record && (etchingMultiplier(record.etching, basis.school) > 1),
        doubledHint: record ? t("Slot.Doubled", { etching: esc(etchingName(record.etching)) }) : "",
        bound: !!target && (target.index >= 0) && !target.bind,
        boundLabel: t("Spellbook.BoundHere"),
        disabled: !!record && !!target && (target.index < 0),
        pills,
        reason
      });
    }
    return Array.from(groups.values());
  }

  /* -------------------------------------------- */
  /*  Rendering                                   */
  /* -------------------------------------------- */

  activateListeners(html) {
    super.activateListeners(html);
    const root = html[0];
    if ( !root ) return;
    root.addEventListener("click", this.#onClick.bind(this));
    root.querySelector(".sc-crafter-select")?.addEventListener("change", this.#onSwitchCrafter.bind(this));
    root.querySelector(".sc-chronicle")?.addEventListener("toggle", ev => { this.chronicleOpen = ev.currentTarget.open; });

    // Light up drop zones while something is dragged over them
    for ( const zone of root.querySelectorAll(".sc-drop") ) {
      zone.addEventListener("dragenter", () => zone.classList.add("drag-over"));
      zone.addEventListener("dragleave", ev => {
        if ( !zone.contains(ev.relatedTarget) ) zone.classList.remove("drag-over");
      });
    }

    // Let the bar of the slot that just took a cast grow from where it was
    const fill = this._surge ? root.querySelector(".sc-slot.sc-surge .sc-bar-fill") : null;
    if ( fill ) {
      this._surge.played = true;
      const to = fill.style.width;
      fill.style.transition = "none";
      fill.style.width = `${this._surge.fromPct}%`;
      void fill.offsetWidth;
      fill.style.transition = "";
      fill.style.width = to;
    }
  }

  _canDragStart() {
    return this.actor.isOwner;
  }

  _canDragDrop() {
    return this.actor.isOwner;
  }

  /** Spells in the spellbook can be dragged onto an infusion socket */
  _onDragStart(event) {
    const li = event.currentTarget.closest(".sc-spell");
    const spell = this.actor.items.get(li?.dataset.spellId);
    if ( !spell ) return;
    event.dataTransfer.setData("text/plain", JSON.stringify(spell.toDragData()));
  }

  async _onDrop(event) {
    // currentTarget is cleared once the event finishes dispatching, so read it before awaiting anything
    const zone = event.currentTarget;
    this.element[0]?.querySelectorAll(".drag-over").forEach(el => el.classList.remove("drag-over"));
    const data = TextEditor.getDragEventData(event);
    if ( (data?.type !== "Item") || !data.uuid ) return;
    try {
      const doc = await fromUuid(data.uuid);
      if ( !(doc instanceof Item) ) return;
      if ( doc.type === "spell" ) {
        if ( zone?.dataset.drop !== "slot" ) throw new InfusionError(this.selectedItem ? "spellNeedsSocket" : "noItemSelected");
        const item = this.selectedItem;
        if ( !item ) throw new InfusionError("noItemSelected");
        await bindSpellToSlot(this.actor, item, Number(zone.dataset.slot), doc);
        ui.notifications.info(t("Slot.Bound", { spell: esc(doc.name), item: esc(item.name) }));
        return;
      }
      if ( zone?.dataset.drop === "slot" ) throw new InfusionError("notSpell");
      const { item, added } = await addItem(this.actor, doc);
      this.selectedId = item.id;
      if ( added ) ui.notifications.info(t("Forge.Added", { item: esc(item.name) }));
      this.render();
    } catch(err) {
      report(err);
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  async #onClick(event) {
    const target = event.target.closest("[data-action]");
    if ( !target || (target.tagName === "SELECT") ) return;
    const action = target.dataset.action;
    if ( target.matches(":disabled") ) return;
    event.preventDefault();
    try {
      switch ( action ) {
        case "select":
          this.selectedId = target.dataset.itemId;
          return this.render();
        case "deselect":
          this.selectedId = null;
          return this.render();
        case "toggle-complete":
          this.showComplete = !this.showComplete;
          return this.render();
        case "open-item":
          return this.selectedItem?.sheet?.render(true);
        case "etching":
          return await this.#onEtching(target.dataset.etching);
        case "cast":
          return await this.#onCast(target.dataset.spellId, target.dataset.slotKey);
        case "unbind":
          return await this.#onUnbind(Number(target.dataset.slot));
        case "remove":
          return await this.#onRemove(false);
        case "gm-remove":
          return await this.#onRemove(true);
        case "gm-unlock":
          return this.#onToggleUnlock();
        case "gm-progress":
          return await this.#onEditProgress();
      }
    } catch(err) {
      report(err);
    }
  }

  #onSwitchCrafter(event) {
    const actor = fromUuidSync(event.currentTarget.value);
    if ( !actor || (actor.uuid === this.actor.uuid) ) return;
    StarforgeApp.open(actor);
    this.close();
  }

  async #onEtching(etching) {
    const item = this.selectedItem;
    if ( !item ) return;
    const force = game.user.isGM && this.gmUnlocked.has(item.id);
    await chooseEtching(item, etching, { force });
  }

  async #onCast(spellId, slotKey) {
    const item = this.selectedItem;
    const spell = this.actor.items.get(spellId);
    if ( !item || !spell ) return;

    // Check the cast before asking or spending anything
    const preview = previewCast(this.actor, item, spell, slotKey);
    if ( game.settings.get(MODULE_ID, "confirmCast") ) {
      const slot = preview.pool.pact
        ? `${t("Wells.Pact")} (${ordinal(preview.pool.level)})`
        : ordinal(preview.pool.level);
      const ok = await Dialog.confirm({
        title: t("Spellbook.ConfirmTitle", { spell: spell.name }),
        content: t("Spellbook.ConfirmContent", { slot, spell: esc(spell.name), item: esc(item.name), gain: preview.gained }),
        options: { classes: ["dialog", "starcrafting-dialog"] }
      });
      if ( ok !== true ) return;
    }

    // The slot spend and the record save each re-render the window; the surge waits for the save
    const before = slotProgress(getInfusion(item)?.slots[preview.index]);
    const surge = {
      itemId: item.id,
      slot: preview.index,
      fromPct: before.pct,
      expectPct: slotProgress(preview.data.slots[preview.index]).pct,
      played: false
    };
    this._surge = surge;
    let cast = null;
    try {
      cast = await castInto(this.actor, item, spell, slotKey);
    } finally {
      if ( !cast && (this._surge === surge) ) this._surge = null;
    }
    if ( !cast ) return;
    // No render here: the updateActor/updateItem hooks already queue one, and a second would cut the surge short
    setTimeout(() => {
      if ( this._surge === surge ) this._surge = null;
    }, 2000);
  }

  async #onUnbind(index) {
    const item = this.selectedItem;
    const data = getInfusion(item);
    const slot = data?.slots[index];
    if ( !slot?.spell ) return;
    if ( (slot.progress > 0) || (slot.casts > 0) ) {
      const ok = await Dialog.confirm({
        title: t("GM.UnbindTitle"),
        content: t("GM.UnbindContent", { spell: esc(slot.spell.name), progress: slot.progress }),
        defaultYes: false,
        options: { classes: ["dialog", "starcrafting-dialog"] }
      });
      if ( ok !== true ) return;
    }
    await unbindSlot(item, index);
    ui.notifications.info(t("Slot.Unbound", { spell: esc(slot.spell.name), item: esc(item.name) }));
  }

  async #onRemove(asGM) {
    const item = this.selectedItem;
    if ( !item ) return;
    const ok = await Dialog.confirm({
      title: t(asGM ? "GM.RemoveTitle" : "Forge.RemoveTitle"),
      content: t(asGM ? "GM.RemoveContent" : "Forge.RemoveContent", { item: esc(item.name) }),
      defaultYes: false,
      options: { classes: ["dialog", "starcrafting-dialog"] }
    });
    if ( ok !== true ) return;
    await removeFromLog(item);
    this.gmUnlocked.delete(item.id);
    this.selectedId = null;
    ui.notifications.info(t("Forge.Removed", { item: esc(item.name) }));
    this.render();
  }

  #onToggleUnlock() {
    const item = this.selectedItem;
    if ( !item || !game.user.isGM ) return;
    if ( this.gmUnlocked.has(item.id) ) this.gmUnlocked.delete(item.id);
    else this.gmUnlocked.add(item.id);
    this.render();
  }

  async #onEditProgress() {
    const item = this.selectedItem;
    const data = getInfusion(item);
    if ( !data || !game.user.isGM ) return;
    const rows = data.slots.map((slot, i) => {
      if ( !slot.spell ) return "";
      const required = requiredCasts(slot.spell.level);
      return `<div class="sc-dialog-row">
        <img src="${esc(slot.spell.img)}" alt="">
        <label for="sc-progress-${i}">${esc(slot.spell.name)}</label>
        <input id="sc-progress-${i}" type="number" name="slot-${i}" min="0" max="${required}" step="1" value="${slot.progress}" data-original="${slot.progress}">
        <span class="sc-of">/ ${required}</span>
      </div>`;
    }).join("");
    if ( !rows ) return ui.notifications.warn(t("Error.noSuchSlot"));
    const values = await Dialog.wait({
      title: t("GM.EditTitle", { item: item.name }),
      content: `<p class="sc-dialog-hint">${t("GM.EditHint")}</p>${rows}`,
      buttons: {
        save: {
          icon: '<i class="fas fa-check"></i>',
          label: t("GM.Save"),
          // Only fields the GM changed: an untouched value would undo casts made while the dialog was open
          callback: html => data.slots.map((_, i) => {
            const input = html[0].querySelector(`[name="slot-${i}"]`);
            const raw = input?.value.trim() ?? "";
            if ( !raw || (raw === input.dataset.original) ) return NaN;
            return Number(raw);
          })
        },
        cancel: { icon: '<i class="fas fa-xmark"></i>', label: t("GM.Cancel"), callback: () => null }
      },
      default: "save",
      close: () => null
    }, { classes: ["dialog", "starcrafting-dialog"], width: 380 });
    if ( !Array.isArray(values) ) return;
    await setAllProgress(this.actor, item, values);
  }
}

/** In-progress items first, then fully infused; within each, the most recently worked on first */
function compareRecords(a, b) {
  const done = (a.data.status === "complete") - (b.data.status === "complete");
  if ( done ) return done;
  return lastActivity(b.data) - lastActivity(a.data);
}

function lastActivity(data) {
  return data.history.at(-1)?.at || data.started || 0;
}

/** One chronicle line as plain text; the template escapes it */
function chronicleText(entry) {
  if ( entry.gm ) {
    return t("Chronicle.EntryGM", { who: entry.byName || "GM", spell: entry.spell, progress: entry.progress });
  }
  return t(entry.slotKey === "pact" ? "Chronicle.EntryPact" : "Chronicle.Entry", {
    who: entry.byName ?? "",
    spell: entry.spell,
    slot: ordinal(entry.slotLevel),
    value: entry.value
  });
}
