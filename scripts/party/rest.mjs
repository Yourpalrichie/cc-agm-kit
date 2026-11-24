// Party rest: run PF1's own rest (the same as each sheet's Rest button) for every chosen member, then post one summary.
// Sanity isn't touched; Horror Adventures recovery needs 7 days of rest and lives in the sanity tracker.
import { MODULE_ID } from "../util.mjs";

const { DialogV2 } = foundry.applications.api;

function hpText(actor) {
  const hp = actor.system.attributes?.hp;
  return hp ? `${hp.value}/${hp.max}` : "";
}

/**
 * Ask for rest options, then rest the party.
 * @param {Actor} party
 */
export async function restPartyDialog(party) {
  if ( !game.user.isGM ) return ui.notifications.warn("Party: only the GM can rest the party.");
  const actors = party.system.actors;
  if ( !actors.length ) return ui.notifications.warn("Party: no members to rest.");

  const memberList = actors.map((a) => `
    <label class="checkbox"><input type="checkbox" name="member.${a.id}" checked> ${foundry.utils.escapeHTML(a.name)}
      <small>(${hpText(a)} HP)</small></label>`).join("");

  const result = await DialogV2.prompt({
    window: { title: `Rest: ${party.name}`, icon: "fa-solid fa-bed" },
    position: { width: 420 },
    content: `
      <div class="agm-party-rest">
        <div class="form-group"><label>Hours</label><input type="number" name="hours" value="8" min="1" step="1"></div>
        <label class="checkbox"><input type="checkbox" name="restoreHealth" checked> Restore hit points and ability damage</label>
        <label class="checkbox"><input type="checkbox" name="longTermCare"> Long-term care (Heal skill, doubles healing)</label>
        <label class="checkbox"><input type="checkbox" name="restoreDailyUses" checked> Restore spells and daily uses</label>
        <label class="checkbox"><input type="checkbox" name="advanceTime"> Advance world time by the hours rested</label>
        <h4>Who rests</h4>
        ${memberList}
        <p class="hint">Uses PF1's own rest, same as each character sheet's Rest button. Sanity isn't changed.</p>
      </div>`,
    ok: {
      label: "Rest",
      icon: "fa-solid fa-bed",
      callback: (event, button) => {
        const data = new foundry.applications.ux.FormDataExtended(button.form).object;
        return foundry.utils.expandObject(data);
      }
    },
    rejectClose: false
  });
  if ( !result ) return;

  const hours = Math.max(1, Math.floor(Number(result.hours) || 8));
  const memberIds = Object.entries(result.member ?? {}).filter(([, on]) => on).map(([id]) => id);
  return restParty(party, {
    hours,
    restoreHealth: !!result.restoreHealth,
    longTermCare: !!result.longTermCare,
    restoreDailyUses: !!result.restoreDailyUses,
    advanceTime: !!result.advanceTime,
    memberIds
  });
}

/**
 * Rest the chosen members and post a summary card.
 * @param {Actor} party
 * @param {object} options  PF1 performRest options plus memberIds and advanceTime.
 */
export async function restParty(party, { hours = 8, restoreHealth = true, longTermCare = false, restoreDailyUses = true,
  advanceTime = false, memberIds } = {}) {
  const actors = party.system.actors.filter((a) => !memberIds || memberIds.includes(a.id));
  if ( !actors.length ) return ui.notifications.warn("Party: nobody picked to rest.");

  const rows = [];
  for ( const actor of actors ) {
    const before = hpText(actor);
    try {
      await actor.performRest({ hours, restoreHealth, longTermCare, restoreDailyUses });
      rows.push({ name: actor.name, img: actor.img, before, after: hpText(actor) });
    } catch(err) {
      console.error(`${MODULE_ID} | rest failed for ${actor.name}`, err);
      rows.push({ name: actor.name, img: actor.img, error: true });
    }
  }
  if ( advanceTime ) await game.time.advance(hours * 3600);

  const what = [restoreHealth && (longTermCare ? "HP (long-term care)" : "HP"), restoreDailyUses && "spells and daily uses"]
    .filter(Boolean).join(", ") || "nothing restored";
  const list = rows.map((r) => `<li><img src="${r.img}" alt=""><span class="apr-name">${foundry.utils.escapeHTML(r.name)}</span>`
    + (r.error ? `<span class="apr-note">rest failed</span>`
      : `<span class="apr-note">${r.before === r.after ? `${r.after} HP` : `${r.before} → <strong>${r.after}</strong> HP`}</span>`)
    + `</li>`).join("");
  return ChatMessage.implementation.create({
    content: `<div class="agm-party-roll">
      <header><i class="fa-solid fa-bed"></i> <strong>${foundry.utils.escapeHTML(party.name)}</strong> rests ${hours} hour${hours === 1 ? "" : "s"}</header>
      <div class="apr-summary">Restored: ${what}${advanceTime ? ". World time advanced." : ""}</div>
      <ul>${list}</ul></div>`,
    speaker: ChatMessage.getSpeaker({ actor: party }),
    flags: { [MODULE_ID]: { partyRest: { partyId: party.id, hours } } }
  });
}
