// Sanity tracker: PF1 Horror Adventures sanity rules. Ported from Richie's Sanity Tracker macro.
// Data lives on each actor at flags.cc-agm-kit.sanity (falls back to the macro's flags.world.sanity).
// Nothing here deletes documents: madness buffs are reused or switched off instead (Assistant GM rule).
import { MODULE_ID } from "../util.mjs";
import { AON, RULES, MADNESSES, BY_KEY, EFFECTS } from "./data.mjs";

const { ApplicationV2, DialogV2 } = foundry.applications.api;

// ---------- Data ----------
const FLAG = "sanity";
const LEGACY_SCOPE = "world";
const safe = async (fn) => { try { return await fn(); } catch { return null; } };
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

function rawData(actor) {
  return actor.getFlag(MODULE_ID, FLAG) ?? actor.flags?.[LEGACY_SCOPE]?.[FLAG];
}

export function getData(actor) {
  const d = foundry.utils.deepClone(rawData(actor) ?? {});
  d.damage ??= 0;
  d.madnesses ??= [];
  d.adj ??= { score: 0, threshold: 0 };
  d.log ??= [];
  return d;
}

async function saveData(actor, d) {
  await actor.update({ [`flags.${MODULE_ID}.${FLAG}`]: d });
  await syncBuffs(actor, d);
}

// ---------- Madness → PF1 buff effects ----------
function effectFor(m) {
  const def = EFFECTS[m.key];
  if (!def || m.effects === false) return null;
  const state = m.dormant ? "dormant" : "active";
  const e = def[state];
  if (!e) return null;
  const conditions = typeof e.k === "function" ? e.k(m) : e.k ?? [];
  if (!e.c?.length && !e.n?.length && !conditions.length) return null;
  return { state, e, conditions, sig: `${state}|${m.variant ?? ""}|${m.notes ?? ""}` };
}

function describeEffect(m) {
  const f = effectFor(m);
  if (!f) return m.effects === false ? "Sheet effects OFF" : EFFECTS[m.key] ? "No sheet effect while dormant" : "No automated effect";
  const parts = (f.e.c ?? []).map(([t, v]) => `${v} ${t}`);
  if (f.conditions.length) parts.push(`condition: ${f.conditions.join(", ")}`);
  if (f.e.n?.length) parts.push(`${f.e.n.length} note(s)`);
  return `On sheet (${f.state}): ${parts.join(", ")}`;
}

function buffData(m, f) {
  const b = BY_KEY[m.key];
  return {
    name: `Madness: ${m.name}${m.dormant ? " (dormant)" : ""}`,
    img: "icons/svg/terror.svg",
    "system.changes": (f.e.c ?? []).map(([target, formula]) => ({ formula, target, type: "untyped", operator: "add" })),
    "system.contextNotes": (f.e.n ?? []).map(([target, text]) => ({ target, text })),
    "system.conditions": f.conditions,
    "system.description.value": `<p><a href="${AON(b?.name ?? m.name)}" target="_blank">${esc(m.name)}</a> (${m.tier} madness${m.dormant ? ", dormant" : ""})</p>
      <p>${esc(b?.effect ?? "")}</p>${m.notes ? `<p><i>${esc(m.notes)}</i></p>` : ""}
      <p><small>Managed by the Sanity Tracker. Changes here are overwritten on the next sync.</small></p>`,
    [`flags.${MODULE_ID}.sanityMadness`]: m.id,
    [`flags.${MODULE_ID}.sanitySig`]: f.sig
  };
}

/** Madness id a buff belongs to ("" = spare), or undefined if it isn't a tracker buff. Reads both flag scopes. */
function buffMadnessId(item) {
  const own = item.flags?.[MODULE_ID];
  if ( own && ("sanityMadness" in own) ) return own.sanityMadness ?? "";
  return item.flags?.[LEGACY_SCOPE]?.sanityMadness;
}
const buffSig = (item) => item.flags?.[MODULE_ID]?.sanitySig ?? item.flags?.[LEGACY_SCOPE]?.sanitySig;

async function setBuffActive(item, active) {
  if ( item.system.active === active ) return;
  if ( typeof item.setActive === "function" ) await item.setActive(active);
  else await item.update({ "system.active": active });
}

/**
 * Make the actor's madness buffs match its madness list.
 * Changed buffs are updated in place, cured madnesses' buffs are switched off and kept as spares for reuse.
 */
export async function syncBuffs(actor, d = getData(actor)) {
  const tracked = actor.items.filter((i) => i.type === "buff" && buffMadnessId(i) !== undefined);
  const want = new Map();
  for ( const m of d.madnesses ) {
    const f = effectFor(m);
    if ( f ) want.set(m.id, { m, f });
  }
  const byMadness = new Map();
  const spares = [];
  for ( const item of tracked ) {
    const id = buffMadnessId(item);
    if ( id && want.has(id) && !byMadness.has(id) ) byMadness.set(id, item);
    else spares.push(item);
  }
  // Retire unwanted buffs first so they can be reused below.
  for ( const item of spares ) {
    if ( buffMadnessId(item) === "" && !item.system.active ) continue;
    await setBuffActive(item, false);
    await item.update({
      name: "Madness (unused)",
      [`flags.${MODULE_ID}.sanityMadness`]: "",
      [`flags.${MODULE_ID}.sanitySig`]: "",
      "system.changes": [], "system.contextNotes": [], "system.conditions": []
    });
  }
  const toCreate = [];
  for ( const [id, { m, f }] of want ) {
    let item = byMadness.get(id);
    if ( item && buffSig(item) === f.sig ) {
      await setBuffActive(item, true);
      continue;
    }
    item ??= spares.shift();
    if ( item ) {
      await item.update(buffData(m, f));
      await setBuffActive(item, true);
    }
    else toCreate.push(foundry.utils.expandObject({ type: "buff", "system.subType": "temp", "system.active": false, ...buffData(m, f) }));
  }
  if ( !toCreate.length ) return;
  const created = await actor.createEmbeddedDocuments("Item", toCreate);
  for ( const item of created ) await setBuffActive(item, true);
}

// ---------- Derived stats ----------
const isPhantom = (actor) =>
  actor.items.some((i) => i.type === "race" && /phantom/i.test(i.name)) ||
  /phantom/i.test(actor.system?.traits?.type ?? "");

export function isTracked(actor) {
  const t = rawData(actor)?.tracked;
  if ( t === true || t === false ) return t;
  return actor.type === "character" || isPhantom(actor);
}

export function stats(actor) {
  const d = getData(actor);
  const a = actor.system.abilities ?? {};
  const eff = (k) => {
    const abl = a[k];
    if ( !abl || abl.value === null || abl.total === null ) return null;
    return Math.max(0, (abl.total ?? abl.value ?? 10) - (abl.damage ?? 0));
  };
  const int = eff("int"), wis = eff("wis"), cha = eff("cha");
  if ( int === null ) return { mindless: true, d };
  const score = Math.max(0, int + (wis ?? 0) + (cha ?? 0) + (Number(d.adj.score) || 0));
  const edge = Math.floor(score / 2);
  const highest = Math.max(int, wis ?? 0, cha ?? 0);
  const threshold = Math.max(0, Math.floor((highest - 10) / 2) + (Number(d.adj.threshold) || 0));
  const chaMod = Math.floor(((cha ?? 10) - 10) / 2);
  let status = "Stable";
  if ( d.damage >= score ) status = "Insane";
  else if ( d.damage >= edge ) status = "Past Edge";
  else if ( d.damage > 0 ) status = "Strained";
  return { mindless: false, d, int, wis, cha, score, edge, threshold, chaMod, status };
}

// Dormancy: all dormant at 0 damage; greater wake on any damage; lesser wake at/above edge.
function applyDormancy(d, edge) {
  const woke = [];
  for ( const m of d.madnesses ) {
    const was = m.dormant;
    if ( d.damage <= 0 ) m.dormant = true;
    else if ( m.tier === "greater" ) m.dormant = false;
    else if ( d.damage >= edge ) m.dormant = false;
    if ( was && !m.dormant ) woke.push(m.name);
  }
  return woke;
}

const pushLog = (d, text) => {
  d.log.unshift({ t: Date.now(), text });
  d.log = d.log.slice(0, 30);
};

const madLink = (m) => {
  const base = BY_KEY[m.key];
  return base ? `<a href="${AON(base.name)}" target="_blank">${esc(m.name)}</a>` : esc(m.name);
};

const whisperOn = () => game.settings.get(MODULE_ID, "sanityWhisper");
const gmIds = () => game.users.filter((u) => u.isGM).map((u) => u.id);

async function chat(actor, lines) {
  const content = `<div class="sanity-card"><h3><i class="fa-solid fa-brain"></i> ${esc(actor.name)}: Sanity</h3>${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
  const data = { content, speaker: ChatMessage.implementation.getSpeaker({ actor }) };
  if ( whisperOn() ) data.whisper = gmIds();
  return ChatMessage.implementation.create(data);
}

async function rollFormula(formula) {
  const f = String(formula ?? "").trim();
  if ( !f ) return null;
  if ( /^-?\d+$/.test(f) ) return { total: Number(f), text: f };
  const r = await new Roll(f).evaluate();
  if ( game.dice3d ) game.dice3d.showForRoll(r, game.user, true, whisperOn() ? gmIds() : null);
  return { total: r.total, text: `${f} = ${r.total}` };
}

// ---------- Madness picker ----------
async function pickMadness(actor, tier, reason) {
  const opts = (t) =>
    MADNESSES.filter((m) => m.tier === t)
      .map((m) => `<option value="${m.key}">${m.name}${m.alias ? ` (${m.alias})` : ""}: DC ${m.dc}, onset ${m.onset}</option>`)
      .join("");
  const content = `
    <p>${reason ?? ""}</p>
    <div class="form-group"><label>Tier</label>
      <select name="tier">
        <option value="lesser" ${tier === "lesser" ? "selected" : ""}>Lesser</option>
        <option value="greater" ${tier === "greater" ? "selected" : ""}>Greater</option>
      </select></div>
    <div class="form-group"><label>Madness</label>
      <select name="key">
        <option value="__random">Roll randomly (d%) for the tier</option>
        <optgroup label="Lesser">${opts("lesser")}</optgroup>
        <optgroup label="Greater">${opts("greater")}</optgroup>
        <option value="__custom">Custom (type name below)</option>
      </select></div>
    <div class="form-group"><label>Custom name</label><input type="text" name="custom" placeholder="Only for custom"></div>
    <div class="form-group"><label>Notes</label><input type="text" name="notes" placeholder="e.g. phobia of deep water; mania for idols"></div>
    <div class="form-group"><label>Apply sheet effects now</label><input type="checkbox" name="effects" checked></div>
    <p class="hint">Sheet effects are added as a buff on the actor (penalties, context notes, conditions). Untick if onset hasn't happened yet; switch it on later with the bolt on the madness chip.</p>
    <p class="hint">Rules: <a href="${RULES.madness}" target="_blank">Madness (AoN)</a>. The GM usually picks a madness that fits the horror.</p>`;
  const res = await safe(() => DialogV2.wait({
    window: { title: `Madness: ${actor.name}` },
    position: { width: 480 },
    content,
    buttons: [
      { action: "add", label: "Add Madness", default: true, callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) },
      { action: "skip", label: "Skip" }
    ]
  }));
  if ( !res || res === "skip" ) return null;
  let base, rollText = "";
  if ( res.key === "__random" ) {
    const r = await new Roll("1d100").evaluate();
    base = MADNESSES.find((m) => m.tier === res.tier && r.total >= m.d[0] && r.total <= m.d[1]);
    rollText = ` (d% ${r.total})`;
  } else if ( res.key === "__custom" ) {
    if ( !res.custom?.trim() ) return ui.notifications.warn("Custom madness needs a name."), null;
    return { id: foundry.utils.randomID(), key: null, name: res.custom.trim(), tier: res.tier, dormant: false, notes: res.notes ?? "", gainedAt: Date.now(), rollText };
  } else base = BY_KEY[res.key];
  let variant;
  if ( base.key === "psychosomatic-loss" ) {
    variant = await safe(() => DialogV2.wait({
      window: { title: `Psychosomatic Loss: ${actor.name}` },
      content: `<p>${rollText ? `Rolled${esc(rollText)}: ` : ""}What does ${esc(actor.name)} lose?</p>`,
      buttons: [
        { action: "blind", label: "Blinded" },
        { action: "deaf", label: "Deafened" },
        { action: "other", label: "Other (sense, limb, movement)", default: true }
      ]
    })) ?? "other";
  }
  return {
    id: foundry.utils.randomID(), key: base.key, name: base.name, tier: base.tier, dormant: false,
    notes: res.notes ?? "", gainedAt: Date.now(), rollText,
    effects: res.effects === "on",
    variant
  };
}

// ---------- Actions ----------
async function sanityAttack(actor) {
  const s = stats(actor);
  if ( s.mindless ) return ui.notifications.warn(`${actor.name} is mindless and immune to sanity damage.`);
  const content = `
    <p>Score <b>${s.score}</b> · Edge <b>${s.edge}</b> · Threshold <b>${s.threshold}</b> · Current damage <b>${s.d.damage}</b></p>
    <div class="form-group"><label>Sanity damage</label><input type="text" name="formula" value="1d4" autofocus></div>
    <div class="form-group"><label>Will save result</label>
      <select name="save">
        <option value="none">No save / failed</option>
        <option value="half">Succeeded: half damage</option>
        <option value="negate">Succeeded: negated</option>
      </select></div>
    <div class="form-group"><label>Source</label><input type="text" name="source" placeholder="e.g. Saw the Splatter Man's message"></div>
    <p class="hint">Each separate instance of 1+ sanity damage is a sanity attack. One attack at or above threshold = a madness (<a href="${RULES.effects}" target="_blank">rules</a>).</p>`;
  const res = await safe(() => DialogV2.wait({
    window: { title: `Sanity Attack: ${actor.name}` },
    position: { width: 440 },
    content,
    buttons: [{ action: "ok", label: "Apply", default: true, callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) }, { action: "cancel", label: "Cancel" }]
  }));
  if ( !res || res === "cancel" ) return;
  const roll = await rollFormula(res.formula);
  if ( !roll ) return;
  let amt = Math.max(0, roll.total);
  if ( res.save === "half" ) amt = Math.floor(amt / 2);
  if ( res.save === "negate" ) amt = 0;

  const d = s.d;
  const before = d.damage;
  const lines = [];
  if ( res.source ) lines.push(`<i>${esc(res.source)}</i>`);
  lines.push(`Sanity damage: <b>${amt}</b> (${esc(roll.text)}${res.save === "half" ? ", halved by save" : res.save === "negate" ? ", negated by save" : ""})`);
  if ( amt <= 0 ) {
    lines.push("No sanity damage taken.");
    pushLog(d, `Attack negated${res.source ? ` (${res.source})` : ""}`);
    await saveData(actor, d);
    return chat(actor, lines);
  }
  d.damage = before + amt;
  lines.push(`Damage <b>${before} → ${d.damage}</b> / ${s.score} (edge ${s.edge})`);

  const woke = applyDormancy(d, s.edge);
  if ( before < s.edge && d.damage >= s.edge ) lines.push("<b>Crossed sanity edge.</b>");
  if ( woke.length ) lines.push(`Dormant madness reawakens: <b>${woke.map(esc).join(", ")}</b>`);

  let gained = null;
  if ( amt >= s.threshold ) {
    const tier = d.damage >= s.edge ? "greater" : "lesser";
    lines.push(`Attack met threshold (${amt} ≥ ${s.threshold}): gains a <b>${tier}</b> madness.`);
    gained = await pickMadness(actor, tier, `${amt} sanity damage met ${esc(actor.name)}'s threshold of ${s.threshold}. Total damage ${d.damage} is ${tier === "greater" ? "at/above" : "below"} the edge (${s.edge}), so the madness is <b>${tier}</b>.`);
    if ( gained ) {
      d.madnesses.push(gained);
      const b = BY_KEY[gained.key];
      lines.push(`New madness: <b>${madLink(gained)}</b>${esc(gained.rollText)}${gained.notes ? `: ${esc(gained.notes)}` : ""}${b ? `<br><small>Will DC ${b.dc}, onset ${b.onset}. ${esc(b.effect)}</small>` : ""}<br><small>${esc(describeEffect(gained))}</small>`);
    } else lines.push("(Madness not recorded: GM skipped.)");
  }
  if ( before < s.score && d.damage >= s.score ) {
    lines.push(`<b>INSANE</b>: acts as under <a href="https://aonprd.com/SpellDisplay.aspx?ItemName=Insanity" target="_blank">insanity</a> (permanent confusion, no save) until all sanity damage is healed and all madnesses are cured.`);
  }
  pushLog(d, `−${amt} sanity${res.source ? ` (${res.source})` : ""} → ${d.damage}/${s.score}${gained ? `; gained ${gained.name}` : ""}`);
  delete gained?.rollText;
  await saveData(actor, d);
  return chat(actor, lines);
}

async function sanityHeal(actor) {
  const s = stats(actor);
  if ( s.mindless ) return;
  const restAmt = Math.max(1, s.chaMod);
  const setTo = s.d.damage < s.edge ? 0 : Math.max(0, s.edge - 1);
  const content = `
    <p>Current damage <b>${s.d.damage}</b> / ${s.score} (edge ${s.edge})</p>
    <div class="form-group"><label>Method</label>
      <select name="method">
        <option value="custom">Custom amount (below)</option>
        <option value="rest">7 days of uninterrupted rest: ${restAmt} (Cha mod, min 1)</option>
        <option value="advisor">Rest + advisor: ${restAmt} + advisor bonus (below)</option>
        <option value="lesser">Lesser restoration: 1d2</option>
        <option value="restoration">Restoration: 2d4</option>
        <option value="heal">Heal: 3d4</option>
        <option value="greater">Greater restoration / psychic surgery / limited wish: set to ${setTo}</option>
        <option value="wish">Miracle / wish: set to 0</option>
      </select></div>
    <div class="form-group"><label>Custom amount / advisor bonus</label><input type="text" name="formula" placeholder="e.g. 2 or 1d4"></div>
    <p class="hint">Advisor: Wis or Int check DC ${s.d.damage < s.edge ? 15 : 20}; on success adds their higher Wis/Int mod. Spells work once per day. <a href="${RULES.recovery}" target="_blank">Recovery rules</a></p>`;
  const res = await safe(() => DialogV2.wait({
    window: { title: `Recover Sanity: ${actor.name}` },
    position: { width: 480 },
    content,
    buttons: [{ action: "ok", label: "Apply", default: true, callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) }, { action: "cancel", label: "Cancel" }]
  }));
  if ( !res || res === "cancel" ) return;
  const d = s.d;
  const before = d.damage;
  let label, text = "";
  const dice = { lesser: "1d2", restoration: "2d4", heal: "3d4" };
  if ( res.method in dice ) {
    const r = await rollFormula(dice[res.method]);
    d.damage = Math.max(0, before - r.total); text = r.text;
    label = { lesser: "Lesser restoration", restoration: "Restoration", heal: "Heal" }[res.method];
  } else if ( res.method === "rest" ) {
    d.damage = Math.max(0, before - restAmt); label = "7 days of rest"; text = String(restAmt);
  } else if ( res.method === "advisor" ) {
    const r = (await rollFormula(res.formula)) ?? { total: 0, text: "0" };
    d.damage = Math.max(0, before - restAmt - r.total); label = "Rest with advisor"; text = `${restAmt} + ${r.text}`;
  } else if ( res.method === "greater" ) {
    d.damage = Math.min(before, setTo); label = "Greater restoration / psychic surgery / limited wish";
  } else if ( res.method === "wish" ) {
    d.damage = 0; label = "Miracle / wish";
  } else {
    const r = await rollFormula(res.formula);
    if ( !r ) return ui.notifications.warn("Enter an amount.");
    d.damage = Math.max(0, before - r.total); label = "Recovery"; text = r.text;
  }
  const lines = [`${label}${text ? ` (${esc(text)})` : ""}: damage <b>${before} → ${d.damage}</b> / ${s.score}`];
  const wasDormant = d.madnesses.filter((m) => m.dormant).length;
  applyDormancy(d, s.edge);
  if ( d.damage === 0 && d.madnesses.length && d.madnesses.filter((m) => m.dormant).length > wasDormant )
    lines.push("All sanity damage healed: madnesses go <b>dormant</b> (only miracle or wish removes dormant madnesses).");
  if ( before >= s.score && d.damage < s.score ) lines.push("No longer at sanity score, but insanity persists until damage is 0 and all madnesses are cured.");
  pushLog(d, `+${before - d.damage} sanity (${label}) → ${d.damage}/${s.score}`);
  await saveData(actor, d);
  return chat(actor, lines);
}

async function addMadness(actor) {
  const s = stats(actor);
  if ( s.mindless ) return;
  const m = await pickMadness(actor, s.d.damage >= s.edge ? "greater" : "lesser", "Add a madness manually (no damage applied).");
  if ( !m ) return;
  const rollText = m.rollText; delete m.rollText;
  const d = s.d;
  d.madnesses.push(m);
  pushLog(d, `Gained ${m.name} (manual)`);
  await saveData(actor, d);
  chat(actor, [`Gains madness <b>${madLink(m)}</b>${esc(rollText ?? "")}${m.notes ? `: ${esc(m.notes)}` : ""}<br><small>${esc(describeEffect(m))}</small>`]);
}

async function removeMadness(actor, id) {
  const d = getData(actor);
  const m = d.madnesses.find((x) => x.id === id);
  if ( !m ) return;
  const ok = await safe(() => DialogV2.confirm({
    window: { title: "Cure Madness" },
    content: `<p>Remove <b>${esc(m.name)}</b> from ${esc(actor.name)}?</p>${m.dormant ? "<p class='hint'>This madness is dormant. By the rules only <i>miracle</i> or <i>wish</i> removes dormant madnesses.</p>" : ""}`
  }));
  if ( !ok ) return;
  d.madnesses = d.madnesses.filter((x) => x.id !== id);
  pushLog(d, `Cured ${m.name}`);
  await saveData(actor, d);
  chat(actor, [`Madness cured: <b>${madLink(m)}</b>`]);
}

async function toggleDormant(actor, id) {
  const d = getData(actor);
  const m = d.madnesses.find((x) => x.id === id);
  if ( !m ) return;
  m.dormant = !m.dormant;
  await saveData(actor, d);
}

async function toggleEffects(actor, id) {
  const d = getData(actor);
  const m = d.madnesses.find((x) => x.id === id);
  if ( !m ) return;
  m.effects = m.effects === false;
  await saveData(actor, d);
  ui.notifications.info(`${m.name}: sheet effects ${m.effects ? "ON" : "OFF"}`);
}

async function resyncAll() {
  const actors = game.actors.filter(isTracked);
  for ( const a of actors ) await syncBuffs(a);
  ui.notifications.info(`Madness buffs synced for ${actors.length} actor(s).`);
}

async function editNotes(actor, id) {
  const d = getData(actor);
  const m = d.madnesses.find((x) => x.id === id);
  if ( !m ) return;
  const res = await safe(() => DialogV2.prompt({
    window: { title: `Notes: ${m.name}` },
    content: `<input type="text" name="notes" value="${esc(m.notes)}" style="width:100%" autofocus>`,
    ok: { label: "Save", callback: (ev, btn) => btn.form.elements.notes.value }
  }));
  if ( res === null || res === undefined ) return;
  m.notes = res;
  await saveData(actor, d);
}

async function editSettings(actor) {
  const s = stats(actor);
  const d = s.d;
  const res = await safe(() => DialogV2.wait({
    window: { title: `Sanity Settings: ${actor.name}` },
    position: { width: 420 },
    content: `
      <div class="form-group"><label>Set sanity damage</label><input type="number" name="damage" value="${d.damage}" min="0"></div>
      <div class="form-group"><label>Score adjustment</label><input type="number" name="score" value="${d.adj.score ?? 0}"></div>
      <div class="form-group"><label>Threshold adjustment</label><input type="number" name="threshold" value="${d.adj.threshold ?? 0}"></div>
      <div class="form-group"><label>Track this actor</label><input type="checkbox" name="tracked" ${isTracked(actor) ? "checked" : ""}></div>
      <p class="hint">Adjustments are for feats, traits, or GM rulings that change the derived values. Setting damage directly doesn't trigger madness checks.</p>`,
    buttons: [
      { action: "ok", label: "Save", default: true, callback: (ev, btn) => Object.fromEntries(new FormData(btn.form)) },
      { action: "history", label: "History" },
      { action: "cancel", label: "Cancel" }
    ]
  }));
  if ( !res || res === "cancel" ) return;
  if ( res === "history" ) {
    const rows = d.log.map((l) => `<li><small>${new Date(l.t).toLocaleString()}</small>: ${esc(l.text)}</li>`).join("") || "<li>No history yet.</li>";
    return safe(() => DialogV2.prompt({ window: { title: `Sanity History: ${actor.name}` }, content: `<ul style="max-height:400px;overflow:auto">${rows}</ul>`, ok: { label: "Close" } }));
  }
  const before = d.damage;
  const newScore = s.score - (Number(d.adj.score) || 0) + (Number(res.score) || 0);
  d.damage = Math.max(0, Number(res.damage) || 0);
  d.adj = { score: Number(res.score) || 0, threshold: Number(res.threshold) || 0 };
  d.tracked = !!res.tracked;
  if ( before !== d.damage ) {
    applyDormancy(d, Math.floor(newScore / 2));
    pushLog(d, `Damage set ${before} → ${d.damage} (manual)`);
  }
  await saveData(actor, d);
}

async function trackOther() {
  const others = game.actors.filter((a) => !isTracked(a)).sort((a, b) => a.name.localeCompare(b.name));
  if ( !others.length ) return ui.notifications.info("Every actor is already tracked.");
  const id = await safe(() => DialogV2.prompt({
    window: { title: "Track Another Actor" },
    content: `<select name="id" style="width:100%">${others.map((a) => `<option value="${a.id}">${esc(a.name)} (${a.type})</option>`).join("")}</select>`,
    ok: { label: "Track", callback: (ev, btn) => btn.form.elements.id.value }
  }));
  const a = id && game.actors.get(id);
  if ( a ) await a.update({ [`flags.${MODULE_ID}.${FLAG}`]: { ...getData(a), tracked: true } });
}

// ---------- App ----------
const STATUS_CLASS = { Stable: "ok", Strained: "warn", "Past Edge": "bad", Insane: "insane" };

export class SanityTrackerApp extends ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "agm-sanity-tracker",
    classes: ["sanity-tracker"],
    window: { title: "Sanity Tracker", icon: "fa-solid fa-brain", resizable: true },
    position: { width: 760, height: 620 }
  };

  static #instance;
  static get instance() {
    return this.#instance ??= new this();
  }

  static open() {
    if ( !game.user.isGM ) return ui.notifications.warn("Sanity Tracker is GM-only.");
    const app = this.instance;
    if ( app.rendered ) app.bringToFront();
    else app.render({ force: true });
    return app;
  }

  async _renderHTML() {
    const actors = game.actors.filter(isTracked).sort((a, b) =>
      (a.type === "character" ? 0 : 1) - (b.type === "character" ? 0 : 1) || a.name.localeCompare(b.name));
    const rows = actors.map((actor) => {
      const s = stats(actor);
      if ( s.mindless ) return `<div class="st-row"><img src="${actor.img}"><div class="st-main"><b>${esc(actor.name)}</b>: mindless (no sanity)</div></div>`;
      const pct = s.score ? Math.min(100, (s.d.damage / s.score) * 100) : 0;
      const edgePct = s.score ? (s.edge / s.score) * 100 : 50;
      const mads = s.d.madnesses.map((m) => {
        const b = BY_KEY[m.key];
        const tip = esc([b ? `Will DC ${b.dc}, onset ${b.onset}` : "Custom", b?.effect, m.notes, describeEffect(m)].filter(Boolean).join(" · "));
        const fx = EFFECTS[m.key]
          ? `<a data-action="effects" data-actor="${actor.id}" data-id="${m.id}" data-tooltip="${esc(describeEffect(m))}. Click to turn sheet effects ${m.effects === false ? "on" : "off"}"><i class="fa-solid fa-bolt ${m.effects === false ? "st-off" : "st-on"}"></i></a>`
          : "";
        return `<span class="st-mad ${m.tier} ${m.dormant ? "dormant" : ""}" data-tooltip="${tip}">
          ${madLink(m)}${m.variant && m.variant !== "other" ? ` [${m.variant === "blind" ? "blinded" : "deafened"}]` : ""}${m.notes ? ` <i>(${esc(m.notes)})</i>` : ""}
          ${fx}
          <a data-action="dormant" data-actor="${actor.id}" data-id="${m.id}" data-tooltip="${m.dormant ? "Dormant: click to activate" : "Active: click to make dormant"}"><i class="fa-solid ${m.dormant ? "fa-moon" : "fa-sun"}"></i></a>
          <a data-action="notes" data-actor="${actor.id}" data-id="${m.id}" data-tooltip="Edit notes"><i class="fa-solid fa-pen"></i></a>
          <a data-action="cure" data-actor="${actor.id}" data-id="${m.id}" data-tooltip="Cure / remove"><i class="fa-solid fa-xmark"></i></a>
        </span>`;
      }).join("") || `<span class="st-none">No madnesses</span>`;
      return `<div class="st-row">
        <img src="${actor.img}" data-action="sheet" data-actor="${actor.id}" data-tooltip="Open sheet">
        <div class="st-main">
          <div class="st-head">
            <b>${esc(actor.name)}</b>${isPhantom(actor) ? ` <small class="st-tag">phantom</small>` : ""}
            <span class="st-status ${STATUS_CLASS[s.status]}">${s.status}</span>
          </div>
          <div class="st-nums">
            <span data-tooltip="Int ${s.int} + Wis ${s.wis} + Cha ${s.cha}${s.d.adj.score ? ` + ${s.d.adj.score} adj` : ""}">Score <b>${s.score}</b></span>
            <span>Edge <b>${s.edge}</b></span>
            <span data-tooltip="Bonus of highest mental score${s.d.adj.threshold ? ` + ${s.d.adj.threshold} adj` : ""}">Threshold <b>${s.threshold}</b></span>
            <span>Damage <b>${s.d.damage}</b> / ${s.score}</span>
          </div>
          <div class="st-bar"><div class="st-fill ${STATUS_CLASS[s.status]}" style="width:${pct}%"></div><div class="st-edge" style="left:${edgePct}%" data-tooltip="Sanity edge"></div></div>
          <div class="st-mads">${mads}</div>
        </div>
        <div class="st-btns">
          <button type="button" data-action="attack" data-actor="${actor.id}"><i class="fa-solid fa-skull"></i> Attack</button>
          <button type="button" data-action="heal" data-actor="${actor.id}"><i class="fa-solid fa-heart"></i> Recover</button>
          <button type="button" data-action="add" data-actor="${actor.id}"><i class="fa-solid fa-plus"></i> Madness</button>
          <button type="button" data-action="settings" data-actor="${actor.id}"><i class="fa-solid fa-gear"></i></button>
        </div>
      </div>`;
    }).join("");

    const root = document.createElement("div");
    root.className = "st-root";
    root.innerHTML = `
      <div class="st-top">
        <span><a href="${RULES.sanity}" target="_blank">Sanity rules</a> · <a href="${RULES.madness}" target="_blank">Madness</a> · <a href="${RULES.recovery}" target="_blank">Recovery</a></span>
        <label><input type="checkbox" data-action="whisper" ${whisperOn() ? "checked" : ""}> Whisper results to GM</label>
        <span><button type="button" data-action="resync" data-tooltip="Rebuild madness buffs on every tracked actor"><i class="fa-solid fa-rotate"></i> Sync buffs</button>
        <button type="button" data-action="track"><i class="fa-solid fa-user-plus"></i> Track actor</button></span>
      </div>
      ${rows || "<p>No tracked actors.</p>"}`;
    root.addEventListener("click", (ev) => this.#onClick(ev));
    root.querySelector('[data-action="whisper"]')?.addEventListener("change", (ev) =>
      game.settings.set(MODULE_ID, "sanityWhisper", ev.currentTarget.checked));
    return root;
  }

  _replaceHTML(result, content) {
    content.replaceChildren(result);
  }

  async #onClick(ev) {
    const el = ev.target.closest("[data-action]");
    if ( !el || el.dataset.action === "whisper" ) return;
    if ( el.tagName === "A" && el.getAttribute("href") ) return; // rules links open normally
    ev.preventDefault();
    const actor = game.actors.get(el.dataset.actor);
    const id = el.dataset.id;
    switch ( el.dataset.action ) {
      case "attack": return sanityAttack(actor);
      case "heal": return sanityHeal(actor);
      case "add": return addMadness(actor);
      case "cure": return removeMadness(actor, id);
      case "dormant": return toggleDormant(actor, id);
      case "effects": return toggleEffects(actor, id);
      case "resync": return resyncAll();
      case "notes": return editNotes(actor, id);
      case "settings": return editSettings(actor);
      case "sheet": return actor?.sheet.render(true);
      case "track": return trackOther();
    }
  }

  _onFirstRender() {
    const rerender = foundry.utils.debounce(() => this.rendered && this.render(), 100);
    this._hooks = ["updateActor", "createActor", "deleteActor", "updateItem", "createItem"]
      .map((name) => [name, Hooks.on(name, rerender)]);
  }

  _onClose() {
    for ( const [name, id] of this._hooks ?? [] ) Hooks.off(name, id);
    this._hooks = null;
  }
}

/** Test hooks for automated checks. Not used by the UI. */
export const _internal = { applyDormancy, effectFor, saveData };
