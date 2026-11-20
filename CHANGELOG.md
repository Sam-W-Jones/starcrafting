# Changelog

## 1.1.1

- Fixed: spells that weren't ticked as prepared vanished from the Starforge without explanation. This hit spells added after character creation (dnd5e leaves them unticked) and every spell of known-spell casters such as sorcerers.
- Known-spell casters now count all their spells as prepared. Any class or subclass with a "spells-known" scale (as dnd5e's sorcerer and warlock have) is detected automatically, and the new GM setting "Classes that know their spells" lists others (bard, ranger, sorcerer, warlock, Eldritch Knight and Arcane Trickster by default), matched by identifier or name. Multiclass spells follow their own class when dnd5e 3.3+ has recorded it.
- Spells that can't be infused are now listed dimmed with the reason (not prepared, or innate, at-will and ritual-only spells that don't use slots) instead of being left out. The eye button in the spellbook header hides them.
- Which preparation modes use spell slots is read from dnd5e's own config on 3.1+.
- Trying to bind an un-infusable spell now gives the actual reason.

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
