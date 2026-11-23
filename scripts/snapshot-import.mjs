// Party snapshots → stand-in PF1 actors.
//
// ~/RPG/character-snapshots/pc_snapshot.py writes the latest PathCompanion / Fight Club snapshots to
// Data/cc-agm-kit-snapshots/ (index.json + one {source, savedAt, summary} file each). This turns each one into a
// GM-owned `character` actor in the "Party Snapshots" folder whose numbers match the snapshot: ability scores, size
// and speed are set directly, one class item gives the level, and a single "Snapshot adjustments" buff carries
// untyped changes that close the gap on AC/touch/flat-footed, saves, CMB/CMD, initiative, max HP and skills.
// They're stand-ins for the kit tools, not playable sheets. Re-importing updates the same actor (matched by name).
import { MODULE_ID, gmUserIds } from "./util.mjs";

const { DialogV2 } = foundry.applications.api;
const DIR = "cc-agm-kit-snapshots";
const FOLDER_NAME = "Party Snapshots";
const FLAG = "snapshot";

const SIZES = {
  f: "fine", fine: "fine", d: "dim", diminutive: "dim", t: "tiny", tiny: "tiny", s: "sm", small: "sm",
  m: "med", medium: "med", l: "lg", large: "lg", h: "huge", huge: "huge", g: "grg", gargantuan: "grg",
  c: "col", colossal: "col"
};

const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const route = (f) => foundry.utils.getRoute(`${DIR}/${f}`) + `?t=${Date.now()}`;

async function fetchJSON(file) {
  const res = await fetch(route(file), { cache: "no-store" });
  if ( !res.ok ) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
}

export async function listSnapshots() {
  try {
    return (await fetchJSON("index.json")).characters ?? [];
  } catch(err) {
    console.warn(`${MODULE_ID} | no snapshot index`, err);
    return [];
  }
}

export function findSnapshotActor(name) {
  return game.actors.find((a) => a.getFlag(MODULE_ID, FLAG)?.name === name);
}

/** Skill label (lowercase) → PF1 skill id. */
function skillIds() {
  const map = {};
  for ( const [id, label] of Object.entries(pf1.config.skills) ) map[String(label).toLowerCase()] = id;
  return map;
}

/** Current values of everything we match, keyed like the targets in #plan(). */
function measure(actor) {
  const s = actor.system, at = s.attributes, sv = at.savingThrows;
  const out = {
    ac: at.ac.normal.total, tac: at.ac.touch.total, ffac: at.ac.flatFooted.total,
    fort: sv.fort.total, ref: sv.ref.total, will: sv.will.total,
    cmb: at.cmb.total, cmd: at.cmd.total, init: at.init.total, mhp: at.hp.max
  };
  for ( const [id, sk] of Object.entries(s.skills ?? {}) ) out[`skill.${id}`] = sk.mod;
  return out;
}

/** What each target should read, from the snapshot summary. Touch/flat-footed are applied on top of "ac". */
function desired(summary, unmatched) {
  const want = {};
  const put = (k, v) => { if ( Number.isFinite(v) ) want[k] = v; };
  put("ac", summary.ac?.total); put("tac", summary.ac?.touch); put("ffac", summary.ac?.flatFooted);
  put("fort", summary.saves?.fort); put("ref", summary.saves?.reflex); put("will", summary.saves?.will);
  put("cmb", summary.cmb); put("cmd", summary.cmd); put("init", summary.init); put("mhp", summary.hp?.total);
  const ids = skillIds();
  for ( const [name, total] of Object.entries(summary.skills ?? {}) ) {
    const id = ids[name.toLowerCase()];
    if ( id ) put(`skill.${id}`, total);
    else unmatched.push(name);
  }
  return want;
}

/** The change formula for each target: what's already there plus the remaining gap. "ac" moves touch/flat too. */
function nextChanges(prev, want, now) {
  const delta = { ...prev };
  for ( const [k, v] of Object.entries(want) ) {
    delta[k] = (delta[k] ?? 0) + (v - (now[k] ?? 0));
  }
  return delta;
}

function changeList(delta) {
  return Object.entries(delta)
    .filter(([, v]) => v)
    .map(([target, v]) => ({ formula: String(v), target, type: "untyped", operator: "add" }));
}

async function ensureFolder() {
  return game.folders.find((f) => f.type === "Actor" && f.name === FOLDER_NAME)
    ?? Folder.implementation.create({ name: FOLDER_NAME, type: "Actor", color: "#6b4f8a" });
}

function biography(snap) {
  const s = snap.summary;
  const rows = (s.attacks ?? []).map((a) =>
    `<tr><td>${esc(a.name)}</td><td>${esc(a.attack)}</td><td>${esc(a.damage)}</td><td>${esc(a.critical)}</td></tr>`).join("");
  return [
    `<p><strong>Snapshot stand-in.</strong> From ${esc(snap.source)}, saved ${esc(snap.savedAt)}. `
      + `Numbers come from a "Snapshot adjustments" buff; re-import to refresh.</p>`,
    `<p>${esc(s.raceClass ?? [s.race, Object.entries(s.classes ?? {}).map(([c, l]) => `${c} ${l}`).join("/")].filter(Boolean).join(" "))}</p>`,
    rows ? `<table><tr><th>Attack</th><th>Bonus</th><th>Damage</th><th>Crit</th></tr>${rows}</table>` : "",
    s.feats?.length ? `<p><strong>Feats:</strong> ${esc(s.feats.join(", "))}</p>` : ""
  ].join("");
}

/**
 * Create or update the stand-in actor for one snapshot ({source, savedAt, summary}).
 * @returns {Promise<{actor: Actor, created: boolean, mismatches: string[], unmatched: string[]}>}
 */
export async function importSnapshot(snap) {
  const s = snap.summary;
  if ( !s?.name ) throw new Error("snapshot has no name");
  const folder = await ensureFolder();
  const level = Number(s.level) || Object.values(s.classes ?? {}).reduce((n, l) => n + Number(l || 0), 0) || 1;
  const abilities = {};
  for ( const [k, v] of Object.entries(s.abilities ?? {}) ) if ( Number.isFinite(v) ) abilities[k] = { value: v };
  const size = SIZES[String(s.size ?? "").toLowerCase()] ?? "med";
  const flag = { name: s.name, source: snap.source, savedAt: snap.savedAt, summary: s };
  const data = {
    name: s.name,
    folder: folder.id,
    system: {
      abilities,
      traits: { size },
      attributes: { speed: { land: { base: Number(s.speed) || 30 } } },
      details: { biography: { value: biography(snap) } }
    },
    flags: { [MODULE_ID]: { [FLAG]: flag } }
  };

  let actor = findSnapshotActor(s.name);
  const created = !actor;
  if ( created ) {
    actor = await Actor.implementation.create({
      ...data, type: "character",
      prototypeToken: { name: s.name, actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY }
    });
  } else {
    await actor.update(data);
    const old = actor.items.filter((i) => i.getFlag(MODULE_ID, FLAG)).map((i) => i.id);
    if ( old.length ) await actor.deleteEmbeddedDocuments("Item", old);
  }

  const classLabel = Object.entries(s.classes ?? {}).map(([c, l]) => `${c} ${l}`).join(" / ") || `Level ${level}`;
  const [, buff] = await actor.createEmbeddedDocuments("Item", [
    { name: `Snapshot: ${classLabel}`.slice(0, 120), type: "class",
      system: { level, hd: 8, hp: 0, bab: "low",
        savingThrows: { fort: { value: "low" }, ref: { value: "low" }, will: { value: "low" } } },
      flags: { [MODULE_ID]: { [FLAG]: true } } },
    { name: "Snapshot adjustments", type: "buff", img: "icons/svg/book.svg",
      system: { subType: "perm", active: true, changes: [] },
      flags: { [MODULE_ID]: { [FLAG]: true } } }
  ]);

  // Close the gaps. Changes can interact (e.g. ability-based bonuses, CMD), so re-measure and correct a few times.
  const unmatched = [];
  const want = desired(s, unmatched);
  let delta = {};
  for ( let pass = 0; pass < 4; pass++ ) {
    const now = measure(actor);
    const gaps = Object.entries(want).filter(([k, v]) => now[k] !== v);
    if ( !gaps.length ) break;
    delta = nextChanges(delta, want, now);
    await buff.update({ "system.changes": changeList(delta) });
  }

  const final = measure(actor);
  const mismatches = Object.entries(want).filter(([k, v]) => final[k] !== v).map(([k, v]) => `${k} ${final[k]} ≠ ${v}`);
  const hp = Number(s.hp?.current);
  await actor.update({ "system.attributes.hp.value": Number.isFinite(hp) ? hp : final.mhp });
  return { actor, created, mismatches, unmatched };
}

/** Dialog: pick snapshots from Data/cc-agm-kit-snapshots and import them. */
export async function openSnapshotImport() {
  if ( !game.user.isGM ) return ui.notifications.warn("Snapshot import is GM-only.");
  const list = await listSnapshots();
  if ( !list.length ) {
    return ui.notifications.warn(`No snapshots found in Data/${DIR}. Run pc_snapshot.py first.`);
  }
  const rows = list.map((c, i) => {
    const existing = findSnapshotActor(c.name);
    const when = new Date(c.savedAt).toLocaleString();
    return `<label class="agm-snap-row">
      <input type="checkbox" name="pick" value="${i}" checked>
      <span class="agm-snap-name">${esc(c.name)}</span>
      <span class="agm-snap-meta">${esc(c.source === "fightclub" ? "Fight Club" : "PathCompanion")} · ${esc(when)}</span>
      <span class="agm-tag">${existing ? "update" : "new"}</span>
    </label>`;
  }).join("");
  const picks = await DialogV2.prompt({
    window: { title: "Import party snapshots", icon: "fa-solid fa-camera" },
    position: { width: 520 },
    content: `<p>Creates or updates stand-in actors in the <strong>${FOLDER_NAME}</strong> folder.</p>
      <div class="agm-snap-list">${rows}</div>`,
    ok: {
      label: "Import", icon: "fa-solid fa-file-import",
      callback: (event, button) => [...button.form.querySelectorAll("input[name=pick]:checked")].map((el) => list[el.value])
    },
    rejectClose: false
  });
  if ( !picks?.length ) return;

  const lines = [];
  for ( const c of picks ) {
    try {
      const snap = await fetchJSON(c.file);
      const r = await importSnapshot(snap);
      const notes = [
        r.mismatches.length ? `<span style="color:#b33">off: ${esc(r.mismatches.join(", "))}</span>` : "all numbers match",
        r.unmatched.length ? `skills not matched: ${esc(r.unmatched.join(", "))}` : ""
      ].filter(Boolean).join("; ");
      lines.push(`<li>@UUID[${r.actor.uuid}]{${esc(r.actor.name)}} ${r.created ? "created" : "updated"}, ${notes}</li>`);
    } catch(err) {
      console.error(`${MODULE_ID} | snapshot import failed`, c, err);
      lines.push(`<li>${esc(c.name)}: <span style="color:#b33">failed (${esc(err.message)})</span></li>`);
    }
  }
  ChatMessage.implementation.create({
    content: `<p><i class="fa-solid fa-camera"></i> <strong>Party snapshots</strong></p><ul>${lines.join("")}</ul>`,
    whisper: gmUserIds(),
    speaker: { alias: "Snapshot import" }
  });
}
