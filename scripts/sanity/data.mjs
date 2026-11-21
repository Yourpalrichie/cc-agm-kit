// Horror Adventures sanity data, ported from Richie's Sanity Tracker macro (rules: https://aonprd.com/Rules.aspx?ID=2274).

export const AON = (n) => `https://aonprd.com/Madnesses.aspx?ItemName=${encodeURIComponent(n)}`;
export const RULES = {
  sanity: "https://aonprd.com/Rules.aspx?ID=2274",
  stats: "https://aonprd.com/Rules.aspx?ID=2275",
  effects: "https://aonprd.com/Rules.aspx?ID=2276",
  recovery: "https://aonprd.com/Rules.aspx?ID=2277",
  madness: "https://aonprd.com/Rules.aspx?Name=Madness&Category=Horror%20Rules",
};

// ---------- Madness catalog (Horror Adventures) ----------
// d = d% range on Table 5-1 (lesser) / 5-2 (greater)
export const MADNESSES = [
  // Lesser
  { key: "delirium", name: "Delirium", tier: "lesser", dc: 16, onset: "1d4 days", d: [1, 10],
    effect: "–2 on Wis- and Int-based checks; can't take 10 or 20 on any check." },
  { key: "delusion", name: "Delusion", tier: "lesser", dc: 16, onset: "2d6 days", d: [11, 22],
    effect: "Holds a false belief no evidence can shake; GM may penalize or auto-fail related checks. Dormant: none." },
  { key: "fugue", name: "Fugue", tier: "lesser", dc: 18, onset: "1d4 days", d: [23, 32],
    effect: "–2 on Will saves and skill checks; can't recall memories from before the madness (keeps skills/feats)." },
  { key: "hallucination", name: "Hallucination", tier: "lesser", dc: 14, onset: "2d6 days", d: [33, 42],
    effect: "–4 on Will saves vs. or to disbelieve illusions; intermittently sees things that aren't there." },
  { key: "mania", name: "Mania", tier: "lesser", dc: 14, onset: "1 day", d: [43, 54],
    effect: "Within 30 ft. of and seeing its object: Will save each round or rush to interact with it (succeed by 5+ = resist 1 min). Dormant: fail = interact or fascinated 1 rd." },
  { key: "melancholia", name: "Melancholia", tier: "lesser", dc: 14, onset: "1d4 days", d: [55, 66],
    effect: "–2 on initiative checks; morale bonuses are halved (min +0)." },
  { key: "night-terrors", name: "Night Terrors", tier: "lesser", dc: 16, onset: "1 day", d: [67, 76],
    effect: "Each night: Will save or wake fatigued (no good night's rest for spell prep). Dormant: none." },
  { key: "paranoia", name: "Paranoia", tier: "lesser", dc: 17, onset: "2d6 days", d: [77, 86],
    effect: "+2 saves vs. charm; –2 Bluff/Diplomacy/Sense Motive; failed secret Sense Motive = thinks target plots against her; Will save to accept aid/beneficial spells. Dormant: the +2/–2 only." },
  { key: "phobia", name: "Phobia", tier: "lesser", dc: 14, onset: "1 day", d: [87, 100],
    effect: "Within 30 ft. of and seeing its object: Will save each round or shaken → scared → frightened 1d6 rds. Dormant: fail = shaken 1 rd." },
  // Greater
  { key: "amnesia", name: "Amnesia", tier: "greater", dc: 22, onset: "immediate", d: [1, 18],
    effect: "–4 Will saves and skill checks; loses class abilities, feats, and skill ranks gained before the affliction (keeps BAB, saves, HD, hp, XP). Dormant: same." },
  { key: "catatonia", name: "Catatonia", tier: "greater", dc: 24, onset: "immediate", d: [19, 30],
    effect: "Acts as if cowering (not a fear effect). Dormant: staggered." },
  { key: "cognitive-block", name: "Cognitive Block", tier: "greater", dc: 20, onset: "immediate", d: [31, 48],
    effect: "Can't speak or write; no command-word/spell-trigger/spell-completion items; –10 concentration; no verbal/thought-component spells or spellbook prep. Dormant: –4 concentration." },
  { key: "dissociated-identity", name: "Dissociated Identity", tier: "greater", dc: 20, onset: "2d6 days", d: [49, 66],
    effect: "–6 Will saves and Wis-based checks; Will save on waking/reviving or another personality takes over. Dormant: –2 Will saves and Wis-based checks." },
  { key: "moral-insanity", name: "Moral Insanity", alias: "Psychopathy", tier: "greater", dc: 22, onset: "3d6 days", d: [67, 78],
    effect: "Alignment shifts to evil; +10 competence on Bluff to hide it; Will save 1/day to suppress for 24 hrs. Dormant: none." },
  { key: "psychosomatic-loss", name: "Psychosomatic Loss", tier: "greater", dc: 20, onset: "immediate", d: [79, 85],
    effect: "Blinded, deafened, loses a special sense, limb use, or special movement (GM's choice); normal cures for blindness/deafness don't work. Dormant: none." },
  { key: "schizophrenia", name: "Schizophrenia", tier: "greater", dc: 22, onset: "1d6 days", d: [86, 100],
    effect: "–4 on Wis- and Cha-based checks; can't take 10/20; in stressful situations Will save or confused 1d6 rds. Dormant: can't take 10/20." },
];
export const BY_KEY = Object.fromEntries(MADNESSES.map((m) => [m.key, m]));

export const ch = (targets, formula) => targets.map((t) => [t, formula]);
export const EFFECTS = {
  delirium: {
    active: { c: ch(["intSkills", "wisSkills", "intChecks", "wisChecks"], "-2"), n: [["skills", "Delirium: can't take 10 or 20 on any check."]] },
  },
  delusion: {
    active: { n: [["skills", "Delusion: GM may penalize or auto-fail checks related to the delusion."]] },
  },
  fugue: {
    active: { c: ch(["will", "skills"], "-2"), n: [["skills", "Fugue: can't recall memories from before the madness."]] },
    dormant: { c: ch(["will"], "-2") },
  },
  hallucination: {
    active: { n: [["will", "Hallucination: –4 on Will saves against or to disbelieve illusions."]] },
    dormant: { n: [["will", "Hallucination (dormant): –2 on Will saves against or to disbelieve illusions."]] },
  },
  mania: {
    active: { n: [["will", "Mania: within 30 ft. of and seeing its object, Will save each round or rush to interact (succeed by 5+ = resist 1 min)."]] },
    dormant: { n: [["will", "Mania (dormant): near its object, Will save or interact / be fascinated 1 round."]] },
  },
  melancholia: {
    active: { c: ch(["init"], "-2"), n: [["init", "Melancholia: morale bonuses are halved (min +0)."]] },
  },
  "night-terrors": {
    active: { n: [["will", "Night Terrors: each night, Will save or wake fatigued (no good night's rest for spell prep)."]] },
  },
  paranoia: {
    active: {
      c: ch(["skill.blf", "skill.dip", "skill.sen"], "-2"),
      n: [["allSavingThrows", "Paranoia: +2 on saves vs. charm effects."], ["will", "Paranoia: Will save to use/benefit from aid another or accept an ally's beneficial spell."]],
    },
    dormant: { c: ch(["skill.blf", "skill.dip", "skill.sen"], "-2"), n: [["allSavingThrows", "Paranoia (dormant): +2 on saves vs. charm effects."]] },
  },
  phobia: {
    active: { n: [["will", "Phobia: within 30 ft. of and seeing its object, Will save each round or shaken → scared → frightened 1d6 rds."]] },
    dormant: { n: [["will", "Phobia (dormant): near its object, Will save each round or shaken 1 round."]] },
  },
  amnesia: {
    active: { c: ch(["will", "skills"], "-4"), n: [["skills", "Amnesia: has lost class abilities, feats, and skill ranks gained before the affliction (adjust sheet manually)."]] },
    dormant: { c: ch(["will", "skills"], "-4") },
  },
  catatonia: { active: { k: ["cowering"] }, dormant: { k: ["staggered"] } },
  "cognitive-block": {
    active: { c: ch(["concentration"], "-10"), n: [["concentration", "Cognitive Block: can't speak/write, use command-word/spell-trigger/spell-completion items, cast verbal/thought-component spells, or prepare from a spellbook."]] },
    dormant: { c: ch(["concentration"], "-4") },
  },
  "dissociated-identity": {
    active: { c: ch(["will", "wisSkills", "wisChecks"], "-6"), n: [["will", "Dissociated Identity: Will save on waking/reviving or another personality takes over."]] },
    dormant: { c: ch(["will", "wisSkills", "wisChecks"], "-2") },
  },
  "moral-insanity": {
    active: { n: [["skill.blf", "Moral Insanity: +10 competence on Bluff checks to hide the madness. Alignment shifts to evil; Will save 1/day to suppress 24 hrs."]] },
  },
  "psychosomatic-loss": {
    active: { k: (m) => ({ blind: ["blind"], deaf: ["deaf"] })[m.variant] ?? [], n: [["misc", "Psychosomatic Loss: normal cures for blindness/deafness don't work."]] },
  },
  schizophrenia: {
    active: {
      c: ch(["wisSkills", "chaSkills", "wisChecks", "chaChecks"], "-4"),
      n: [["skills", "Schizophrenia: can't take 10 or 20 on any check."], ["will", "Schizophrenia: in stressful situations, Will save or confused 1d6 rounds."]],
    },
    dormant: { n: [["skills", "Schizophrenia (dormant): can't take 10 or 20 on any check."]] },
  },
};
