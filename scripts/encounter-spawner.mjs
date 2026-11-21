// Encounter spawner: pick NPCs from the converted-statblock Actor folders, place them on the viewed scene with
// rolled HP, add them to combat and roll their initiative. Creates Tokens, Combats and Combatants only; never deletes.
import { MODULE_ID, gmUserIds } from "./util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Folder names that hold converted statblocks, preferred as the default source. */
const STATBLOCK_FOLDER = /^(sbc\b|imported)/i;

export class EncounterSpawnerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agm-encounter-spawner",
    classes: ["agm-encounter-spawner"],
    window: { title: "Encounter Spawner", icon: "fa-solid fa-dragon", resizable: true },
    position: { width: 640, height: 560 },
    actions: {
      add: EncounterSpawnerApp.#onAdd,
      remove: EncounterSpawnerApp.#onRemove,
      bump: EncounterSpawnerApp.#onBump,
      clear: EncounterSpawnerApp.#onClear,
      spawn: EncounterSpawnerApp.#onSpawn,
      openSheet: EncounterSpawnerApp.#onOpenSheet
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/encounter-spawner.hbs` }
  };

  static #instance;
  static get instance() {
    return this.#instance ??= new this();
  }

  static open() {
    if ( !game.user.isGM ) return ui.notifications.warn("The encounter spawner is GM-only.");
    const app = this.instance;
    if ( app.rendered ) app.bringToFront();
    else app.render({ force: true });
    return app;
  }

  /** Selected folder id ("" = all folders). */
  #folderId = null;
  #search = "";
  /** Roster: Map<actorId, count> */
  #roster = new Map();
  #opts = { hp: "roll", place: "click", hidden: true, combat: true, initiative: true };
  #busy = false;

  /* ---------------------------------------- */

  /** Actor folders, nested names, with how many NPCs each holds (including subfolders). */
  #folders() {
    const all = game.folders.filter((f) => f.type === "Actor");
    const byName = (a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name);
    const out = [];
    const walk = (parentId, depth) => {
      for ( const f of all.filter((x) => (x._source.folder ?? null) === parentId).sort(byName) ) {
        const npcs = this.#actorsIn(f).length;
        out.push({ id: f.id, name: `${" ".repeat(depth)}${f.name}`, npcs, statblock: STATBLOCK_FOLDER.test(f.name) });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  /** NPC actors in a folder and its subfolders (or every NPC when folder is null). */
  #actorsIn(folder) {
    const npcs = game.actors.filter((a) => a.type === "npc" && a.visible);
    if ( !folder ) return npcs;
    const ids = new Set([folder.id, ...folder.getSubfolders(true).map((f) => f.id)]);
    return npcs.filter((a) => a.folder && ids.has(a.folder.id));
  }

  #defaultFolderId(folders) {
    return (folders.find((f) => f.statblock && f.npcs) ?? folders.find((f) => f.npcs))?.id ?? "";
  }

  async _prepareContext() {
    const folders = this.#folders();
    if ( this.#folderId === null || (this.#folderId && !game.folders.has(this.#folderId)) ) {
      this.#folderId = this.#defaultFolderId(folders);
    }
    const folder = this.#folderId ? game.folders.get(this.#folderId) : null;
    const q = this.#search.trim().toLowerCase();
    const actors = this.#actorsIn(folder)
      .filter((a) => !q || a.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ ...summarize(a), inRoster: this.#roster.get(a.id) ?? 0 }));

    // Drop roster entries whose actor is gone.
    for ( const id of this.#roster.keys() ) if ( !game.actors.has(id) ) this.#roster.delete(id);
    const roster = [...this.#roster].map(([id, count]) => ({ ...summarize(game.actors.get(id)), count }));
    const total = roster.reduce((n, r) => n + r.count, 0);
    const autoHP = roster.some((r) => r.autoHP);

    return {
      folders: folders.map((f) => ({ ...f, selected: f.id === this.#folderId })),
      allSelected: this.#folderId === "",
      search: this.#search,
      actors, roster, total,
      opts: this.#opts, autoHP, busy: this.#busy,
      scene: canvas.scene?.name ?? null,
      combat: (() => {
        const c = game.combats.viewed;
        if ( !c || (c.scene && (c.scene.id !== canvas.scene?.id)) ) return null;
        return c.name || "current combat";
      })()
    };
  }

  _onRender(context, options) {
    const el = this.element;
    el.querySelector("select[name=folder]")?.addEventListener("change", (ev) => {
      this.#folderId = ev.currentTarget.value;
      this.render();
    });
    const search = el.querySelector("input[name=search]");
    search?.addEventListener("input", foundry.utils.debounce((ev) => {
      this.#search = ev.target.value;
      this.render({ parts: ["body"] }).then(() => {
        const s = this.element.querySelector("input[name=search]");
        s?.focus(); s?.setSelectionRange(s.value.length, s.value.length);
      });
    }, 200));
    for ( const input of el.querySelectorAll("[data-opt]") ) {
      input.addEventListener("change", (ev) => {
        const t = ev.currentTarget;
        this.#opts[t.dataset.opt] = t.type === "checkbox" ? t.checked : t.value;
        this.render();
      });
    }
    for ( const input of el.querySelectorAll("input[data-count]") ) {
      input.addEventListener("change", (ev) => {
        const n = Math.clamp(Math.floor(Number(ev.currentTarget.value) || 0), 0, 50);
        const id = ev.currentTarget.dataset.count;
        if ( n > 0 ) this.#roster.set(id, n);
        else this.#roster.delete(id);
        this.render();
      });
    }
    // Drag an Actor from the sidebar onto the roster.
    const drop = el.querySelector(".es-roster");
    drop?.addEventListener("dragover", (ev) => ev.preventDefault());
    drop?.addEventListener("drop", async (ev) => {
      ev.preventDefault();
      const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
      if ( data?.type !== "Actor" ) return;
      const actor = await fromUuid(data.uuid);
      if ( !actor || actor.pack ) return ui.notifications.warn("Encounter spawner: drop a world Actor (import compendium statblocks first).");
      this.#roster.set(actor.id, (this.#roster.get(actor.id) ?? 0) + 1);
      this.render();
    });
  }

  _onFirstRender() {
    const rerender = foundry.utils.debounce(() => this.rendered && !this.#busy && this.render(), 100);
    this._hooks = ["createActor", "updateActor", "deleteActor", "createFolder", "updateFolder", "deleteFolder",
      "canvasReady", "createCombat", "deleteCombat", "updateCombat"]
      .map((name) => [name, Hooks.on(name, rerender)]);
  }

  _onClose() {
    for ( const [name, id] of this._hooks ?? [] ) Hooks.off(name, id);
    this._hooks = null;
  }

  /* ---------------------------------------- */

  static #onAdd(event, target) {
    const id = target.closest("[data-actor]")?.dataset.actor;
    if ( !id ) return;
    this.#roster.set(id, (this.#roster.get(id) ?? 0) + 1);
    this.render();
  }

  static #onRemove(event, target) {
    this.#roster.delete(target.closest("[data-actor]")?.dataset.actor);
    this.render();
  }

  static #onBump(event, target) {
    const id = target.closest("[data-actor]")?.dataset.actor;
    const n = (this.#roster.get(id) ?? 0) + Number(target.dataset.delta);
    if ( n > 0 ) this.#roster.set(id, Math.min(n, 50));
    else this.#roster.delete(id);
    this.render();
  }

  static #onClear() {
    this.#roster.clear();
    this.render();
  }

  static #onOpenSheet(event, target) {
    game.actors.get(target.closest("[data-actor]")?.dataset.actor)?.sheet.render(true);
  }

  static async #onSpawn() {
    if ( this.#busy ) return;
    if ( !canvas.ready || !canvas.scene ) return ui.notifications.warn("Encounter spawner: view a scene first.");
    const entries = [...this.#roster].map(([id, count]) => ({ actor: game.actors.get(id), count })).filter((e) => e.actor);
    if ( !entries.length ) return ui.notifications.warn("Encounter spawner: add NPCs to the encounter first.");

    let origin;
    if ( this.#opts.place === "click" ) {
      // Step out of the way while the GM clicks (no minimize: its animation can leave the window collapsed).
      this.element.style.visibility = "hidden";
      try { origin = await pickPoint(); }
      finally { this.element.style.visibility = ""; }
      if ( !origin ) return;
    }
    else origin = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };

    this.#busy = true;
    try {
      const result = await spawnEncounter(entries, { ...this.#opts, origin });
      if ( result ) ui.notifications.info(`Encounter spawner: placed ${result.tokens.length} token(s) on ${canvas.scene.name}.`);
    }
    catch (err) {
      console.error(`${MODULE_ID} | Encounter spawner`, err);
      ui.notifications.error(`Encounter spawner failed: ${err.message}`);
    }
    finally {
      this.#busy = false;
      this.render();
    }
  }
}

/* ---------------------------------------- */

/** Short display data for an NPC actor. */
function summarize(actor) {
  const sys = actor.system;
  const cr = sys.details?.cr?.total;
  return {
    id: actor.id, name: actor.name, img: actor.img,
    cr: cr ? pf1.utils.CR.fromNumber(cr) : "–",
    hp: sys.attributes?.hp?.max ?? 0,
    hd: hitDiceText(actor),
    autoHP: rollableClasses(actor).some((c) => c.auto)
  };
}

function hitDiceText(actor) {
  const parts = rollableClasses(actor).map((c) => `${c.dice}d${c.die}`);
  return parts.length ? parts.join("+") : "";
}

/** Class items whose HD can be rolled, with whether PF1's auto-HP setting ignores their stored HP. */
function rollableClasses(actor) {
  const config = game.settings.get("pf1", "healthConfig").getActorConfig(actor);
  return actor.itemTypes.class
    .filter((c) => c.subType !== "mythic" && c.hitDice > 0 && c.system.hd > 0)
    .map((c) => {
      const group = c.subType === "racial" ? "racial" : c.subType === "npc" ? "npc" : "base";
      return { item: c, dice: c.hitDice, die: c.system.hd, auto: !!config.classes[group]?.auto };
    });
}

/**
 * Let the GM click a point on the board. Resolves to canvas coordinates, or null on right-click / Escape.
 * @returns {Promise<{x:number, y:number}|null>}
 */
function pickPoint() {
  return new Promise((resolve) => {
    const board = canvas.app.view;
    ui.notifications.info("Encounter spawner: click the map where the group should appear (right-click or Esc cancels).");
    board.style.cursor = "crosshair";
    const finish = (point) => {
      board.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      board.style.cursor = "";
      resolve(point);
    };
    const onDown = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if ( ev.button !== 0 ) return finish(null);
      finish(canvas.canvasCoordinatesFromClient({ x: ev.clientX, y: ev.clientY }));
    };
    const onKey = (ev) => {
      if ( ev.key !== "Escape" ) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(null);
    };
    board.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
  });
}

/**
 * Lay out N footprints in a compact block centred on origin, one grid-aligned cell group per token.
 * @returns {{x:number, y:number}[]} top-left pixel positions
 */
function layout(footprints, origin) {
  const grid = canvas.grid;
  const size = grid.size;
  const cols = Math.ceil(Math.sqrt(footprints.length));
  const cell = Math.max(...footprints.map((f) => Math.max(f.width, f.height, 1)));
  const rows = Math.ceil(footprints.length / cols);
  const blockW = cols * cell * size;
  const blockH = rows * cell * size;
  // Keep the whole block on the scene: move its centre, don't squash tokens against the edge.
  const d = canvas.dimensions;
  const cx = Math.clamp(origin.x, d.sceneX + (blockW / 2), Math.max(d.sceneX + (blockW / 2), d.sceneX + d.sceneWidth - (blockW / 2)));
  const cy = Math.clamp(origin.y, d.sceneY + (blockH / 2), Math.max(d.sceneY + (blockH / 2), d.sceneY + d.sceneHeight - (blockH / 2)));
  const start = { x: cx - (blockW / 2) + (size / 2), y: cy - (blockH / 2) + (size / 2) };
  return footprints.map((f, i) => {
    const center = { x: start.x + ((i % cols) * cell * size), y: start.y + (Math.floor(i / cols) * cell * size) };
    return grid.isGridless ? { x: center.x - (size / 2), y: center.y - (size / 2) } : grid.getTopLeftPoint(center);
  });
}

/**
 * Spawn the encounter on the viewed scene.
 * @param {{actor: Actor, count: number}[]} entries
 * @param {object} opts  { hp: "roll"|"statblock", hidden, combat, initiative, origin }
 * @returns {Promise<{tokens: TokenDocument[], combat: Combat|null, lines: object[]}|null>}
 */
export async function spawnEncounter(entries, { hp = "roll", hidden = true, combat: addCombat = true,
  initiative = true, origin } = {}) {
  if ( !game.user.isGM ) throw new Error("GM only");
  const scene = canvas.scene;
  origin ??= { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };

  // 1. Token data, numbered per actor. Spawned NPCs are always unlinked copies of the statblock.
  const pending = [];
  for ( const { actor, count } of entries ) {
    const base = actor.prototypeToken.name || actor.name;
    let n = scene.tokens.filter((t) => t.actorId === actor.id).length;
    const numbered = (count + n) > 1;
    for ( let i = 0; i < count; i++ ) {
      n += 1;
      const doc = await actor.getTokenDocument({ hidden, actorLink: false });
      const data = doc.toObject();
      data.actorLink = false;
      data.hidden = hidden;
      data.name = numbered ? `${base} ${n}` : base;
      delete data._id;
      pending.push({ actor, data });
    }
  }
  if ( !pending.length ) return null;
  const positions = layout(pending.map((p) => ({ width: p.data.width, height: p.data.height })), origin);
  pending.forEach((p, i) => Object.assign(p.data, positions[i]));

  const tokens = await scene.createEmbeddedDocuments("Token", pending.map((p) => p.data));

  // 2. Rolled HP: replace each class item's stored HP on the token's own (synthetic) actor.
  const lines = [];
  for ( const token of tokens ) {
    const actor = token.actor;
    const line = { name: token.name, hp: actor?.system.attributes.hp.max ?? 0, rolls: [], init: null };
    lines.push(line);
    if ( !actor || hp !== "roll" ) continue;
    const classes = rollableClasses(actor).filter((c) => !c.auto);
    if ( !classes.length ) continue;
    const updates = [];
    for ( const c of classes ) {
      const roll = await new Roll(`${c.dice}d${c.die}`).evaluate();
      updates.push({ _id: c.item.id, "system.hp": roll.total });
      line.rolls.push(`${c.dice}d${c.die}=${roll.total}`);
    }
    await actor.updateEmbeddedDocuments("Item", updates);
    if ( actor.system.attributes.hp.offset ) await actor.update({ "system.attributes.hp.offset": 0 });
    line.hp = actor.system.attributes.hp.max;
  }

  // 3. Combat and initiative.
  let combat = null;
  if ( addCombat ) {
    // Join the viewed combat unless it belongs to another scene; otherwise start a new one for this scene.
    combat = game.combats.viewed;
    if ( combat?.scene && (combat.scene.id !== scene.id) ) combat = null;
    combat ??= await foundry.utils.getDocumentClass("Combat").create({ scene: scene.id, active: true });
    const combatants = await TokenDocument.implementation.createCombatants(tokens, { combat });
    if ( initiative && combatants.length ) {
      await combat.rollInitiative(combatants.map((c) => c.id), { skipDialog: true, rollMode: CONST.DICE_ROLL_MODES.PRIVATE, updateTurn: true });
      for ( const c of combatants ) {
        const line = lines.find((l, i) => tokens[i].id === c.tokenId);
        if ( line ) line.init = combat.combatants.get(c.id)?.initiative ?? null;
      }
    }
  }

  // 4. GM-only summary card.
  const rows = lines.map((l) => `<li><strong>${foundry.utils.escapeHTML(l.name)}</strong>: HP ${l.hp}`
    + `${l.rolls.length ? ` <span class="es-sub">(${l.rolls.join(", ")})</span>` : ""}`
    + `${l.init !== null ? `, init ${l.init}` : ""}</li>`).join("");
  await ChatMessage.implementation.create({
    content: `<div class="agm-spawn-card"><p><i class="fa-solid fa-dragon"></i> <strong>Encounter spawned</strong> on ${foundry.utils.escapeHTML(scene.name)}`
      + `${hidden ? " (hidden)" : ""}</p><ul>${rows}</ul></div>`,
    whisper: gmUserIds(),
    speaker: { alias: "Encounter Spawner" }
  });
  return { tokens, combat, lines };
}
