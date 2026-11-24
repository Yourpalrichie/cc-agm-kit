# Carrion Crown Assistant GM Kit

Assistant GM tools for a Pathfinder 1e Carrion Crown game in Foundry VTT:
Hauntomatic (haunt regions, notice checks and haunt cards), a Horror Adventures sanity tracker,
quick HP and conditions, an encounter spawner, a loot divider and a Party actor.

Requires Foundry VTT v13 (verified on 13.351) and the PF1 system 11.11 or later.

## Party actor

Create an actor of type **Party** in the Actors sidebar and drag PCs, NPC allies or a whole folder onto its sheet.

- The sheet lists each member's HP, AC, saves, Perception and speed, plus overland travel speed from the slowest member.
- **Group roll** (GM/AGM): pick a skill, save or ability check and an optional DC. Everyone rolls and one chat card
  shows each result, highest and lowest, and pass/fail. It follows the chat roll mode, so blind GM rolls work.
- **Move as one token**: drag the party onto a map. **Deploy** (sheet or token HUD) places each member's token around
  it and hides the party token; **Recall** removes those tokens and brings the party token back where the group is.
  Tokens already on the map are left alone. Players own the party by default so they can move its token.

## Install (GM)

1. In Foundry's setup screen, open **Add-on Modules** and click **Install Module**.
2. Paste this into **Manifest URL** at the bottom and click **Install**:

   ```
   https://github.com/Yourpalrichie/cc-agm-kit/releases/latest/download/module.json
   ```

3. Launch the world, open **Game Settings → Manage Modules**, and enable
   **Carrion Crown Assistant GM Kit**.

## Updates

When a new version is out, Foundry shows it in **Add-on Modules**. Click **Check for Updates**
(or the update button on this module) to install it. Your haunts, sanity and other data stay in
the world, so they are kept across updates.

## Rules content

The sanity tracker uses short summaries of the Horror Adventures sanity and madness rules and
links to the full text on Archives of Nethys. It doesn't include Paizo's rules text or any
adventure text. You'll need your own copy of the adventure path for stat blocks; paste them into
**New haunt**.

## License

The code is released under the [MIT License](LICENSE). Pathfinder rules and Carrion Crown
belong to Paizo Inc. and aren't covered by this license.
