import { MODULE_ID, TEMPLATES } from "./constants.js";
import { etchingMultiplier, slotProgress } from "./infusion.js";
import { esc, etchingName, isEtched, levelLabel, ordinal, t } from "./util.js";

/**
 * Who should see a card: everyone, or just the crafter's owners and the GMs.
 * The owners are looked up from the actor, so a card posted by the GM still reaches the player.
 */
function whisperFor(mode, actor) {
  if ( mode !== "gm" ) return [];
  const ids = new Set(ChatMessage.getWhisperRecipients("GM").map(u => u.id));
  for ( const user of game.users ?? [] ) {
    if ( !user.isGM && actor?.testUserPermission?.(user, "OWNER") ) ids.add(user.id);
  }
  ids.add(game.user.id);
  return Array.from(ids);
}

async function post(actor, item, content, mode, type) {
  return ChatMessage.create({
    user: game.user.id,
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    type: CONST.CHAT_MESSAGE_TYPES?.OTHER ?? 0,
    whisper: whisperFor(mode, actor),
    flags: { [MODULE_ID]: { card: type, itemUuid: item.uuid } }
  });
}

/**
 * A card for one cast into an item.
 * @param {object} args
 * @param {Actor} args.actor
 * @param {Item} args.item
 * @param {object} args.data      The infusion record after the cast
 * @param {number} args.index     Which slot the cast went into
 * @param {object} args.pool      The spell-slot pool that was spent
 * @param {number} args.gained    Progress the cast added
 */
export async function postCastCard({ actor, item, data, index, pool, gained }) {
  const mode = game.settings.get(MODULE_ID, "castChat");
  if ( mode === "off" ) return;
  const slot = data.slots[index];
  const progress = slotProgress(slot);
  const doubled = etchingMultiplier(data.etching, slot.spell.school) > 1;
  const content = await renderTemplate(TEMPLATES.chatCast, {
    etching: data.etching,
    item: { name: item.name, img: item.img },
    spell: slot.spell,
    line: t(pool.pact ? "Chat.CastLinePact" : "Chat.CastLine", {
      actor: esc(actor.name),
      spell: esc(slot.spell.name),
      item: esc(item.name),
      slot: ordinal(pool.level)
    }) + (progress.complete ? ` <strong>${t("Chat.SlotDone", { spell: esc(slot.spell.name) })}</strong>` : ""),
    pct: progress.pct,
    progress: progress.progress,
    required: progress.required,
    progressText: t("Chat.Progress", { progress: progress.progress, required: progress.required, pct: Math.floor(progress.pct) }),
    bonus: doubled ? t("Chat.BonusDoubled", { gain: gained, etching: etchingName(data.etching) }) : t("Chat.Bonus", { gain: gained })
  });
  return post(actor, item, content, mode, "cast");
}

/** The announcement when every slot of an item is full */
export async function postCompleteCard({ actor, item, data }) {
  const mode = game.settings.get(MODULE_ID, "completeChat");
  const content = await renderTemplate(TEMPLATES.chatComplete, {
    etching: data.etching,
    item: { name: item.name, img: item.img },
    line: t("Chat.CompleteLine", { item: esc(item.name), actor: esc(actor.name) }),
    spells: data.slots.filter(s => s.spell).map(s => ({ name: s.spell.name, img: s.spell.img, levelLabel: levelLabel(s.spell.level) })),
    etchingName: isEtched(data.etching) ? etchingName(data.etching) : "",
    superior: isEtched(data.etching)
  });
  return post(actor, item, content, mode, "complete");
}
