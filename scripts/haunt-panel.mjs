import { MODULE_ID, hauntomaticEnabled } from "./util.mjs";
import { hauntsInScene } from "./haunt-behavior.mjs";
import { runHauntAction } from "./haunt-card.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** List of the viewed scene's haunts with state, HP and quick buttons. */
export class HauntPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "agm-haunt-panel",
    classes: ["agm-haunt-panel"],
    window: { title: "Hauntomatic", icon: "fa-solid fa-ghost", resizable: true },
    position: { width: 460, height: "auto" },
    actions: {
      toggleEnabled: HauntPanel.#onToggleEnabled,
      configure: HauntPanel.#onHaunt,
      haunt: HauntPanel.#onHaunt
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/haunt-panel.hbs` }
  };

  static #instance;
  static get instance() {
    return this.#instance ??= new this();
  }

  /** Re-render if open. */
  static refresh() {
    if ( this.#instance?.rendered ) this.#instance.render();
  }

  async _prepareContext() {
    const haunts = hauntsInScene(canvas.scene).map(b => ({
      uuid: b.uuid,
      name: b.system.displayName,
      cr: b.system.cr,
      noticeDC: b.system.noticeDC,
      hp: b.system.hp,
      hpMax: b.system.hpMax,
      state: b.system.state,
      stateLabel: game.i18n.localize(`AGM.State.${b.system.state}`),
      disabled: b.disabled
    }));
    return { enabled: hauntomaticEnabled(), haunts };
  }

  static async #onToggleEnabled() {
    await game.settings.set(MODULE_ID, "hauntomaticEnabled", !hauntomaticEnabled());
  }

  static async #onHaunt(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const behavior = uuid ? await fromUuid(uuid) : null;
    const op = target.dataset.action === "configure" ? "configure" : target.dataset.op;
    await runHauntAction(behavior, op);
  }
}
