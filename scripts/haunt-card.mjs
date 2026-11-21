import { MODULE_ID, gmUserIds } from "./util.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/haunt-card.hbs`;

/** Whisper the GM and Assistant GMs a card describing the manifestation. */
export async function postHauntCard(haunt, noticed) {
  const content = await foundry.applications.handlebars.renderTemplate(TEMPLATE, {
    name: haunt.displayName,
    cr: haunt.cr,
    casterLevel: haunt.casterLevel,
    noticeDC: haunt.noticeDC,
    initiative: haunt.initiative,
    persistent: haunt.persistent,
    hp: haunt.hp,
    hpMax: haunt.hpMax,
    effect: await enrich(haunt.effect),
    destruction: await enrich(haunt.destruction),
    weakness: haunt.weakness,
    resetText: haunt.resetText,
    noticed
  });
  return ChatMessage.implementation.create({
    content,
    whisper: gmUserIds(),
    speaker: { alias: "Hauntomatic" },
    flags: { [MODULE_ID]: { hauntUuid: haunt.parent.uuid } }
  });
}

function enrich(html) {
  return foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { secrets: true });
}

/* ---------------------------------------- */

/** Prompt for positive energy damage. Returns a number or null. */
export async function promptPositiveEnergy(haunt) {
  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: `Positive energy: ${haunt.displayName}` },
    content: `<div class="form-group"><label>Damage (haunt has ${haunt.hp}/${haunt.hpMax} HP)</label>
      <input type="number" name="amount" min="0" step="1" value="0" autofocus></div>`,
    ok: { label: "Apply", callback: (event, button) => button.form.elements.amount.valueAsNumber },
    rejectClose: false
  });
  return Number.isFinite(result) ? result : null;
}

/** Run a named action against a haunt behavior (shared by the chat card and the panel). */
export async function runHauntAction(behavior, action) {
  if ( !game.user.isGM ) return;
  const haunt = behavior?.system;
  if ( !haunt ) return ui.notifications.warn("Hauntomatic: that haunt no longer exists.");
  switch ( action ) {
    case "positive": {
      const amount = await promptPositiveEnergy(haunt);
      if ( amount !== null ) await haunt.applyPositiveEnergy(amount);
      break;
    }
    case "neutralize": await haunt.neutralize(); break;
    case "destroy": await haunt.markDestroyed(); break;
    case "rearm": await haunt.rearm(); break;
    case "manifest": await haunt.manifest(); break;
    case "configure": behavior.sheet.render({ force: true }); break;
  }
}

/** Bind the card buttons. Hook: renderChatMessageHTML (v13, html is an HTMLElement). */
export function onRenderChatMessageHTML(message, html) {
  const hauntUuid = message.getFlag(MODULE_ID, "hauntUuid");
  if ( !hauntUuid ) return;
  const buttons = html.querySelectorAll("[data-agm-action]");
  if ( !game.user.isGM ) return buttons.forEach(b => b.remove());
  for ( const button of buttons ) {
    button.addEventListener("click", async event => {
      event.preventDefault();
      const behavior = await fromUuid(hauntUuid);
      await runHauntAction(behavior, button.dataset.agmAction);
    });
  }
}
