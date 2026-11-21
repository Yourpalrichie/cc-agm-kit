import { MODULE_ID, HAUNT_TYPE, isExecutor, hauntomaticEnabled } from "./util.mjs";
import { HauntBehaviorType, hauntsInScene } from "./haunt-behavior.mjs";
import { onRenderChatMessageHTML } from "./haunt-card.mjs";
import { HauntPanel } from "./haunt-panel.mjs";
import { QuickHPApp } from "./quick-hp.mjs";
import { EncounterSpawnerApp, spawnEncounter } from "./encounter-spawner.mjs";
import { LootDividerApp, getStash, ensureStash, roomLoot, sweepTokens, unmarkLooted, computeSplit } from "./loot-divider.mjs";
import { SanityTrackerApp, syncBuffs, stats, getData } from "./sanity/tracker.mjs";

Hooks.once("init", () => {
  CONFIG.RegionBehavior.dataModels[HAUNT_TYPE] = HauntBehaviorType;
  CONFIG.RegionBehavior.typeLabels[HAUNT_TYPE] = "AGM.Haunt";
  CONFIG.RegionBehavior.typeIcons[HAUNT_TYPE] = "fa-solid fa-ghost";

  game.settings.register(MODULE_ID, "hauntomaticEnabled", {
    name: "AGM.Settings.enabled.name",
    hint: "AGM.Settings.enabled.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      ui.controls?.render({ reset: true });
      HauntPanel.refresh();
    }
  });

  game.settings.register(MODULE_ID, "sanityWhisper", {
    name: "Sanity: whisper results to GM",
    scope: "client",
    config: false,
    type: Boolean,
    default: true,
    onChange: () => SanityTrackerApp.instance.rendered && SanityTrackerApp.instance.render()
  });

  game.settings.register(MODULE_ID, "lootPartySize", {
    name: "Loot divider: number of players",
    scope: "world",
    config: false,
    type: Number,
    default: 4,
    onChange: () => LootDividerApp.instance.rendered && LootDividerApp.instance.render()
  });

  game.keybindings.register(MODULE_ID, "quickHP", {
    name: "Open Quick HP & Conditions",
    editable: [{ key: "KeyH", modifiers: ["Shift"] }],
    restricted: true,
    onDown: () => { QuickHPApp.open(); return true; }
  });

  game.modules.get(MODULE_ID).api = {
    HauntPanel, hauntsInScene,
    openSanityTracker: () => SanityTrackerApp.open(),
    openQuickHP: () => QuickHPApp.open(),
    openEncounterSpawner: () => EncounterSpawnerApp.open(),
    spawnEncounter,
    openLootDivider: () => LootDividerApp.open(),
    loot: { LootDividerApp, getStash, ensureStash, roomLoot, sweepTokens, unmarkLooted, computeSplit },
    sanity: { SanityTrackerApp, syncBuffs, stats, getData }
  };
});

/* Scene controls: on/off toggle and the haunt list, under Token controls. GM and Assistant GM only. */
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if ( !tokens || !game.user.isGM ) return;
  tokens.tools.agmHauntomatic = {
    name: "agmHauntomatic",
    order: 100,
    title: "AGM.Controls.toggle",
    icon: "fa-solid fa-ghost",
    toggle: true,
    active: hauntomaticEnabled(),
    onChange: (event, active) => {
      if ( active !== hauntomaticEnabled() ) game.settings.set(MODULE_ID, "hauntomaticEnabled", active);
    }
  };
  tokens.tools.agmHauntPanel = {
    name: "agmHauntPanel",
    order: 101,
    title: "AGM.Controls.panel",
    icon: "fa-solid fa-list-ul",
    button: true,
    onChange: () => HauntPanel.instance.render({ force: true })
  };
  tokens.tools.agmSanity = {
    name: "agmSanity",
    order: 102,
    title: "AGM.Controls.sanity",
    icon: "fa-solid fa-brain",
    button: true,
    onChange: () => SanityTrackerApp.open()
  };
  tokens.tools.agmQuickHP = {
    name: "agmQuickHP",
    order: 103,
    title: "AGM.Controls.quickHP",
    icon: "fa-solid fa-heart-pulse",
    button: true,
    onChange: () => QuickHPApp.open()
  };
  tokens.tools.agmEncounter = {
    name: "agmEncounter",
    order: 104,
    title: "AGM.Controls.encounter",
    icon: "fa-solid fa-dragon",
    button: true,
    onChange: () => EncounterSpawnerApp.open()
  };
  tokens.tools.agmLoot = {
    name: "agmLoot",
    order: 105,
    title: "AGM.Controls.loot",
    icon: "fa-solid fa-sack-dollar",
    button: true,
    onChange: () => LootDividerApp.open()
  };
});

Hooks.on("renderChatMessageHTML", onRenderChatMessageHTML);

/* Keep the panel current. */
for ( const hook of ["createRegionBehavior", "updateRegionBehavior", "deleteRegionBehavior", "deleteRegion", "canvasReady"] ) {
  Hooks.on(hook, () => HauntPanel.refresh());
}

/* Reset neutralized haunts once their reset time has passed. Only the executor client writes. */
Hooks.on("updateWorldTime", async worldTime => {
  if ( !isExecutor() ) return;
  for ( const scene of game.scenes ) {
    for ( const behavior of hauntsInScene(scene) ) {
      if ( behavior.system.isDueToReset(worldTime) ) {
        await behavior.system.rearm();
        ChatMessage.implementation.create({
          content: `<p><i class="fa-solid fa-ghost"></i> <strong>${behavior.system.displayName}</strong> has reset and is armed again (${scene.name}).</p>`,
          whisper: game.users.filter(u => u.isGM).map(u => u.id),
          speaker: { alias: "Hauntomatic" }
        });
      }
    }
  }
});
