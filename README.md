# Starcrafting: The Starforge

[![CI](https://github.com/Sam-W-Jones/starcrafting/actions/workflows/ci.yml/badge.svg)](https://github.com/Sam-W-Jones/starcrafting/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/Sam-W-Jones/starcrafting)](https://github.com/Sam-W-Jones/starcrafting/releases/latest)
![Foundry v11](https://img.shields.io/badge/Foundry-v11-orange)
![dnd5e](https://img.shields.io/badge/dnd5e-2.x%20%7C%203.x-red)

A Foundry VTT v11 module for D&D 5e (dnd5e 2.x and 3.x) that lets players infuse **unenchanted starsteel items** with their prepared spells, over as many sessions as it takes.

## Installation

1. In Foundry's setup screen, open **Add-on Modules** and click **Install Module**.
2. Paste this into **Manifest URL** and click **Install**:

   ```
   https://github.com/Sam-W-Jones/starcrafting/releases/latest/download/module.json
   ```

3. In your world, go to **Game Settings → Manage Modules** and enable **Starcrafting: The Starforge**.

New versions show up in Foundry's **Update** button on the Add-on Modules tab.

## Opening the Starforge

- **Character sheet:** the hammer button in the sheet's title bar. On the dnd5e 3.x sheet it is an icon with a "Starforge" tooltip.
- **Token controls:** the hammer tool in the left-hand token controls. Foundry only runs these while a scene is active.
- **Inventory right-click:** choose *Infuse in the Starforge* on a starsteel item.
- **Macro:** `game.modules.get("starcrafting").api.open()`. Pass an actor to open a particular crafter's forge: `Starcrafting.open(game.actors.getName("Aria"))`.

With no actor given, the forge opens for the first token you control that you own. If there isn't one, it uses your assigned character. Failing that, it asks which character to use.

## Crafting

1. **Place an item.** Drag an item from your character's inventory into the forge. By default its name must contain "Starsteel" (the GM can change the keyword), and it can't already be enchanted, meaning it doesn't have dnd5e's Magical property. The item now appears in your **Crafting Log**.
2. **Choose a runic etching.** Each item can bear one etching, and you can change it until the first spell is cast into the item:
   - **No etching:** every cast counts normally.
   - **School etchings** (Abjuration, Conjuration, Divination, Enchantment, Evocation, Illusion, Necromancy, Transmutation): spells of that school count **double**. Etched items may have superior effects when fully infused.
   - **Mastercrafted:** the item holds **two** different spells, each with its own socket and progress bar.
3. **Cast spells into it.** Your spellbook lists your prepared spells of 1st level and up: prepared, always prepared and pact spells. Each spell has a button for every slot level that can cast it, and each button shows how much progress it adds. Clicking one spends that slot. The first cast binds the spell to the item's socket; you can also drag a spell onto a socket to bind it without casting.

### How much progress a cast adds

| | |
|---|---|
| Casts needed | 15 × the spell's level (1st = 15, 2nd = 30, … 9th = 135) |
| One cast | 1, plus 1 for every level the slot is above the spell's level |
| Matching school etching | the cast counts double |

For example, a 1st-level *Shield* cast with a 3rd-level slot adds 3. Into an Abjuration-etched item it adds 6. Progress stops at what the socket needs, and anything over that on the final cast is lost.

An item is **fully infused** once every socket is full. The log marks it with a gold star and a chat card announces it. The module does not change the item itself; the GM decides what an infused item can do.

## The Crafting Log

Every item in your log shows its icon, its etching rune, the spell in each socket (with that spell's icon) and a progress bar. Click an entry to open it in the forge. There you can see its etching, its sockets and a chronicle of its casts. The item keeps its last 100 entries, and the forge shows the newest 40. The star button in the log header hides or shows fully infused items.

Progress is stored on the item itself (`flags.starcrafting.infusion`), so it lasts between sessions and goes with the item if it changes hands.

## GM tools

When an item is open in the forge, the GM sees these extra controls:

- **Edit progress:** set any socket's casts directly. Filling every socket completes the item.
- **Unlock etching:** change an etching after casts have been made.
- **Remove:** take an item out of the log and erase its progress.
- **Unbind** a socket even after casts have gone into it.

Players can unbind a spell, or take an item out of the log, only before any casts have been made.

## Settings

| Setting | Scope | Default |
|---|---|---|
| Starsteel keyword | World | `Starsteel` |
| Only starsteel items (turn off to allow any physical item) | World | On |
| Only unenchanted items (refuse items with the Magical property) | World | On |
| Chat card for each cast (everyone / crafter and GM / none) | World | Everyone |
| Chat card when an item is complete (everyone / crafter and GM) | World | Everyone |
| Confirm before spending a slot | Client | Off |

## Notes

- A cast spends a slot exactly as dnd5e does (`system.spells.spellN.value` or `system.spells.pact.value`), so long rests restore slots as usual. A pact slot always casts at your pact level.
- Casting into an item doesn't roll damage, place templates or start concentration. It records the infusion and posts a chat card.
- A bound spell keeps the level and school it was bound at. Renaming the spell on your sheet doesn't break the binding.
- An item with a quantity greater than 1 shares one infusion across the whole stack. dnd5e also merges dropped consumables with an existing matching stack, which discards the dropped copy's infusion. Infuse single items where you can.

## Compatibility

- Foundry VTT v11. Developed against 11.315.
- dnd5e 2.x and 3.x. Developed against 3.0.4.

## Development

The module needs no build step: Foundry loads `scripts/`, `templates/`, `styles/`, `lang/` and `assets/` as they are.

| Path | What it holds |
|---|---|
| `scripts/infusion.js` | The infusion rules (casts needed, cast value, etchings, sockets). Pure functions with no Foundry calls. |
| `scripts/system.js` | Everything that reads or writes dnd5e data: spells, slot pools, spending slots. |
| `scripts/forge.js` | The crafting actions: rule checks, saving the item's record, chat cards. |
| `scripts/app.js` | The Starforge window. |
| `scripts/main.js` | Hooks, entry points and the `Starcrafting` API. |
| `tests/` | Unit and integration tests, run with Node (no Foundry needed). |

Run the tests with Node 18 or newer:

```bash
npm test
```

The `package.json`, `tests/` and `.github/` folders are development tooling only. They are left out of the release zip.

### Releasing

1. Update `CHANGELOG.md` and the `version` in `module.json`.
2. Commit, then tag and push:

   ```bash
   git tag v1.1.0
   git push origin main v1.1.0
   ```

The **Release** workflow then runs the tests, sets the version and download link in `module.json` from the tag, builds `module.zip` and publishes a GitHub release with both files. The **CI** workflow runs the same checks on every push and pull request.

## License

[MIT](LICENSE)
