# Changelog

## 1.1.0

- Any physical item can now go into the Starforge. Starsteel is no longer required, so infusable materials (such as the right wood) are left to the table.
- The "Starsteel keyword" and "Only starsteel items" settings are gone. "Only unenchanted items" still refuses items with dnd5e's Magical property, and can be turned off.
- The forge, chat cards and messages no longer assume the item is starsteel. Cast cards now name the item being infused.

## 1.0.0

First release.

- The Starforge window: a crafting log, the anvil (item, runic etching and spell sockets) and a spellbook with one button per usable slot level.
- Infusion rules: 15 casts per spell level. Each slot level above the spell's adds one more cast. A school etching doubles casts of its school. Mastercrafted items hold two spells.
- Casting spends real dnd5e spell slots (including pact slots) and posts a themed chat card. Completed items are announced in chat.
- Runic etchings for all eight schools plus Mastercrafted. An etching can be changed until the first cast, and after that only by the GM.
- GM tools: edit progress, unlock an etching, unbind a socket, remove an item from the log.
- Ways to open it: actor sheet header button, token controls, an inventory right-click entry, and `Starcrafting.open()` for macros.
- Settings: the starsteel keyword, starsteel-only, unenchanted-only, chat card visibility and confirm-before-cast.
