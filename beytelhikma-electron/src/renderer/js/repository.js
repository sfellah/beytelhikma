/**
 * Unique porte d'entrée aux données côté rendu. Les vues ne connaissent que ces
 * méthodes ; le SQL vit dans le processus principal.
 */
export const repository = window.beytelhikma.repository;

/** Réglages persistés dans `user.sqlite`, chargés une fois par session. */
let settingsCache = null;

export async function settings() {
  settingsCache ??= await repository.getSettings();
  return settingsCache;
}

export async function setSetting(key, value) {
  settingsCache ??= await repository.getSettings();
  settingsCache[key] = String(value);
  await repository.saveSetting(key, String(value));
}
