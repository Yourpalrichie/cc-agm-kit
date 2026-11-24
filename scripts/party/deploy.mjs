// Deploy: put each member's token on the map around the party token, then hide the party token.
// Recall: remove the tokens Deploy made and bring the party token back where the group is standing.
// Tokens that were already on the scene before Deploy are left alone by both.
import { MODULE_ID } from "../util.mjs";
import { partyToken, deployedTokens } from "./data.mjs";

const { DialogV2 } = foundry.applications.api;

function rectOf(t, grid) {
  return { x: t.x, y: t.y, w: t.width * grid, h: t.height * grid };
}

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Grid offsets in rings around (0, 0), nearest first. */
function* ringOffsets(maxRing = 12) {
  yield [0, 0];
  for ( let r = 1; r <= maxRing; r++ ) {
    const ring = [];
    for ( let dx = -r; dx <= r; dx++ ) {
      for ( let dy = -r; dy <= r; dy++ ) {
        if ( Math.max(Math.abs(dx), Math.abs(dy)) === r ) ring.push([dx, dy]);
      }
    }
    ring.sort((a, b) => Math.hypot(...a) - Math.hypot(...b));
    yield* ring;
  }
}

/** The nearest free spot for a w x h token, with a clear line of movement from the center (walls block). */
function findSpot(scene, center, w, h, taken) {
  const grid = scene.grid.size;
  const bounds = scene.dimensions.sceneRect;
  const baseX = Math.round((center.x - (w / 2)) / grid) * grid;
  const baseY = Math.round((center.y - (h / 2)) / grid) * grid;
  const backend = CONFIG.Canvas.polygonBackends.move;
  for ( const [dx, dy] of ringOffsets() ) {
    const rect = { x: baseX + (dx * grid), y: baseY + (dy * grid), w, h };
    if ( rect.x < bounds.x || rect.y < bounds.y || rect.x + w > bounds.right || rect.y + h > bounds.bottom ) continue;
    if ( taken.some((t) => overlaps(rect, t)) ) continue;
    const dest = { x: rect.x + (w / 2), y: rect.y + (h / 2) };
    if ( (dx || dy) && backend.testCollision(center, dest, { type: "move", mode: "any" }) ) continue;
    return rect;
  }
  return null;
}

function requireView(scene) {
  if ( canvas.scene?.id === scene.id ) return true;
  ui.notifications.warn("Party: view the scene with the party token first.");
  return false;
}

/**
 * @param {Actor} party
 * @param {TokenDocument} [token]  The party token. Defaults to the one on the viewed scene.
 */
export async function deployParty(party, token = partyToken(party)) {
  if ( !game.user.isGM ) return ui.notifications.warn("Party: only the GM can deploy.");
  if ( !token ) return ui.notifications.warn(`Party: ${party.name} has no token on this scene. Drag the party onto the map first.`);
  const scene = token.parent;
  if ( !requireView(scene) ) return;
  if ( deployedTokens(party, scene).length ) return ui.notifications.warn("Party: already deployed here. Recall first.");

  const grid = scene.grid.size;
  const center = { x: token.x + (token.width * grid / 2), y: token.y + (token.height * grid / 2) };
  const taken = scene.tokens.filter((t) => t.id !== token.id).map((t) => rectOf(t, grid));
  const skipped = [];
  const noRoom = [];
  const creates = [];

  for ( const actor of party.system.actors ) {
    if ( scene.tokens.some((t) => t.actorId === actor.id) ) { skipped.push(actor.name); continue; }
    const proto = await actor.getTokenDocument();
    const spot = findSpot(scene, center, proto.width * grid, proto.height * grid, taken);
    if ( !spot ) { noRoom.push(actor.name); continue; }
    taken.push(spot);
    const data = proto.toObject();
    data.x = spot.x;
    data.y = spot.y;
    data.hidden = token.hidden;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.deployedBy`, party.id);
    creates.push(data);
  }

  if ( creates.length ) await scene.createEmbeddedDocuments("Token", creates);
  await token.update({ hidden: true });

  if ( skipped.length ) ui.notifications.info(`Party: already on the map, left where they are: ${skipped.join(", ")}.`);
  if ( noRoom.length ) ui.notifications.warn(`Party: no open space near the party token for ${noRoom.join(", ")}.`);
  return creates.length;
}

/**
 * @param {Actor} party
 * @param {TokenDocument} [token]  The party token. Defaults to the one on the viewed scene.
 */
export async function recallParty(party, token = partyToken(party)) {
  if ( !game.user.isGM ) return ui.notifications.warn("Party: only the GM can recall.");
  if ( !token ) return ui.notifications.warn(`Party: ${party.name} has no token on this scene.`);
  const scene = token.parent;
  if ( !requireView(scene) ) return;
  const deployed = deployedTokens(party, scene);
  if ( !deployed.length ) return token.update({ hidden: false });

  const unlinked = deployed.filter((t) => !t.actorLink).map((t) => t.name);
  const inCombat = deployed.filter((t) => t.inCombat).map((t) => t.name);
  if ( unlinked.length || inCombat.length ) {
    const notes = [];
    if ( inCombat.length ) notes.push(`<p>In combat, will be removed from the tracker: ${inCombat.join(", ")}.</p>`);
    if ( unlinked.length ) notes.push(`<p>Unlinked tokens lose any HP or condition changes made on the map: ${unlinked.join(", ")}.</p>`);
    const ok = await DialogV2.confirm({
      window: { title: `Recall ${party.name}` },
      content: notes.join("")
    });
    if ( !ok ) return;
  }

  const grid = scene.grid.size;
  const cx = deployed.reduce((n, t) => n + t.x + (t.width * grid / 2), 0) / deployed.length;
  const cy = deployed.reduce((n, t) => n + t.y + (t.height * grid / 2), 0) / deployed.length;
  const w = token.width * grid;
  const h = token.height * grid;
  const x = Math.round((cx - (w / 2)) / grid) * grid;
  const y = Math.round((cy - (h / 2)) / grid) * grid;

  // Foundry leaves orphaned combatants behind when a token is deleted, so clear them first.
  const ids = new Set(deployed.map((t) => t.id));
  for ( const combat of game.combats ) {
    const gone = combat.combatants.filter((c) => c.sceneId === scene.id && ids.has(c.tokenId)).map((c) => c.id);
    if ( gone.length ) await combat.deleteEmbeddedDocuments("Combatant", gone);
  }
  await scene.deleteEmbeddedDocuments("Token", [...ids]);
  await token.update({ x, y, hidden: false }, { animate: false });
}

/** Deploy/Recall buttons on the party token's HUD. */
export function onRenderTokenHUD(hud, html) {
  const token = hud.document;
  const party = game.actors.get(token.actorId);  // The world party, even if this token is unlinked.
  if ( !game.user.isGM || party?.type !== `${MODULE_ID}.party` ) return;
  const col = html.querySelector(".col.left");
  if ( !col ) return;
  const isOut = deployedTokens(party, token.parent).length > 0;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.classList.add("control-icon");
  btn.dataset.tooltip = isOut ? "Recall party" : "Deploy party";
  btn.innerHTML = `<i class="fa-solid ${isOut ? "fa-people-arrows" : "fa-people-group"}"></i>`;
  btn.addEventListener("click", async () => {
    hud.close();
    if ( isOut ) await recallParty(party, token);
    else await deployParty(party, token);
  });
  col.append(btn);
}
