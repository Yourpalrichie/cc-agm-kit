import { MODULE_ID, HAUNT_TYPE } from "./util.mjs";
import { HauntPanel } from "./haunt-panel.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Colour for regions made by this flow. */
const HAUNT_COLOR = "#8a5cf6";

/** Stat block waiting for the GM to draw its region. Only lives on this client. */
let pending = null;

/* ---------------------------------------- */
/*  Stat block parser                       */
/* ---------------------------------------- */

const UNIT_SECONDS = {
  round: 6, minute: 60, min: 60, hour: 3600, hr: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000
};

/** "1 day", "10 minutes", "1d4 hours" (uses the minimum) → seconds; anything else → 0. */
export function parseResetSeconds(text) {
  const m = String(text ?? "").toLowerCase().match(/(\d+)(?:d\d+)?\s*(round|minute|min|hour|hr|day|week|month|year)s?\b/);
  if ( !m ) return 0;
  return Number(m[1]) * UNIT_SECONDS[m[2]];
}

/** Plain text (blank line = new paragraph) → simple HTML. */
function textToHTML(text) {
  const paras = String(text ?? "").trim().split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  return paras.map(p => `<p>${foundry.utils.escapeHTML(p)}</p>`).join("");
}

/* Words that start a stat block line, or a section, in Paizo PDFs and on Archives of Nethys. */
const KEYWORDS = "Caster\\s+Level|Notice|Weakness(?:es)?|Trigger|Reset|Effect|Destruction";
const LINE_START = new RegExp(
  "^(?:XP\\b|Source\\b|CR\\b|Aura\\b|Alignment\\b|Caster\\s+Level\\b|Notice\\b|hp\\b|Weakness|Trigger\\b|Reset\\b"
  + "|(?:LG|NG|CG|LN|N|CN|LE|NE|CE)\\s)|\\bCR\\s+(?:\\d|[-\\u2012-\\u2015])|\\bhaunt\\b", "i");

/**
 * Undo the usual damage from copying out of a PDF:
 * ligature characters, odd spaces, words hyphenated across lines, headings glued to the next word
 * ("EffectWhen", "1stNotice"), and stat lines wrapped onto a second line.
 */
export function cleanStatBlockText(raw) {
  let t = String(raw ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\uFB00/g, "ff").replace(/\uFB01/g, "fi").replace(/\uFB02/g, "fl")
    .replace(/\uFB03/g, "ffi").replace(/\uFB04/g, "ffl").replace(/\uFB05|\uFB06/g, "st")
    .replace(/[\u00AD\u200B-\u200D\uFEFF]/g, "")          // soft hyphen, zero-width characters
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F\t]/g, " ") // non-breaking and other odd spaces
    .replace(/[ ]+\n/g, "\n");
  // "con-\nsecrated" -> "consecrated". Only an ASCII hyphen between lowercase letters; em dashes are kept.
  t = t.replace(/([a-z])-\n[ ]*([a-z])/g, "$1$2");
  // A heading glued to the word before it ("1stNotice", "undead;Trigger") goes onto / after a break.
  t = t.replace(new RegExp(`([a-z0-9.;,)])(?=(?:${KEYWORDS})(?![a-z]))`, "g"), (m, c) => (c === ";" ? "; " : `${c}\n`));
  // ...and one glued to the word after it ("EffectWhen", "hp13").
  t = t.replace(new RegExp(`\\b(${KEYWORDS})(?=[A-Z0-9(])`, "g"), "$1 ");
  t = t.replace(/\bhp(?=\d)/g, "hp ");
  t = t.replace(/[ ]{2,}/g, " ");

  // Rejoin wrapped stat lines, above Effect/Destruction only. A line that doesn't start a new field
  // belongs to the line before it. Lines next to a "|" menu bar (AoN) are left alone.
  const lines = t.split("\n");
  const bodyRow = lines.findIndex(l => /^\s*(Effect|Destruction)\b/i.test(l));
  const headEnd = bodyRow < 0 ? lines.length : bodyRow;
  const out = [];
  for ( let i = 0; i < lines.length; i++ ) {
    const line = lines[i].trim();
    const prev = out.at(-1);
    const join = (i < headEnd) && out.length && line && prev && !prev.includes("|") && !line.includes("|")
      && !LINE_START.test(line) && (out.length > 1 || LINE_START.test(prev));
    if ( join ) out[out.length - 1] = `${prev} ${line}`;
    else out.push(line);
  }
  return out.join("\n").trim();
}

/** Prose sections: single line breaks become spaces, blank lines stay as paragraph breaks. */
function unwrapProse(text) {
  return String(text ?? "").split(/\n\s*\n/).map(p => p.replace(/\u2014\s*\n\s*/g, "\u2014").replace(/\s*\n\s*/g, " ").trim()).filter(Boolean).join("\n\n");
}

/**
 * Parse a Paizo-format haunt stat block, e.g.
 *   PHANTOM FIRE CR 3
 *   XP 800
 *   CE persistent haunt (10 ft. by 15 ft. room)
 *   Caster Level 3rd
 *   Notice Perception DC 20 (to hear the screams)
 *   hp 13; Weakness slow, tricked by hide from undead; Trigger proximity; Reset 1 day
 *   Effect ...
 *   Destruction ...
 * Returns only the fields it found, plus `found` (a list of field labels) for feedback.
 */
export function parseHauntStatBlock(raw) {
  const text = cleanStatBlockText(raw);
  const out = {};
  if ( !text ) return out;

  // Split off Effect / Destruction. Each runs to the next heading: the other one, or a trailing section
  // such as AoN's "Description" or an AP's "Development" / "Story Award".
  const find = re => { const i = text.search(re); return i < 0 ? null : i; };
  const effectIdx = find(/^\s*Effect\b/im);
  const destIdx = find(/^\s*Destruction\b/im);
  const starts = [effectIdx, destIdx].filter(i => i !== null);
  const head = text.slice(0, starts.length ? Math.min(...starts) : text.length);
  const afterFirst = starts.length ? Math.min(...starts) : 0;
  const tailRel = text.slice(afterFirst).search(/^\s*(Description|Development|Story\s+Award|Treasure|Notes?)\b/im);
  const tailIdx = tailRel < 0 ? text.length : afterFirst + tailRel;
  const section = (start, label) => {
    const ends = [effectIdx, destIdx, tailIdx].filter(i => (i !== null) && (i > start));
    return text.slice(start, Math.min(...ends, text.length)).replace(new RegExp(`^\\s*${label}\\s*:?\\s*`, "i"), "").trim();
  };
  if ( effectIdx !== null ) out.effect = section(effectIdx, "Effect");
  if ( destIdx !== null ) out.destruction = section(destIdx, "Destruction");

  // CR: "NAME CR 3" (Paizo PDFs) or "CR 1; XP 400" on its own line (Archives of Nethys).
  const headLines = head.split("\n");
  const crRow = headLines.findIndex(l => /\bCR\s+(\d|[-\u2012-\u2015])/i.test(l));
  if ( crRow >= 0 ) {
    const m = headLines[crRow].match(/^(.*?)\s*\bCR\s+(\d+(?:\/\d+)?|[-\u2012-\u2015])/i);
    if ( /\d/.test(m[2]) ) {   // "CR —" (no CR) leaves the default
      const [n, d] = m[2].split("/").map(Number);
      out.cr = d ? n / d : n;
    }
    // Name: text before "CR" on that line, else the nearest line above that isn't Source/XP/a nav bar.
    let name = m[1].trim();
    for ( let i = crRow - 1; !name && (i >= 0); i-- ) {
      const l = headLines[i].trim();
      if ( !l || l.includes("|") || /^(Source|XP)\b/i.test(l) ) continue;
      name = l;
    }
    if ( name ) out.name = /^[^a-z]*$/.test(name) ? name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : name;
  }

  const cl = head.match(/Caster\s+Level\s+(\d+)/i);
  if ( cl ) out.casterLevel = Number(cl[1]);

  // The bracketed text may wrap onto a second line, and AoN drops the closing bracket, so stop at ")" or the hp line.
  // "Notice Perception DC 20 (...)", "Notice Perception or Spellcraft DC 20 (...)", "Notice Knowledge (nature) DC 25 (...)".
  const notice = head.match(/Notice\s+((?:[^\n(]|\([^)\n]*\))*?)\s*DC\s*(\d+)(?:\s*\(([\s\S]*?)(?:\)|\n(?=\s*(?:hp|Weakness|Trigger|Reset)\b)|$))?/i);
  if ( notice ) {
    out.noticeDC = Number(notice[2]);
    const skills = notice[1].trim();
    const why = (notice[3] ?? "").replace(/\s+/g, " ").trim();
    // Hauntomatic rolls Perception; keep any other skill in the text so the GM sees it.
    const extra = skills && !/^Perception$/i.test(skills) ? skills : "";
    const joined = [extra, why].filter(Boolean).join(": ");
    if ( joined ) out.noticeText = joined;
  }

  const hp = head.match(/(?:^|[\s;])hp\s+(\d+)/im);
  if ( hp ) out.hp = out.hpMax = Number(hp[1]);

  const weak = head.match(/Weakness(?:es)?\s+([^;\n]+)/i);
  if ( weak ) {
    out.weakness = weak[1].trim();
    out.slow = /\bslow\b/i.test(out.weakness);
  }

  // "persistent haunt" on the type line
  const typeLine = head.match(/^.*\bhaunt\b.*$/im);
  if ( typeLine ) out.persistent = /\bpersistent\b/i.test(typeLine[0]);

  const trig = head.match(/Trigger\s+([^;\n]+)/i);
  if ( trig ) {
    const t = trig[1].trim().toLowerCase();
    out.trigger = t.startsWith("proximity") ? "proximity" : t.startsWith("touch") ? "touch" : "other";
  }

  const reset = head.match(/Reset\s+([^;\n]+)/i);
  if ( reset ) {
    out.resetText = reset[1].trim().replace(/\.$/, "");
    out.resetSeconds = parseResetSeconds(out.resetText);
  }

  // Tidy the multi-line prose: rejoin lines broken by PDF copy, keep blank-line paragraphs.
  for ( const k of ["effect", "destruction"] ) {
    if ( out[k] ) out[k] = unwrapProse(out[k]);
  }
  return out;
}

/* ---------------------------------------- */
/*  Form                                    */
/* ---------------------------------------- */

/** "New haunt": enter or paste a stat block, then draw its region on the canvas. */
export class NewHauntApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agm-new-haunt",
    tag: "form",
    classes: ["agm-new-haunt"],
    window: { title: "New haunt", icon: "fa-solid fa-ghost", resizable: true },
    position: { width: 560, height: "auto" },
    form: { handler: NewHauntApp.#onSubmit, submitOnChange: false, closeOnSubmit: true },
    actions: { parse: NewHauntApp.#onParse }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/haunt-new.hbs`, scrollable: [""] }
  };

  static #instance;
  static get instance() {
    return this.#instance ??= new this();
  }

  static open() {
    if ( !game.user.isGM ) return;
    if ( !canvas.scene ) return ui.notifications.warn("Hauntomatic: view a scene first.");
    return this.instance.render({ force: true });
  }

  /** Current form values, kept across re-renders. */
  data = NewHauntApp.defaults();

  static defaults() {
    return {
      name: "", cr: 1, casterLevel: 1, noticeDC: 10, noticeText: "", hpMax: 2, persistent: false, slow: false,
      trigger: "proximity", weakness: "", resetText: "", resetSeconds: 0, effect: "", destruction: "",
      shape: "rectangle", statBlock: ""
    };
  }

  async _prepareContext() {
    return {
      data: this.data,
      triggers: { proximity: "Proximity", touch: "Touch", other: "Other" },
      shapes: { rectangle: "Rectangle", ellipse: "Ellipse", polygon: "Polygon" },
      found: this.found ?? null,
      scene: canvas.scene?.name
    };
  }

  /** Copy what's in the form into this.data. */
  #readForm() {
    const fd = new foundry.applications.ux.FormDataExtended(this.element).object;
    for ( const k of ["cr", "casterLevel", "noticeDC", "hpMax", "resetSeconds"] ) fd[k] = Number(fd[k]) || 0;
    Object.assign(this.data, fd);
  }

  static async #onParse() {
    this.#readForm();
    const parsed = parseHauntStatBlock(this.data.statBlock);
    const keys = Object.keys(parsed);
    if ( !keys.length ) {
      ui.notifications.warn("Hauntomatic: couldn't find a haunt stat block in that text.");
      return;
    }
    // PF1 default haunt HP: 2 x CR (persistent 4.5 x CR) when the block has no hp line.
    if ( (parsed.hpMax === undefined) && (parsed.cr !== undefined) ) {
      parsed.hpMax = Math.max(1, Math.floor(parsed.cr * (parsed.persistent ? 4.5 : 2)));
    }
    delete parsed.hp;
    // Start from a clean form so nothing carries over from a previous paste.
    const { statBlock, shape } = this.data;
    this.data = Object.assign(NewHauntApp.defaults(), { statBlock, shape }, parsed);
    const labels = { name: "name", cr: "CR", casterLevel: "CL", noticeDC: "notice DC", hpMax: "HP", weakness: "weakness",
      trigger: "trigger", resetText: "reset", effect: "effect", destruction: "destruction" };
    this.found = keys.filter(k => labels[k]).map(k => labels[k]);
    this.render();
  }

  static async #onSubmit(event, form, formData) {
    this.#readForm();
    const d = this.data;
    let effect = textToHTML(d.effect);
    if ( d.noticeText ) effect = `<p><em>Notice: ${foundry.utils.escapeHTML(d.noticeText)}</em></p>${effect}`;
    const system = {
      name: d.name.trim(), cr: d.cr, casterLevel: d.casterLevel, noticeDC: d.noticeDC,
      hp: d.hpMax, hpMax: d.hpMax, persistent: !!d.persistent, slow: !!d.slow, trigger: d.trigger,
      weakness: d.weakness.trim(), resetText: d.resetText.trim(), resetSeconds: d.resetSeconds,
      effect, destruction: textToHTML(d.destruction), state: "armed"
    };
    startDrawing(system, d.shape);
    // Fresh form next time.
    this.data = NewHauntApp.defaults();
    this.found = null;
  }
}

/* ---------------------------------------- */
/*  Draw-to-place                           */
/* ---------------------------------------- */

function startDrawing(system, shape) {
  pending = { system, sceneId: canvas.scene.id };
  canvas.regions.releaseAll();
  canvas.regions.activate({ tool: shape });
  const how = shape === "polygon" ? "Click the corners, double-click to finish" : "Drag on the map";
  ui.notifications.info(`Hauntomatic: ${how} to draw the area for "${system.name || "the haunt"}". Switch tools to cancel.`);
}

function cancelPending(reason) {
  if ( !pending ) return;
  pending = null;
  if ( reason ) ui.notifications.info(`Hauntomatic: ${reason}`);
}

/** Put the haunt behavior into the new region's creation data. Runs only on the client that drew it. */
Hooks.on("preCreateRegion", (region, data, options, userId) => {
  if ( !pending || (userId !== game.user.id) ) return;
  if ( region.parent?.id !== pending.sceneId ) return;
  const { system } = pending;
  pending = null;
  const name = system.name || game.i18n.localize("AGM.Haunt");
  region.updateSource({
    name,
    color: HAUNT_COLOR,
    behaviors: [{ type: HAUNT_TYPE, name, system }]
  });
  options.renderSheet = false;
  options[MODULE_ID] = { newHaunt: true };
});

Hooks.on("createRegion", (region, options, userId) => {
  if ( !options[MODULE_ID]?.newHaunt || (userId !== game.user.id) ) return;
  ui.notifications.info(`Hauntomatic: "${region.name}" is placed and armed.`);
  HauntPanel.instance.render({ force: true });
});

/** Leaving the Regions tools, or changing scene, cancels a draw that hasn't happened yet. */
Hooks.on("renderSceneControls", controls => {
  if ( !pending ) return;
  const tool = controls.tool?.name;
  if ( (controls.control?.name !== "regions") || !["rectangle", "ellipse", "polygon"].includes(tool) ) {
    cancelPending("haunt placement cancelled.");
  }
});
Hooks.on("canvasReady", () => cancelPending(null));
