import { MODULE_ID, TEMPLATES } from "./constants.js";
import { StarforgeApp } from "./app.js";
import { registerSettings } from "./settings.js";
import { canCraft, isPhysicalItem, isStarsteel } from "./system.js";
import { addItem, getInfusion, hasInfusion, loggedItems } from "./forge.js";
import { castValue, requiredCasts } from "./infusion.js";
import { esc, report, t } from "./util.js";

Hooks.once("init", () => {
  registerSettings(() => StarforgeApp.refreshAll());
  // Partials must be preloaded; the chat cards are too, so the first cast doesn't wait on a fetch
  loadTemplates([TEMPLATES.logEntry, TEMPLATES.infusionSlot, TEMPLATES.chatCast, TEMPLATES.chatComplete]);

  const api = {
    /** Open the Starforge: for the given actor, or else the user's controlled token or assigned character */
    open: openStarforge,
    /** The infusion record on an item, or null */
    getInfusion,
    /** Items in an actor's crafting log */
    loggedItems,
    requiredCasts,
    castValue,
    StarforgeApp
  };
  game.modules.get(MODULE_ID).api = api;
  globalThis.Starcrafting = api;
});

/* -------------------------------------------- */
/*  Ways in                                     */
/* -------------------------------------------- */

// A button in the header of every actor sheet the user owns. On dnd5e 3.x sheets it shows as an icon with a tooltip.
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
  const actor = sheet.document ?? sheet.actor;
  if ( !canCraft(actor) || !actor.isOwner ) return;
  buttons.unshift({
    label: "STARCRAFTING.OpenButton",
    class: "starcrafting-open",
    icon: "fas fa-hammer",
    onclick: () => StarforgeApp.open(actor)
  });
});

// "Infuse in the Starforge" in the right-click menu of dnd5e inventory rows
Hooks.on("dnd5e.getItemContextOptions", (item, menuItems) => {
  const actor = item?.actor;
  if ( !canCraft(actor) || !item.isOwner || !isPhysicalItem(item) ) return;
  if ( !hasInfusion(item) && !isStarsteel(item) ) return;
  menuItems.push({
    name: "STARCRAFTING.SendToForge",
    icon: '<i class="fas fa-hammer"></i>',
    callback: async () => {
      try {
        const { item: placed } = await addItem(actor, item);
        StarforgeApp.open(actor, { itemId: placed.id });
      } catch(err) {
        report(err);
      }
    }
  });
});

// A button in the token controls (only usable while a scene is active)
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.find(c => c.name === "token");
  if ( !tokens ) return;
  tokens.tools.push({
    name: "starforge",
    title: "STARCRAFTING.SceneControl",
    icon: "fas fa-hammer",
    button: true,
    visible: true,
    onClick: () => openStarforge()
  });
});

/* -------------------------------------------- */
/*  Keep open windows up to date                */
/* -------------------------------------------- */

for ( const hook of ["createItem", "updateItem", "deleteItem"] ) {
  Hooks.on(hook, item => {
    if ( item.parent ) StarforgeApp.refreshFor(item.parent);
  });
}
Hooks.on("updateActor", actor => StarforgeApp.refreshFor(actor));
Hooks.on("deleteActor", actor => closeWhere(app => app.actor.uuid === actor.uuid));
// An unlinked token's actor has no deleteActor of its own: it goes when its token or scene does
Hooks.on("deleteToken", token => closeWhere(app => app.actor.uuid.startsWith(`${token.uuid}.`)));
Hooks.on("deleteScene", scene => closeWhere(app => app.actor.uuid.startsWith(`${scene.uuid}.`)));

function closeWhere(test) {
  for ( const app of Array.from(StarforgeApp.instances.values()) ) {
    if ( test(app) ) app.close({ force: true });
  }
}

/* -------------------------------------------- */
/*  Choosing a crafter                          */
/* -------------------------------------------- */

/**
 * Open the Starforge. With no actor given, use the first controlled token the user owns,
 * then their assigned character, and otherwise ask which character to use.
 * @param {Actor|string} [actorOrUuid]
 */
export async function openStarforge(actorOrUuid) {
  let actor = (typeof actorOrUuid === "string") ? fromUuidSync(actorOrUuid) : actorOrUuid;
  if ( !actor ) {
    const controlled = canvas?.ready ? (canvas.tokens?.controlled ?? []) : [];
    actor = controlled.map(token => token.actor).find(a => canCraft(a) && a.isOwner) ?? null;
  }
  if ( !actor && canCraft(game.user.character) ) actor = game.user.character;
  if ( !actor ) actor = await pickCrafter();
  if ( !actor ) {
    ui.notifications.warn(t("NoCrafter"));
    return null;
  }
  if ( !actor.isOwner ) {
    ui.notifications.warn(t("Error.noPermission"));
    return null;
  }
  return StarforgeApp.open(actor);
}

/** Ask which character to open the Starforge for. Skips the question when there is only one choice. */
async function pickCrafter() {
  const choices = game.actors
    .filter(a => canCraft(a) && a.isOwner && (a.type === "character"))
    .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
  if ( !choices.length ) return null;
  if ( choices.length === 1 ) return choices[0];
  const tiles = choices.map((a, i) => `
    <label>
      <input type="radio" name="crafter" value="${esc(a.uuid)}"${i === 0 ? " checked" : ""}>
      <img src="${esc(a.img)}" alt="">
      <span>${esc(a.name)}</span>
    </label>`).join("");
  const uuid = await Dialog.wait({
    title: t("ChooseCrafter"),
    content: `<p class="sc-dialog-hint">${t("ChooseCrafterHint")}</p><div class="sc-crafter-pick">${tiles}</div>`,
    buttons: {
      open: {
        icon: '<i class="fas fa-hammer"></i>',
        label: t("Open"),
        callback: html => html[0].querySelector("input[name=crafter]:checked")?.value ?? null
      }
    },
    default: "open",
    close: () => null
  }, { classes: ["dialog", "starcrafting-dialog"], width: 420 });
  return uuid ? fromUuidSync(uuid) : null;
}
