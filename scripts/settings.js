import { MODULE_ID } from "./constants.js";

/** @param {Function} onChange  Called when a setting that affects the Starforge display changes */
export function registerSettings(onChange) {
  game.settings.register(MODULE_ID, "requireMundane", {
    name: "STARCRAFTING.Settings.RequireMundane.Name",
    hint: "STARCRAFTING.Settings.RequireMundane.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange
  });

  game.settings.register(MODULE_ID, "castChat", {
    name: "STARCRAFTING.Settings.CastChat.Name",
    hint: "STARCRAFTING.Settings.CastChat.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      public: "STARCRAFTING.Settings.CastChat.Public",
      gm: "STARCRAFTING.Settings.CastChat.GM",
      off: "STARCRAFTING.Settings.CastChat.Off"
    },
    default: "public"
  });

  game.settings.register(MODULE_ID, "completeChat", {
    name: "STARCRAFTING.Settings.CompleteChat.Name",
    hint: "STARCRAFTING.Settings.CompleteChat.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      public: "STARCRAFTING.Settings.CompleteChat.Public",
      gm: "STARCRAFTING.Settings.CompleteChat.GM"
    },
    default: "public"
  });

  game.settings.register(MODULE_ID, "confirmCast", {
    name: "STARCRAFTING.Settings.ConfirmCast.Name",
    hint: "STARCRAFTING.Settings.ConfirmCast.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false
  });
}
