export const MODULE_ID = "cc-agm-kit";
export const HAUNT_TYPE = `${MODULE_ID}.haunt`;

/**
 * The one client that acts on haunt events. game.users.activeGM counts Assistant GMs (isGM is role >= ASSISTANT)
 * and prefers the highest role, so a full GM wins and an Assistant GM is the fallback.
 */
export function isExecutor() {
  return game.user.isActiveGM;
}

export function hauntomaticEnabled() {
  return game.settings.get(MODULE_ID, "hauntomaticEnabled");
}

/** GM and Assistant GM users, for whispers. */
export function gmUserIds() {
  return game.users.filter(u => u.isGM).map(u => u.id);
}
