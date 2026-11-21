import { MODULE_ID, HAUNT_TYPE, isExecutor, hauntomaticEnabled } from "./util.mjs";
import { postHauntCard } from "./haunt-card.mjs";

const { fields } = foundry.data;
const { REGION_EVENTS } = CONST;

/** Behaviors currently being processed on this client, to stop two simultaneous entries double-firing. */
const inFlight = new Set();

/**
 * PF1 haunt as a Region Behavior. The GM draws a Region and adds a "Haunt" behavior to it.
 * Rules basis: GameMastery Guide haunts (AoN Rules ID 907), Occult Adventures (2114), Horror Adventures (2315).
 */
export class HauntBehaviorType extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = [`BEHAVIOR.TYPES.${MODULE_ID}.haunt`];

  static defineSchema() {
    return {
      name: new fields.StringField({ required: true, blank: true, initial: "" }),
      cr: new fields.NumberField({ required: true, min: 0, initial: 1 }),
      casterLevel: new fields.NumberField({ required: true, integer: true, min: 0, initial: 1 }),
      noticeDC: new fields.NumberField({ required: true, integer: true, min: 0, initial: 10 }),
      hp: new fields.NumberField({ required: true, integer: true, min: 0, initial: 2 }),
      hpMax: new fields.NumberField({ required: true, integer: true, min: 0, initial: 2 }),
      persistent: new fields.BooleanField({ initial: false }),
      slow: new fields.BooleanField({ initial: false }),
      trigger: new fields.StringField({
        required: true, initial: "proximity",
        choices: { proximity: "AGM.Trigger.proximity", touch: "AGM.Trigger.touch", other: "AGM.Trigger.other" }
      }),
      effect: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      destruction: new fields.HTMLField({ required: true, blank: true, initial: "" }),
      weakness: new fields.StringField({ required: true, blank: true, initial: "" }),
      resetText: new fields.StringField({ required: true, blank: true, initial: "" }),
      resetSeconds: new fields.NumberField({ required: true, integer: true, min: 0, initial: 0 }),
      state: new fields.StringField({
        required: true, initial: "armed",
        choices: {
          armed: "AGM.State.armed", triggered: "AGM.State.triggered",
          neutralized: "AGM.State.neutralized", destroyed: "AGM.State.destroyed"
        }
      }),
      neutralizedAt: new fields.NumberField({ required: false, nullable: true, initial: null }),
      stingerUuid: new fields.DocumentUUIDField({ type: "PlaylistSound", nullable: true, initial: null })
    };
  }

  /** Display name: the haunt's own name, else the behavior's name. */
  get displayName() {
    return this.name || this.parent?.name || game.i18n.localize("AGM.Haunt");
  }

  /** Initiative the haunt acts on in the surprise round. */
  get initiative() {
    return this.slow ? 0 : 10;
  }

  /* ---------------------------------------- */

  static async #onTokenMoveIn(event) {
    if ( !isExecutor() ) return;
    if ( !hauntomaticEnabled() ) return;
    if ( this.parent.disabled ) return; // core also skips disabled behaviors; belt and braces
    if ( this.state !== "armed" ) return;
    const token = event.data.token;
    if ( !token?.actor?.hasPlayerOwner ) return;

    const uuid = this.parent.uuid;
    if ( inFlight.has(uuid) ) return;
    inFlight.add(uuid);
    try {
      await this.parent.update({ "system.state": "triggered" });
      await this.manifest(token);
    } catch(err) {
      console.error(`${MODULE_ID} | Haunt "${this.displayName}" failed to manifest`, err);
      ui.notifications.error(`Hauntomatic: "${this.displayName}" failed to manifest. See console (F12).`);
    } finally {
      inFlight.delete(uuid);
    }
  }

  static events = {
    [REGION_EVENTS.TOKEN_MOVE_IN]: this.#onTokenMoveIn
  };

  /* ---------------------------------------- */

  /** PC tokens currently in the region, plus the one that just entered. */
  pcTokensInRegion(entering) {
    const tokens = new Set(this.region?.tokens ?? []);
    if ( entering ) tokens.add(entering);
    return [...tokens].filter(t => t.actor?.hasPlayerOwner);
  }

  /**
   * Manifest: blind Perception for each PC in the area vs. the notice DC, whisper the GM card, play the stinger.
   * @param {TokenDocument} [entering]
   */
  async manifest(entering) {
    const noticed = [];
    for ( const token of this.pcTokensInRegion(entering) ) {
      const actor = token.actor;
      let total = null;
      try {
        const msg = await actor.rollSkill("per", {
          skipDialog: true, rollMode: CONST.DICE_ROLL_MODES.BLIND, dc: this.noticeDC, token
        });
        total = msg?.rolls?.[0]?.total ?? null;
      } catch(err) {
        console.warn(`${MODULE_ID} | Perception roll failed for ${actor.name}`, err);
      }
      noticed.push({ name: token.name, total, success: (total !== null) && (total >= this.noticeDC) });
    }
    await postHauntCard(this, noticed);
    await this.playStinger();
  }

  async playStinger() {
    if ( !this.stingerUuid ) return;
    const sound = await fromUuid(this.stingerUuid);
    if ( sound?.parent ) await sound.parent.playSound(sound);
  }

  /* ---------------------------------------- */
  /*  State changes (called from the card and panel)  */
  /* ---------------------------------------- */

  async applyPositiveEnergy(amount) {
    if ( this.state === "destroyed" ) return;
    const hp = Math.max(0, this.hp - Math.max(0, Math.floor(amount)));
    if ( hp === 0 ) return this.neutralize();
    return this.parent.update({ "system.hp": hp });
  }

  async neutralize() {
    if ( this.state === "destroyed" ) return;
    return this.parent.update({ "system.hp": 0, "system.state": "neutralized", "system.neutralizedAt": game.time.worldTime });
  }

  async markDestroyed() {
    return this.parent.update({ "system.hp": 0, "system.state": "destroyed" });
  }

  async rearm() {
    if ( this.state === "destroyed" ) return;
    return this.parent.update({ "system.hp": this.hpMax, "system.state": "armed", "system.neutralizedAt": null });
  }

  /** Should this haunt reset at the given world time? */
  isDueToReset(worldTime) {
    return (this.state === "neutralized") && (this.resetSeconds > 0) && (this.neutralizedAt !== null)
      && ((worldTime - this.neutralizedAt) >= this.resetSeconds);
  }
}

/** Every haunt behavior in a scene. */
export function hauntsInScene(scene) {
  const out = [];
  for ( const region of scene?.regions ?? [] ) {
    for ( const behavior of region.behaviors ) {
      if ( behavior.type === HAUNT_TYPE ) out.push(behavior);
    }
  }
  return out;
}
