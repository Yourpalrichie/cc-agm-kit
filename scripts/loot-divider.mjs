// Loot divider: a Party Stash actor, a "Room cleared" sweep of defeated NPCs on the scene, and an even coin split
// posted to chat. Never deletes anything: items are copied into the stash, coins are moved (NPC set to 0, stash
// increased), and swept tokens are flagged so they aren't swept twice.
import { MODULE_ID } from "./util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const DENOMS = ["pp", "gp", "sp", "cp"];
const STASH_NAME = "Party Stash";

/* ---------------------------------------- */
/*  Stash and sweep logic                   */
/* ---------------------------------------- */

/** The world's Party Stash actor (flagged), if one exists. */
export function getStash() {
  return game.actors.find((a) => a.getFlag(MODULE_ID, "partyStash")) ?? null;
}

/**
 * Find or create the Party Stash: a PF1 NPC actor using PF1's Loot sheet (PF1 11.11 has no separate loot actor type).
 * @returns {Promise<Actor>}
 */
export async function ensureStash() {
  const existing = getStash();
  if ( existing ) return existing;
  if ( !game.user.isGM ) throw new Error("GM only");
  const stash = await Actor.implementation.create({
    name: STASH_NAME,
    type: "npc",
    img: "icons/svg/chest.svg",
    prototypeToken: { name: STASH_NAME, actorLink: true },
    flags: {
      core: { sheetClass: "pf1.ActorSheetPFNPCLoot" },
      pf1: { sellMultiplier: 0.5 },
      [MODULE_ID]: { partyStash: true }
    }
  });
  ui.notifications.info(`Loot divider: created the "${STASH_NAME}" actor.`);
  return stash;
}

/** Coins on an actor, both weighted and weightless purses, as {pp, gp, sp, cp}. */
function purse(actor, key = "currency") {
  const c = actor.system[key] ?? {};
  return Object.fromEntries(DENOMS.map((d) => [d, Math.max(0, Math.floor(Number(c[d]) || 0))]));
}

function addCoins(a, b) {
  return Object.fromEntries(DENOMS.map((d) => [d, (a[d] || 0) + (b[d] || 0)]));
}

function coinsInCopper(c) {
  const rate = pf1.config.currency.rate;
  return DENOMS.reduce((n, d) => n + ((c[d] || 0) * (rate[d] ?? 1)), 0);
}

export function coinText(c) {
  const parts = DENOMS.filter((d) => c[d]).map((d) => `${c[d]} ${d}`);
  return parts.length ? parts.join(", ") : "0 gp";
}

/**
 * Unidentified to players: not identified and given an unidentified name. PF1 shows players the real name when the
 * unidentified name is blank, and API-created items default to identified: false, so the name is what counts.
 */
function isUnidentified(item) {
  return item.system.identified === false && !!item.system.unidentified?.name;
}

function playerName(item) {
  return isUnidentified(item) ? item.system.unidentified.name : item.name;
}

function physicalItems(actor) {
  return actor.items.filter((i) => i.isPhysical && (i.system.quantity ?? 1) > 0);
}

/** Whether a token has already been swept. Linked NPCs are also flagged on the actor, so twin tokens aren't double-swept. */
export function isLooted(tokenDoc) {
  if ( tokenDoc.getFlag(MODULE_ID, "looted") ) return true;
  return !!(tokenDoc.actorLink && tokenDoc.actor?.getFlag(MODULE_ID, "looted"));
}

/** Defeated = HP at or below 0 (on a creature with HP), the dead/defeated status, or a defeated combatant. */
export function isDefeated(tokenDoc) {
  const actor = tokenDoc.actor;
  if ( !actor ) return false;
  const hp = actor.system.attributes?.hp;
  if ( hp?.max > 0 && (hp.value ?? 0) <= 0 ) return true;
  if ( actor.statuses.has(CONFIG.specialStatusEffects.DEFEATED) ) return true;
  return !!tokenDoc.combatant?.isDefeated;
}

/** Tokens a sweep may take loot from: NPCs not owned by players, not the stash itself, not yet swept. */
function lootable(tokenDoc) {
  const actor = tokenDoc.actor;
  if ( !actor || actor.type !== "npc" || actor.hasPlayerOwner ) return false;
  if ( actor.getFlag(MODULE_ID, "partyStash") ) return false;
  return !isLooted(tokenDoc);
}

/** What a token would give up: its physical items and all its coins. */
function lootOf(tokenDoc) {
  const actor = tokenDoc.actor;
  const coins = addCoins(purse(actor, "currency"), purse(actor, "altCurrency"));
  return { token: tokenDoc, items: physicalItems(actor), coins };
}

/**
 * Defeated, unswept NPC tokens on a scene and what each holds.
 * @param {Scene} [scene]
 */
export function roomLoot(scene = canvas.scene) {
  if ( !scene ) return [];
  return scene.tokens.filter((t) => lootable(t) && isDefeated(t)).map(lootOf);
}

/**
 * Sweep tokens into the Party Stash. Copies items, moves coins, flags each token looted. Never deletes.
 * @param {TokenDocument[]} tokens
 * @returns {Promise<{tokens: number, items: number, coins: object}>}
 */
export async function sweepTokens(tokens) {
  if ( !game.user.isGM ) throw new Error("GM only");
  const stash = await ensureStash();
  const seenActors = new Set();
  const itemData = [];
  let moved = { pp: 0, gp: 0, sp: 0, cp: 0 };
  let swept = 0;

  for ( const tokenDoc of tokens ) {
    if ( !lootable(tokenDoc) ) continue;
    const actor = tokenDoc.actor;
    // Two tokens of one linked actor share an inventory: take it once.
    const shared = tokenDoc.actorLink && seenActors.has(actor.id);
    if ( tokenDoc.actorLink ) seenActors.add(actor.id);
    const { items, coins } = shared ? { items: [], coins: {} } : lootOf(tokenDoc);
    const source = { token: tokenDoc.name, scene: tokenDoc.parent?.name ?? "", at: Date.now() };

    for ( const item of items ) {
      const data = item.toObject();
      delete data._id;
      delete data.sort;
      data.system.equipped = false;
      data.system.carried = true;
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.lootSource`, source);
      itemData.push(data);
    }
    if ( coinsInCopper(coins) > 0 ) {
      moved = addCoins(moved, coins);
      const zero = Object.fromEntries(DENOMS.map((d) => [d, 0]));
      await actor.update({ "system.currency": zero, "system.altCurrency": zero });
    }
    const record = { ...source, items: items.length, coins };
    await tokenDoc.setFlag(MODULE_ID, "looted", record);
    if ( tokenDoc.actorLink && !shared ) await actor.setFlag(MODULE_ID, "looted", record);
    swept++;
  }

  if ( itemData.length ) await stash.createEmbeddedDocuments("Item", itemData);
  if ( coinsInCopper(moved) > 0 ) {
    await stash.update({ "system.currency": addCoins(purse(stash), moved) });
  }
  return { tokens: swept, items: itemData.length, coins: moved };
}

/** Clear the looted flag so a token can be swept again (e.g. after the GM gives it more gear). */
export async function unmarkLooted(tokenDoc) {
  await tokenDoc.unsetFlag(MODULE_ID, "looted");
  if ( tokenDoc.actorLink ) await tokenDoc.actor?.unsetFlag(MODULE_ID, "looted");
}

/**
 * The coin split: each share and what can't be divided (stays in the stash).
 * Splits down through gp, sp and cp, so only a few copper are ever left over.
 */
export function computeSplit(stash, partySize) {
  const coins = stash ? purse(stash) : { pp: 0, gp: 0, sp: 0, cp: 0 };
  const total = coinsInCopper(coins);
  const n = Math.max(1, Math.floor(partySize) || 1);
  const share = Math.floor(total / n);
  const leftover = total - (share * n);
  const split = (cp) => ({ pp: 0, gp: 0, sp: 0, cp: 0, ...pf1.utils.currency.split(cp, { pad: false }) });
  return { coins, total, n, share: split(share), leftover: split(leftover), shareCp: share, leftoverCp: leftover };
}

/* ---------------------------------------- */
/*  Window                                  */
/* ---------------------------------------- */

export class LootDividerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agm-loot-divider",
    classes: ["agm-loot-divider"],
    window: { title: "Loot Divider", icon: "fa-solid fa-sack-dollar", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      roomCleared: LootDividerApp.#onRoomCleared,
      sweepSelected: LootDividerApp.#onSweepSelected,
      createStash: LootDividerApp.#onCreateStash,
      openStash: LootDividerApp.#onOpenStash,
      addCoins: LootDividerApp.#onAddCoins,
      toggleGiven: LootDividerApp.#onToggleGiven,
      openItem: LootDividerApp.#onOpenItem,
      postShares: LootDividerApp.#onPostShares,
      payOut: LootDividerApp.#onPayOut,
      panToken: LootDividerApp.#onPanToken
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/loot-divider.hbs`, scrollable: [".ld-scroll"] }
  };

  static #instance;
  static get instance() {
    return this.#instance ??= new this();
  }

  static open() {
    if ( !game.user.isGM ) return ui.notifications.warn("The loot divider is GM-only.");
    const app = this.instance;
    if ( app.rendered ) app.bringToFront();
    else app.render({ force: true });
    return app;
  }

  #busy = false;

  get partySize() {
    return game.settings.get(MODULE_ID, "lootPartySize");
  }

  async _prepareContext() {
    const stash = getStash();
    const room = roomLoot().map((l) => ({
      id: l.token.id, name: l.token.name, img: l.token.texture.src,
      items: l.items.length, coins: coinText(l.coins)
    }));
    const mult = stash?.getFlag("pf1", "sellMultiplier") || 0.5;
    const items = stash ? physicalItems(stash).map((i) => {
      const sell = i.getValue({ sellValue: mult, recursive: true });
      return {
        id: i.id, name: i.name, img: i.img, qty: i.system.quantity ?? 1,
        unidName: playerName(i) === i.name ? null : playerName(i),
        sell: pf1.utils.limitPrecision(sell, 2),
        given: !!i.getFlag(MODULE_ID, "given"),
        from: i.getFlag(MODULE_ID, "lootSource")?.token ?? ""
      };
    }).sort((a, b) => (a.given - b.given) || a.name.localeCompare(b.name)) : [];
    const open = items.filter((i) => !i.given);
    const split = computeSplit(stash, this.partySize);
    const selected = canvas.tokens?.controlled.filter((t) => lootable(t.document)).length ?? 0;
    return {
      scene: canvas.scene?.name ?? null,
      room, selected, stash: stash ? { id: stash.id, name: stash.name } : null,
      coins: coinText(split.coins),
      items, itemsSell: pf1.utils.limitPrecision(open.reduce((n, i) => n + i.sell, 0), 2),
      openCount: open.length,
      partySize: this.partySize,
      share: coinText(split.share), leftover: split.leftoverCp ? coinText(split.leftover) : "",
      canPay: split.shareCp > 0, busy: this.#busy
    };
  }

  _onRender() {
    const el = this.element;
    el.querySelector("input[name=partySize]")?.addEventListener("change", async (ev) => {
      const n = Math.clamp(Math.floor(Number(ev.currentTarget.value) || 1), 1, 12);
      await game.settings.set(MODULE_ID, "lootPartySize", n);
      this.render();
    });
    // Drop items (sidebar, compendium or another sheet) to add them to the stash.
    const drop = el.querySelector(".ld-drop");
    drop?.addEventListener("dragover", (ev) => ev.preventDefault());
    drop?.addEventListener("drop", (ev) => this.#onDrop(ev));
  }

  _onFirstRender() {
    const rerender = foundry.utils.debounce(() => this.rendered && !this.#busy && this.render(), 100);
    this._hooks = ["updateActor", "createActor", "createItem", "updateItem", "deleteItem", "createToken", "updateToken",
      "deleteToken", "createActiveEffect", "deleteActiveEffect", "updateCombatant", "controlToken", "canvasReady"]
      .map((name) => [name, Hooks.on(name, rerender)]);
  }

  _onClose() {
    for ( const [name, id] of this._hooks ?? [] ) Hooks.off(name, id);
    this._hooks = null;
  }

  async #run(fn) {
    if ( this.#busy ) return;
    this.#busy = true;
    try { return await fn(); }
    catch (err) {
      console.error(`${MODULE_ID} | Loot divider`, err);
      ui.notifications.error(`Loot divider failed: ${err.message}`);
    }
    finally {
      this.#busy = false;
      this.render();
    }
  }

  async #sweep(tokens, label) {
    if ( !tokens.length ) return ui.notifications.warn(`Loot divider: nothing to sweep (${label}).`);
    const r = await this.#run(() => sweepTokens(tokens));
    if ( r ) ui.notifications.info(`Loot divider: swept ${r.tokens} token(s): ${r.items} item(s) and ${coinText(r.coins)} into the stash.`);
  }

  static async #onRoomCleared() {
    if ( !canvas.scene ) return ui.notifications.warn("Loot divider: view a scene first.");
    await this.#sweep(roomLoot().map((l) => l.token), "no defeated NPCs on this scene");
  }

  /** Sweep the selected NPC tokens whether or not they're defeated: chests, surrendered foes. */
  static async #onSweepSelected() {
    const tokens = (canvas.tokens?.controlled ?? []).map((t) => t.document).filter(lootable);
    await this.#sweep(tokens, "select unswept NPC tokens first");
  }

  static async #onCreateStash() {
    await this.#run(() => ensureStash());
  }

  static #onOpenStash() {
    getStash()?.sheet.render(true);
  }

  static async #onAddCoins() {
    const el = this.element;
    const add = Object.fromEntries(DENOMS.map((d) => {
      const input = el.querySelector(`input[name=add-${d}]`);
      return [d, Math.max(0, Math.floor(Number(input?.value) || 0))];
    }));
    if ( !coinsInCopper(add) ) return ui.notifications.warn("Loot divider: enter some coins to add.");
    await this.#run(async () => {
      const stash = await ensureStash();
      await stash.update({ "system.currency": addCoins(purse(stash), add) });
      ui.notifications.info(`Loot divider: added ${coinText(add)} to the stash.`);
    });
  }

  async #onDrop(ev) {
    ev.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
    if ( data?.type !== "Item" ) return ui.notifications.warn("Loot divider: drop an Item here.");
    await this.#run(async () => {
      const item = await Item.implementation.fromDropData(data);
      if ( !item?.isPhysical ) return ui.notifications.warn("Loot divider: only physical items (gear, loot, consumables) go in the stash.");
      const stash = await ensureStash();
      if ( item.parent === stash ) return;
      const itemData = item.toObject();
      delete itemData._id;
      itemData.system.equipped = false;
      foundry.utils.setProperty(itemData, `flags.${MODULE_ID}.lootSource`, { token: "added by GM", at: Date.now() });
      await stash.createEmbeddedDocuments("Item", [itemData]);
      ui.notifications.info(`Loot divider: added ${item.name} to the stash.`);
    });
  }

  /** Mark an item as handed out (or back). It stays in the stash; it just leaves the split. */
  static async #onToggleGiven(event, target) {
    const item = getStash()?.items.get(target.closest("[data-item]")?.dataset.item);
    if ( item ) await item.setFlag(MODULE_ID, "given", !item.getFlag(MODULE_ID, "given"));
  }

  static #onOpenItem(event, target) {
    getStash()?.items.get(target.closest("[data-item]")?.dataset.item)?.sheet.render(true);
  }

  static #onPanToken(event, target) {
    const token = canvas.tokens.get(target.closest("[data-token]")?.dataset.token);
    if ( token ) canvas.animatePan({ x: token.center.x, y: token.center.y });
  }

  /** Public chat card: each player's coin share and the items left to divide, with half-price sell values. */
  static async #onPostShares() {
    const stash = getStash();
    if ( !stash ) return ui.notifications.warn("Loot divider: there's no Party Stash yet.");
    const split = computeSplit(stash, this.partySize);
    const mult = stash.getFlag("pf1", "sellMultiplier") || 0.5;
    const esc = foundry.utils.escapeHTML;
    // One line per item name and unit value, so three swept longswords read "Longsword ×3".
    const lines = new Map();
    for ( const i of physicalItems(stash).filter((i) => !i.getFlag(MODULE_ID, "given")) ) {
      const unid = isUnidentified(i);
      // Unidentified items show players their unidentified name and price, so chat doesn't give away what they are.
      const opts = { sellValue: mult, recursive: true, forceUnidentified: unid };
      const unit = i.getValue({ ...opts, single: true });
      const key = `${playerName(i)}|${unit}`;
      const line = lines.get(key) ?? { name: playerName(i), unid, qty: 0, sell: 0 };
      line.qty += i.system.quantity ?? 1;
      line.sell += i.getValue(opts);
      lines.set(key, line);
    }
    const items = [...lines.values()].map((l) => {
      const value = l.unid && !l.sell ? "value unknown until identified" : `sells for ${pf1.utils.limitPrecision(l.sell, 2)} gp`;
      return `<li>${esc(l.name)}${l.qty > 1 ? ` ×${l.qty}` : ""}: ${value}</li>`;
    });
    const shares = Array.from({ length: split.n }, (_, i) => `<li>Player ${i + 1}: <strong>${coinText(split.share)}</strong></li>`);
    const content = `<div class="agm-loot-card">
      <h3><i class="fa-solid fa-sack-dollar"></i> Loot split</h3>
      ${split.shareCp ? `<p>Party Stash coins: ${coinText(split.coins)}, split ${split.n} ways.</p>
      <p>Each share: <strong>${coinText(split.share)}</strong></p>
      <ul>${shares.join("")}</ul>` : "<p>No coins to split.</p>"}
      ${split.leftoverCp ? `<p class="ld-sub">Left in the stash (won't divide): ${coinText(split.leftover)}</p>` : ""}
      ${items.length ? `<h4>Items to divide (half-price sell value)</h4><ul>${items.join("")}</ul>` : ""}
      <p class="ld-sub">Copy your share into PathCompanion or Fight Club.</p>
    </div>`;
    await ChatMessage.implementation.create({ content, speaker: { alias: "Loot Divider" } });
  }

  /** Take the paid shares out of the stash, leaving only the coins that won't divide. */
  static async #onPayOut() {
    const stash = getStash();
    if ( !stash ) return;
    const split = computeSplit(stash, this.partySize);
    if ( !split.shareCp ) return ui.notifications.warn("Loot divider: no coins to pay out.");
    const ok = await DialogV2.confirm({
      window: { title: "Pay out coins" },
      content: `<p>Pay ${split.n} share(s) of <strong>${coinText(split.share)}</strong> out of the Party Stash?</p>`
        + `<p>The stash keeps ${split.leftoverCp ? coinText(split.leftover) : "nothing"}. Do this once the players have copied their shares.</p>`
    });
    if ( !ok ) return;
    await this.#run(async () => {
      await stash.update({ "system.currency": split.leftover });
      ui.notifications.info(`Loot divider: paid out ${split.n} × ${coinText(split.share)}.`);
    });
  }
}
