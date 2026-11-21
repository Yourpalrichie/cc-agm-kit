// Quick HP & conditions: apply called-out damage, healing and PF1 conditions to the selected tokens from one window.
import { MODULE_ID } from "./util.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class QuickHPApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agm-quick-hp",
    classes: ["agm-quick-hp"],
    window: { title: "Quick HP & Conditions", icon: "fa-solid fa-heart-pulse", resizable: true },
    position: { width: 420, height: "auto" },
    actions: {
      apply: QuickHPApp.#onApply,
      condition: QuickHPApp.#onCondition,
      removeCondition: QuickHPApp.#onRemoveCondition,
      toggleTarget: QuickHPApp.#onToggleTarget,
      undo: QuickHPApp.#onUndo
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/quick-hp.hbs` }
  };

  static #instance;
  static get instance() {
    return this.#instance ??= new this();
  }

  static open() {
    if ( !game.user.isGM ) return ui.notifications.warn("Quick HP is GM-only.");
    const app = this.instance;
    if ( app.rendered ) app.bringToFront();
    else app.render({ force: true });
    return app;
  }

  /** Token ids the GM unticked in the list (kept while the selection lasts). */
  #excluded = new Set();
  /** Amount typed, kept across re-renders. */
  #amount = "";
  /** Last HP change, for Undo: [{uuid, name, hp}] */
  #undo = null;

  /** Selected tokens with an actor. */
  get tokens() {
    return canvas.tokens?.controlled.filter((t) => t.actor) ?? [];
  }

  /** Selected tokens the GM hasn't unticked. */
  get targets() {
    return this.tokens.filter((t) => !this.#excluded.has(t.id));
  }

  async _prepareContext() {
    const conditions = pf1.registry.conditions.contents ?? [...pf1.registry.conditions];
    const tokens = this.tokens;
    const targets = this.targets;
    const rows = tokens.map((t) => {
      const hp = t.actor.system.attributes?.hp ?? {};
      const statuses = conditions.filter((c) => t.actor.statuses.has(c.id))
        .map((c) => ({ id: c.id, name: game.i18n.localize(c.name), img: c.texture }));
      const pct = hp.max ? Math.clamp((hp.value / hp.max) * 100, 0, 100) : 0;
      return {
        id: t.id, name: t.name, img: t.document.texture.src,
        hp: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp || 0, nonlethal: hp.nonlethal || 0,
        pct, low: pct <= 25, down: (hp.value ?? 0) <= 0,
        included: !this.#excluded.has(t.id), statuses
      };
    });
    const conds = conditions.map((c) => {
      const n = targets.filter((t) => t.actor.statuses.has(c.id)).length;
      return {
        id: c.id, name: game.i18n.localize(c.name), img: c.texture,
        state: !targets.length || n === 0 ? "" : n === targets.length ? "on" : "some"
      };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return { rows, conds, amount: this.#amount, hasTargets: targets.length > 0, undo: this.#undo };
  }

  _onRender(context, options) {
    const input = this.element.querySelector("input[name=amount]");
    if ( !input ) return;
    input.addEventListener("input", (ev) => { this.#amount = ev.currentTarget.value; });
    input.addEventListener("keydown", (ev) => {
      if ( ev.key !== "Enter" ) return;
      ev.preventDefault();
      // Enter = damage, Shift+Enter = heal
      QuickHPApp.#onApply.call(this, ev, { dataset: { mode: ev.shiftKey ? "heal" : "damage" } });
    });
    if ( options.isFirstRender ) input.focus();
  }

  _onFirstRender() {
    const rerender = foundry.utils.debounce(() => this.rendered && this.render(), 50);
    const onControl = () => { this.#prunExcluded(); rerender(); };
    this._hooks = [
      ["controlToken", onControl],
      ["updateActor", rerender],
      ["updateToken", rerender],
      ["createActiveEffect", rerender],
      ["deleteActiveEffect", rerender],
      ["canvasReady", onControl]
    ].map(([name, fn]) => [name, Hooks.on(name, fn)]);
  }

  _onClose() {
    for ( const [name, id] of this._hooks ?? [] ) Hooks.off(name, id);
    this._hooks = null;
  }

  #prunExcluded() {
    const ids = new Set(this.tokens.map((t) => t.id));
    for ( const id of this.#excluded ) if ( !ids.has(id) ) this.#excluded.delete(id);
  }

  /* ---------------------------------------- */

  /** Parse the amount: a number or a dice formula (rolled once for all targets). */
  async #resolveAmount() {
    const raw = String(this.#amount ?? "").trim();
    if ( !raw ) return null;
    if ( /^\d+$/.test(raw) ) return { total: Number(raw), text: raw };
    try {
      const roll = await new Roll(raw).evaluate();
      return { total: roll.total, text: `${raw} = ${roll.total}` };
    } catch {
      ui.notifications.warn(`Quick HP: "${raw}" isn't a number or dice formula.`);
      return null;
    }
  }

  static async #onApply(event, target) {
    const mode = target.dataset.mode;
    const targets = this.targets;
    if ( !targets.length ) return ui.notifications.warn("Quick HP: select one or more tokens first.");
    const amt = await this.#resolveAmount();
    if ( !amt || amt.total <= 0 ) return ui.notifications.warn("Quick HP: enter an amount above 0.");

    const undo = targets.map((t) => ({ uuid: t.actor.uuid, name: t.name, hp: foundry.utils.deepClone(t.actor.system.attributes.hp) }));
    let value = amt.total;
    for ( const t of targets ) {
      const actor = t.actor;
      switch ( mode ) {
        case "damage": await actor.applyDamage(value); break;
        case "half": await actor.applyDamage(Math.floor(value / 2)); break;
        case "nonlethal": await actor.applyDamage(value, { asNonlethal: true }); break;
        case "heal": await actor.applyDamage(-value); break;
        case "temp": await actor.update({ "system.attributes.hp.temp": Math.max(actor.system.attributes.hp.temp || 0, value) }); break;
      }
    }
    const verb = { damage: "damage", half: "half damage", nonlethal: "nonlethal damage", heal: "healing", temp: "temp HP" }[mode];
    this.#undo = { label: `${mode === "half" ? Math.floor(value / 2) : value} ${verb} to ${targets.length} token(s)`, entries: undo };
    this.#amount = "";
    if ( amt.text !== String(amt.total) ) ui.notifications.info(`Quick HP: rolled ${amt.text}`);
    this.render();
  }

  static async #onUndo() {
    const u = this.#undo;
    if ( !u ) return;
    for ( const e of u.entries ) {
      const actor = await fromUuid(e.uuid);
      if ( !actor ) continue;
      await actor.update({
        "system.attributes.hp.value": e.hp.value,
        "system.attributes.hp.temp": e.hp.temp,
        "system.attributes.hp.nonlethal": e.hp.nonlethal
      });
    }
    this.#undo = null;
    ui.notifications.info(`Quick HP: undid ${u.label}.`);
    this.render();
  }

  /** Toggle a condition on all ticked targets: if every target has it, remove it; otherwise add it to all. */
  static async #onCondition(event, target) {
    const id = target.dataset.id;
    const targets = this.targets;
    if ( !targets.length ) return ui.notifications.warn("Quick HP: select one or more tokens first.");
    const enable = !targets.every((t) => t.actor.statuses.has(id));
    for ( const t of targets ) await t.actor.setCondition(id, enable);
  }

  static async #onRemoveCondition(event, target) {
    const token = canvas.tokens.get(target.closest("[data-token]")?.dataset.token);
    if ( token?.actor ) await token.actor.setCondition(target.dataset.id, false);
  }

  static #onToggleTarget(event, target) {
    const id = target.closest("[data-token]")?.dataset.token;
    if ( !id ) return;
    if ( this.#excluded.has(id) ) this.#excluded.delete(id);
    else this.#excluded.add(id);
    this.render();
  }
}
