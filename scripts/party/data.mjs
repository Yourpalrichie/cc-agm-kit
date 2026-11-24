// Party actor: a module sub-type of Actor that holds a list of member actors, like the dnd5e Group.
// PF1 11.11 has no party type; its Actor proxy falls back to its base actor class for types it doesn't know.
import { MODULE_ID } from "../util.mjs";

const { fields } = foundry.data;

export const PARTY_TYPE = `${MODULE_ID}.party`;

export class PartyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // World actor ids, in display order.
      members: new fields.ArrayField(new fields.StringField({ required: true, blank: false })),
      notes: new fields.HTMLField({ required: true, blank: true, initial: "" })
    };
  }

  /** Member actors that still exist. */
  get actors() {
    return this.members.map((id) => game.actors.get(id)).filter(Boolean);
  }
}

export function isParty(actor) {
  return actor?.type === PARTY_TYPE;
}

export function allParties() {
  return game.actors.filter(isParty);
}

/** Land speed in feet, after armor and encumbrance (PF1 total). */
export function landSpeed(actor) {
  return Number(actor.system.attributes?.speed?.land?.total) || 0;
}

/**
 * Overland travel for the group, from the slowest member. PF1 movement table: miles per hour is speed / 10,
 * a day is 8 hours of travel (Core Rulebook, Movement: "Overland Movement").
 */
export function overland(actors) {
  const speeds = actors.map((a) => ({ actor: a, speed: landSpeed(a) })).filter((s) => s.speed > 0);
  if ( !speeds.length ) return null;
  const slowest = speeds.reduce((a, b) => (b.speed < a.speed ? b : a));
  const mph = slowest.speed / 10;
  return { speed: slowest.speed, slowest: slowest.actor.name, mph, perDay: mph * 8 };
}

/** The party's token on a scene, if it has one. */
export function partyToken(party, scene = canvas.scene) {
  return scene?.tokens.find((t) => t.actorId === party.id) ?? null;
}

/** Member tokens that Deploy put on a scene for this party. */
export function deployedTokens(party, scene = canvas.scene) {
  return scene?.tokens.filter((t) => t.getFlag(MODULE_ID, "deployedBy") === party.id) ?? [];
}

/** Default setup for a new party actor: linked token, friendly, no bars, players can move it. */
export function onPreCreateActor(actor, data) {
  if ( !isParty(actor) ) return;
  const { DOCUMENT_OWNERSHIP_LEVELS, TOKEN_DISPOSITIONS, TOKEN_DISPLAY_MODES } = CONST;
  actor.updateSource({
    img: data.img && data.img !== Actor.DEFAULT_ICON ? data.img : "icons/environment/people/group.webp",
    "ownership.default": data.ownership?.default ?? DOCUMENT_OWNERSHIP_LEVELS.OWNER,
    prototypeToken: {
      actorLink: true,
      disposition: TOKEN_DISPOSITIONS.FRIENDLY,
      displayBars: TOKEN_DISPLAY_MODES.NONE,
      displayName: TOKEN_DISPLAY_MODES.HOVER,
      bar1: { attribute: null },
      bar2: { attribute: null }
    }
  });
}
