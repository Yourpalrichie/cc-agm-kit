// AGM Apply Damage: PF1's Apply Damage dialog with
//  - the footer button labelled "Apply to all N targets" and a "Deal N" button on each target,
//  - a plain-English breakdown per target ("30 − 5 DR = 25"),
//  - free-text DR/ER ("5/slashing (ectoplasmic form only)", "10/cold iron", "fire 10") read by type,
//    instead of PF1's default of treating any free-text DR as DR/— that nothing bypasses.
/** Words in free-text DR/ER mapped to PF1 damage type / material / alignment ids. */
const TYPE_WORDS = {
  slashing: "slashing", slash: "slashing", piercing: "piercing", pierce: "piercing",
  bludgeoning: "bludgeoning", blunt: "bludgeoning",
  magic: "magic", epic: "epic", adamantine: "adamantine", mithral: "mithral",
  "cold iron": "coldIron", "cold-iron": "coldIron", coldiron: "coldIron",
  silver: "alchemicalSilver", "alchemical silver": "alchemicalSilver",
  good: "good", evil: "evil", lawful: "lawful", chaotic: "chaotic", law: "lawful", chaos: "chaotic",
  fire: "fire", cold: "cold", electricity: "electric", electric: "electric", acid: "acid", sonic: "sonic"
};
const GENERIC = new Set(["", "-", "—", "–", "--"]);

/**
 * Parse a free-text DR/ER entry.
 * @returns {{ids:string[], operator:boolean, note:string}|null} null if any word isn't recognised (leave it to PF1).
 */
export function parseCustomResistance(text, isDR) {
  let s = String(text ?? "").trim();
  const note = /\(([^)]*)\)/.exec(s)?.[1]?.trim() ?? "";
  s = s.replace(/\([^)]*\)/g, " ").replace(/\d+/g, " ").replace(/\//g, " ").replace(/\bresist(ance)?\b/gi, " ")
    .replace(/\s+/g, " ").trim().toLowerCase();
  if ( GENERIC.has(s) ) return isDR ? { ids: [], operator: true, note } : null;
  const operator = !/\band\b/.test(s); // "and" = AND, "or" or single = OR
  const words = s.split(/\s*(?:\band\b|\bor\b|,)\s*/).map((w) => w.trim()).filter(Boolean);
  const ids = [];
  for ( const w of words ) {
    const id = TYPE_WORDS[w];
    if ( !id ) return null;
    ids.push(id);
  }
  return ids.length ? { ids, operator, note } : null;
}

let AgmApplyDamage;

/** Build lazily: pf1.applications only exists once the system has loaded. */
export function getApplyDamageClass() {
  if ( AgmApplyDamage ) return AgmApplyDamage;
  const Base = pf1.applications.ApplyDamage;

  AgmApplyDamage = class extends Base {
    _agmApplied = [];

    static DEFAULT_OPTIONS = {
      classes: ["agm-apply-damage"],
      actions: { applyOne: this._agmApplyOne }
    };

    _preparePartContext(partId, context, options) {
      context = super._preparePartContext(partId, context, options);
      if ( partId === "footer" && context.buttons?.[0] ) {
        const n = this.targets.size;
        context.buttons[0].label = `${this.isHealing ? "Heal" : "Apply to"} all ${n} target${n === 1 ? "" : "s"}`;
        context.buttons[0].icon = "fa-solid fa-heart-pulse";
      }
      return context;
    }

    async _onRender(context, options) {
      await super._onRender?.(context, options);
      const verb = this.isHealing ? "Heal" : "Deal";
      for ( const el of this.element.querySelectorAll(".target[data-uuid]") ) {
        const t = this.targets.get(el.dataset.uuid);
        const h = el.querySelector(".target-ident");
        if ( !t || !h || h.querySelector(".agm-apply-one") ) continue;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "agm-apply-one";
        btn.dataset.action = "applyOne";
        btn.dataset.uuid = t.uuid;
        btn.dataset.tooltip = `Apply to ${t.name} only`;
        btn.innerHTML = `<i class="fa-solid fa-${this.isHealing ? "heart" : "burst"}"></i> ${verb} ${t.value}`;
        h.append(btn);
        const sum = document.createElement("div");
        sum.className = "agm-ad-summary";
        sum.textContent = this._agmSummary(t);
        h.after(sum);
      }
    }

    /** "30 × 1.5 = 45 − 5 DR − 10 resist = 30" style breakdown. */
    _agmSummary(t) {
      const base = this.instances.reduce((n, i) => n + (i.value || 0), 0) + (this.bonus || 0);
      let text = String(base);
      const ratio = t.ratio ?? 0;
      if ( ratio !== 1 ) text += ratio ? ` × ${ratio} = ${Math.floor(base * ratio)}` : " × none = 0";
      const r = t.reduction ?? {};
      const cuts = [];
      if ( r.immunized ) cuts.push(`${r.immunized} immune`);
      if ( r.physical ) cuts.push(`${r.physical} DR`);
      if ( r.energy ) cuts.push(`${r.energy} resist`);
      if ( r.hardness ) cuts.push(`${r.hardness} hardness`);
      if ( r.individual || r.general ) cuts.push(`${(r.individual || 0) + (r.general || 0)} manual`);
      if ( cuts.length ) text += ` − ${cuts.join(" − ")}`;
      if ( cuts.length || ratio !== 1 ) text += ` = ${t.value}`;
      else text += " (nothing reduces it)";
      return text;
    }

    /** Read free-text DR/ER by type, then apply PF1's own default on/off rules to it. */
    getResistances(actor, resistanceType = "dr") {
      const list = super.getResistances(actor, resistanceType);
      const isDR = resistanceType === "dr";
      const allTypes = new Set(this.instances.flatMap((i) => [...i.types]));
      const common = new Set(this.materials);
      if ( this.isMagic ) common.add("magic");
      for ( const c of common ) allTypes.add(c);

      for ( const res of list ) {
        if ( !res.custom ) continue;
        const parsed = parseCustomResistance(res.type0?.name ?? "", isDR);
        if ( !parsed ) continue;
        res.custom = false;
        res.agmParsed = true;
        res.operator = parsed.operator;
        res.types = parsed.ids;
        res.typeIds = new Set(parsed.ids);
        res.type0 = { id: parsed.ids[0], name: res.type0?.name };
        res.type1 = parsed.ids[1] ? { id: parsed.ids[1] } : undefined;
        res.hasGeneric = isDR && parsed.ids.length === 0;
        res.disabled = false;
        for ( const id of parsed.ids ) this.resistanceIds.add(id);

        if ( res.hasGeneric ) res.active = true;
        else if ( isDR ) {
          // Same rule as PF1: DR stays on unless the attack has what bypasses it.
          if ( res.operator ) {
            res.active = !res.typeIds.some((id) => allTypes.has(id))
              || this.instances.some((i) => !res.typeIds.intersects(new Set(i.types).union(common)));
          }
          else {
            res.active = !res.typeIds.every((id) => allTypes.has(id))
              || !this.instances.every((i) => !res.typeIds.intersects(new Set(i.types).union(common)));
          }
        }
        else {
          res.active = res.typeIds.some((id) => allTypes.has(id));
          if ( !res.active ) res.disabled = true;
        }
      }
      return list;
    }

    /** Apply to a single target, drop it from the list, close when none are left. */
    static async _agmApplyOne(event, button) {
      const t = this.targets.get(button.dataset.uuid);
      if ( !t ) return;
      let value = Math.max(0, this.value);
      if ( this.isHealing ) value = -value;
      value += this.bonus || 0;
      button.disabled = true;
      const res = await t.actor.applyDamage(value, this._getTargetDamageOptions(t));
      if ( res ) this._agmApplied.push(t.actor);
      ui.notifications.info(`${this.isHealing ? "Healed" : "Dealt"} ${t.value} to ${t.name}.`);
      this.targets.delete(t.uuid);
      if ( !this.targets.size ) return this.close();
      this.render();
    }

    /** If some targets were applied one by one, report that instead of "cancelled". */
    _onClose(options) {
      if ( this.resolve && this._agmApplied.length ) {
        const resolve = this.resolve;
        this.resolve = null;
        resolve({ updated: this._agmApplied });
      }
      return super._onClose(options);
    }
  };
  return AgmApplyDamage;
}
