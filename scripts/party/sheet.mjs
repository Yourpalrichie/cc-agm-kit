// Party sheet: member list with quick stats, group rolls, overland speed, deploy/recall.
import { MODULE_ID } from "../util.mjs";
import { PARTY_TYPE, overland, partyToken, deployedTokens, isParty } from "./data.mjs";
import { rollChoices, groupRoll } from "./roll.mjs";
import { deployParty, recallParty } from "./deploy.mjs";
import { restPartyDialog } from "./rest.mjs";
import { stats as sanityStats } from "../sanity/tracker.mjs";

/** Current sanity (score minus sanity damage) for the member table, or null for mindless creatures. */
function sanityOf(actor) {
  const s = sanityStats(actor);
  if ( s.mindless ) return null;
  const cls = { "Stable": "ok", "Strained": "warn", "Past Edge": "bad", "Insane": "insane" }[s.status] ?? "ok";
  return { value: Math.max(0, s.score - s.d.damage), max: s.score, status: s.status, cls, edge: s.edge };
}

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export class PartySheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["agm-party"],
    position: { width: 600, height: 640 },
    window: { resizable: true, icon: "fa-solid fa-people-group" },
    form: { submitOnChange: true },
    actions: {
      openMember: PartySheet.#onOpenMember,
      removeMember: PartySheet.#onRemoveMember,
      moveMember: PartySheet.#onMoveMember,
      toggleRoll: PartySheet.#onToggleRoll,
      groupRoll: PartySheet.#onGroupRoll,
      deploy: PartySheet.#onDeploy,
      recall: PartySheet.#onRecall,
      rest: PartySheet.#onRest
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/party-sheet.hbs`, scrollable: [".ap-members"] }
  };

  /** Members left out of the next group roll (scouting ahead, unconscious...). Not saved. */
  #excluded = new Set();
  #rollKey = "skill:per";
  #dc = "";

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const party = this.actor;
    const isGM = game.user.isGM;
    const actors = party.system.actors;
    const missing = party.system.members.length - actors.length;

    const members = actors.map((a, i) => {
      const s = a.system;
      const saves = s.attributes?.savingThrows ?? {};
      return {
        id: a.id,
        name: a.name,
        img: a.img,
        hp: s.attributes?.hp ?? {},
        sanity: sanityOf(a),
        ac: s.attributes?.ac?.normal?.total,
        fort: saves.fort?.total, ref: saves.ref?.total, will: saves.will?.total,
        per: s.skills?.per?.mod,
        speed: s.attributes?.speed?.land?.total,
        rolls: !this.#excluded.has(a.id),
        canOpen: a.testUserPermission(game.user, "LIMITED"),
        first: i === 0,
        last: i === actors.length - 1
      };
    });

    const token = partyToken(party);
    const out = token ? deployedTokens(party, token.parent).length : 0;

    return Object.assign(context, {
      party,
      isGM,
      members,
      missing,
      travel: overland(actors),
      choices: rollChoices().map((g) => ({
        group: g.group,
        options: g.options.map((o) => ({ ...o, selected: o.key === this.#rollKey }))
      })),
      dc: this.#dc,
      rollCount: members.filter((m) => m.rolls).length,
      token: token ? { scene: token.parent.name, out } : null
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const el = this.element;
    el.querySelector("[name=rollKey]")?.addEventListener("change", (e) => { this.#rollKey = e.target.value; });
    el.querySelector("[name=rollDC]")?.addEventListener("change", (e) => { this.#dc = e.target.value; });
  }

  /** The roll picker isn't actor data; keep it out of the form submit. */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    delete data.rollKey;
    delete data.rollDC;
    return data;
  }

  /* ---------- Adding members by drag and drop ---------- */

  async _onDropActor(event, actor) {
    if ( !game.user.isGM ) return null;
    return this.addMembers([actor]);
  }

  async _onDropFolder(event, folder) {
    if ( !game.user.isGM || folder.type !== "Actor" ) return null;
    return this.addMembers(folder.contents);
  }

  async _onDropItem() {
    return null;
  }

  async addMembers(actors) {
    const party = this.actor;
    const ids = [...party.system.members];
    for ( const a of actors ) {
      if ( a.pack ) { ui.notifications.warn(`Party: import ${a.name} into the world first.`); continue; }
      if ( a.isToken ) { ui.notifications.warn(`Party: drag ${a.name} from the Actors sidebar, not a token.`); continue; }
      if ( isParty(a) ) { ui.notifications.warn("Party: a party can't hold another party."); continue; }
      if ( !ids.includes(a.id) ) ids.push(a.id);
    }
    if ( ids.length === party.system.members.length ) return null;
    return party.update({ "system.members": ids });
  }

  /* ---------- Actions ---------- */

  static #memberId(target) {
    return target.closest("[data-member-id]")?.dataset.memberId;
  }

  static #onOpenMember(event, target) {
    game.actors.get(PartySheet.#memberId(target))?.sheet.render(true);
  }

  static async #onRemoveMember(event, target) {
    const id = PartySheet.#memberId(target);
    await this.actor.update({ "system.members": this.actor.system.members.filter((m) => m !== id) });
  }

  static async #onMoveMember(event, target) {
    const id = PartySheet.#memberId(target);
    const ids = [...this.actor.system.members];
    const i = ids.indexOf(id);
    const j = i + Number(target.dataset.dir);
    if ( i < 0 || j < 0 || j >= ids.length ) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await this.actor.update({ "system.members": ids });
  }

  static #onToggleRoll(event, target) {
    const id = PartySheet.#memberId(target);
    if ( this.#excluded.has(id) ) this.#excluded.delete(id);
    else this.#excluded.add(id);
    this.render();
  }

  static async #onGroupRoll() {
    const dcText = String(this.#dc).trim();
    const dc = dcText === "" ? null : Number(dcText);
    if ( dc !== null && !Number.isFinite(dc) ) return ui.notifications.warn("Party: the DC must be a number.");
    const memberIds = this.actor.system.members.filter((id) => !this.#excluded.has(id));
    await groupRoll(this.actor, this.#rollKey, { dc, memberIds });
  }

  static async #onDeploy() {
    await deployParty(this.actor);
  }

  static async #onRecall() {
    await recallParty(this.actor);
  }

  static async #onRest() {
    await restPartyDialog(this.actor);
  }
}

/** Re-render open party sheets when a member, or a token on the viewed scene, changes. */
export function refreshPartySheets(actorId = null) {
  for ( const party of game.actors ) {
    if ( party.type !== PARTY_TYPE || !party.sheet?.rendered ) continue;
    if ( actorId && actorId !== party.id && !party.system.members.includes(actorId) ) continue;
    party.sheet.render();
  }
}
