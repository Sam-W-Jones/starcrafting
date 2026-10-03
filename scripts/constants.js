export const MODULE_ID = "starcrafting";

/** Item flag key that holds an item's infusion record: flags.starcrafting.infusion */
export const FLAG = "infusion";

/** Version of the infusion record shape, so future releases can migrate old records */
export const DATA_VERSION = 1;

/** Casts needed per spell level: a 1st-level spell takes 15, a 2nd-level spell 30, and so on */
export const CASTS_PER_LEVEL = 15;

/** Keep at most this many entries in an item's cast chronicle */
export const HISTORY_LIMIT = 100;

/** The eight schools of magic, as dnd5e keys them */
export const SCHOOLS = ["abj", "con", "div", "enc", "evo", "ill", "nec", "trs"];

export const ETCHING_NONE = "none";
export const ETCHING_MASTER = "mastercrafted";

/** Every etching in the order the picker shows them */
export const ETCHINGS = [ETCHING_NONE, ...SCHOOLS, ETCHING_MASTER];

/** Fallback school names, used only if the game system does not supply its own */
export const SCHOOL_FALLBACK_LABELS = {
  abj: "Abjuration",
  con: "Conjuration",
  div: "Divination",
  enc: "Enchantment",
  evo: "Evocation",
  ill: "Illusion",
  nec: "Necromancy",
  trs: "Transmutation"
};

export const TEMPLATES = {
  app: `modules/${MODULE_ID}/templates/starforge.hbs`,
  logEntry: `modules/${MODULE_ID}/templates/parts/log-entry.hbs`,
  infusionSlot: `modules/${MODULE_ID}/templates/parts/infusion-slot.hbs`,
  chatCast: `modules/${MODULE_ID}/templates/chat-cast.hbs`,
  chatComplete: `modules/${MODULE_ID}/templates/chat-complete.hbs`
};
