// Quick HP & conditions: apply called-out damage, healing and PF1 conditions to the selected tokens from one window.
import { MODULE_ID } from "./util.mjs";
import { getApplyDamageClass } from "./apply-damage.mjs";

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
      toggleType: QuickHPApp.#onToggleType,
      clearTypes: QuickHPApp.#onClearTypes,
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
  /** Damage type ids picked (empty = untyped). Cleared after each apply, like the amount. */
  #types = new Set();
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
    return {
      rows, conds, amount: this.#amount, hasTargets: targets.length > 0, undo: this.#undo,
      typeGroups: this.#typeGroups(), typeLabel: this.#typeLabel()
    };
  }

  /** PF1's damage types (no modifiers, no untyped), grouped physical / energy / misc like PF1's own picker. */
  #typeGroups() {
    const order = ["physical", "energy", "misc"];
    const groups = order.map((key) => ({ key, types: [] }));
    for ( const dt of pf1.registry.damageTypes ) {
      if ( dt.isModifier || dt.id === "untyped" ) continue;
      const g = groups.find((x) => x.key === dt.category) ?? groups[2];
      g.types.push({ id: dt.id, name: game.i18n.localize(dt.name), icon: dt.icon, img: dt.img, color: dt.color, on: this.#types.has(dt.id) });
    }
    return groups.filter((g) => g.types.length);
  }

  #typeLabel() {
    if ( !this.#types.size ) return game.i18n.localize("PF1.DamageTypes.untyped.Label");
    return [...this.#types].map((id) => game.i18n.localize(pf1.registry.damageTypes.get(id)?.name ?? id)).join(" + ");
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

  static #onToggleType(event, target) {
    const id = target.dataset.id;
    if ( this.#types.has(id) ) this.#types.delete(id);
    else this.#types.add(id);
    this.render();
  }

  static #onClearTypes() {
    this.#types.clear();
    this.render();
  }

  static async #onApply(event, target) {
    const mode = target.dataset.mode;
    const typed = this.#types.size > 0 && ["damage", "half", "nonlethal"].includes(mode);
    const targets = this.targets;
    if ( !targets.length ) return ui.notifications.warn("Quick HP: select one or more tokens first.");
    const amt = await this.#resolveAmount();
    if ( !amt || amt.total <= 0 ) return ui.notifications.warn("Quick HP: enter an amount above 0.");

    const undo = targets.map((t) => ({ uuid: t.actor.uuid, name: t.name, hp: foundry.utils.deepClone(t.actor.system.attributes.hp) }));
    let value = amt.total;
    const typeLabel = this.#typeLabel();
    if ( typed ) {
      const dealt = mode === "half" ? Math.floor(value / 2) : value;
      const applied = await this.#applyTyped(targets, dealt, { asNonlethal: mode === "nonlethal", forceDialog: event.shiftKey });
      if ( !applied ) return; // dialog cancelled: nothing changed
    }
    else for ( const t of targets ) {
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
    const typeText = typed ? `${typeLabel.toLowerCase()} ` : "";
    this.#undo = { label: `${mode === "half" ? Math.floor(value / 2) : value} ${typeText}${verb} to ${targets.length} token(s)`, entries: undo };
    this.#amount = "";
    this.#types.clear();
    if ( amt.text !== String(amt.total) ) ui.notifications.info(`Quick HP: rolled ${amt.text}`);
    this.render();
  }

  /**
   * Apply typed damage through PF1's own Apply Damage logic, which works out DR, energy resistance and immunity per target.
   * If nothing on any target changes the damage, it goes straight through. Otherwise PF1's Apply Damage dialog opens,
   * pre-filled, so the GM can check the reductions before applying (Shift-click always opens it).
   * @returns {Promise<boolean>} false if the GM cancelled the dialog
   */
  async #applyTyped(targets, value, { asNonlethal = false, forceDialog = false } = {}) {
    const types = [...this.#types];
    const part = new pf1.models.action.DamagePartModel({ types });
    part.value = value;
    const actors = targets.map((t) => t.actor);

    let resolve;
    const done = new Promise((r) => { resolve = r; });
    const ApplyDamage = getApplyDamageClass();
    const app = new ApplyDamage({ value, targets: actors, instances: [part], asNonlethal, resolve });

    // Vulnerability is +50% in PF1; the dialog lists it but leaves the ratio at 1, so preset it.
    let needsReview = forceDialog;
    for ( const t of app.targets ) {
      if ( types.some((id) => t.actor.system.traits?.dv?.standard?.has?.(id)) ) {
        t.ratio = 1.5;
        app._refreshTarget(t.uuid);
      }
      if ( t.reduction.total > 0 || t.ratio !== 1 || t.dv.length || t.di.length ) needsReview = true;
    }

    if ( needsReview ) {
      app.render({ force: true });
      const result = await done;
      return !!result;
    }

    // Nothing reduces or multiplies it: apply directly, still passing the typed instances so PF1 hooks see the types.
    for ( const t of app.targets ) await t.actor.applyDamage(value, app._getTargetDamageOptions(t));
    return true;
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
