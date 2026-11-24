// Group rolls: roll one skill, save or ability check for every chosen member and post a single chat card.
import { MODULE_ID } from "../util.mjs";

// Skills that are really a family of sub-skills (Craft, Perform, Profession, Artistry, Lore). Each PC has
// different ones, so a group roll of the parent doesn't mean much. Left out of the list for now.
const FAMILY_SKILLS = new Set(["crf", "prf", "pro", "art", "lor"]);

/** Choices for the roll picker, grouped. Keys look like "skill:per", "save:will", "ability:str". */
export function rollChoices() {
  const cfg = pf1.config;
  const sorted = (obj) => Object.entries(obj).sort((a, b) => a[1].localeCompare(b[1]));
  return [
    {
      group: "Skills",
      options: sorted(cfg.skills).filter(([id]) => !FAMILY_SKILLS.has(id)).map(([id, label]) => ({ key: `skill:${id}`, label }))
    },
    { group: "Saving throws", options: Object.entries(cfg.savingThrows).map(([id, label]) => ({ key: `save:${id}`, label })) },
    { group: "Ability checks", options: Object.entries(cfg.abilities).map(([id, label]) => ({ key: `ability:${id}`, label })) }
  ];
}

export function choiceLabel(key) {
  const [kind, id] = key.split(":");
  const cfg = pf1.config;
  const label = { skill: cfg.skills, save: cfg.savingThrows, ability: cfg.abilities }[kind]?.[id] ?? id;
  return kind === "ability" ? `${label} check` : label;
}

/** A Roll from whatever PF1 hands back with chatMessage: false (message data, a message, or a roll). */
function extractRoll(result) {
  if ( !result ) return null;
  if ( result instanceof Roll ) return result;
  const r = result.rolls?.[0];
  if ( !r ) return null;
  if ( r instanceof Roll ) return r;
  return Roll.fromData(typeof r === "string" ? JSON.parse(r) : r);
}

/** Trained-only skill this actor has no ranks in. PF1 doesn't allow the check. */
function cannotAttempt(actor, kind, id) {
  if ( kind !== "skill" ) return false;
  const info = actor.getSkillInfo?.(id);
  return !!(info?.rt && !info.rank);
}

async function rollOne(actor, kind, id) {
  const opts = { skipDialog: true, chatMessage: false, noSound: true };
  let result;
  if ( kind === "skill" ) result = await actor.rollSkill(id, opts);
  else if ( kind === "save" ) result = await actor.rollSavingThrow(id, opts);
  else if ( kind === "ability" ) result = await actor.rollAbilityTest(id, opts);
  return extractRoll(result);
}

/**
 * Roll for the group and post one card. The card follows the current roll mode (public, private GM, blind, self).
 * @param {Actor} party
 * @param {string} key          "skill:per" etc.
 * @param {object} [options]
 * @param {number|null} [options.dc]
 * @param {string[]} [options.memberIds]  Defaults to every member.
 */
export async function groupRoll(party, key, { dc = null, memberIds } = {}) {
  const [kind, id] = key.split(":");
  const actors = party.system.actors.filter((a) => !memberIds || memberIds.includes(a.id));
  if ( !actors.length ) return ui.notifications.warn("Party: no members picked to roll.");

  const rows = [];
  const rolls = [];
  for ( const actor of actors ) {
    const row = { id: actor.id, name: actor.name, img: actor.img };
    if ( cannotAttempt(actor, kind, id) ) {
      row.cannot = true;
      rows.push(row);
      continue;
    }
    try {
      const roll = await rollOne(actor, kind, id);
      if ( !roll ) throw new Error("no roll returned");
      const d20 = roll.dice.find((d) => d.faces === 20);
      row.total = roll.total;
      row.nat = d20?.total ?? null;
      row.nat20 = row.nat === 20;
      row.nat1 = row.nat === 1;
      row.formula = roll.formula;
      if ( dc !== null ) row.pass = roll.total >= dc;
      rolls.push(roll);
    } catch(err) {
      console.error(`${MODULE_ID} | group roll failed for ${actor.name}`, err);
      row.error = true;
    }
    rows.push(row);
  }

  const rolled = rows.filter((r) => r.total !== undefined);
  if ( rolled.length > 1 ) {
    const hi = Math.max(...rolled.map((r) => r.total));
    const lo = Math.min(...rolled.map((r) => r.total));
    if ( hi !== lo ) for ( const r of rolled ) { r.high = r.total === hi; r.low = r.total === lo; }
  }
  rows.sort((a, b) => (b.total ?? -Infinity) - (a.total ?? -Infinity));

  const passed = rolled.filter((r) => r.pass).length;
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/party-roll.hbs`, {
    party: party.name,
    label: choiceLabel(key),
    dc,
    rows,
    summary: dc === null ? null : `${passed} of ${rolled.length} passed`
  });

  const messageData = {
    content,
    speaker: ChatMessage.getSpeaker({ actor: party }),
    rolls,
    sound: CONFIG.sounds.dice,
    flags: { [MODULE_ID]: { groupRoll: { partyId: party.id, key, dc } } }
  };
  ChatMessage.applyRollMode(messageData, game.settings.get("core", "rollMode"));
  return ChatMessage.implementation.create(messageData);
}
