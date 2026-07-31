/**
 * Mise à jour du catalogue depuis la source de distribution.
 *
 * Principe directeur : **une source injoignable ne dégrade jamais la lecture.**
 * L'application embarque son catalogue et fonctionne hors ligne ; le pointeur
 * n'est qu'une occasion de faire mieux. Cinq branches de décision sur six sont
 * donc silencieuses — une application hors ligne ne doit rien afficher
 * d'anxiogène, elle a déjà tout ce qu'il lui faut pour explorer.
 */

import { resolveObject } from '../shared/distribution.js';

/** Version de schéma de catalogue que ce client sait lire. */
export const SUPPORTED_SCHEMA_VERSION = 2;

/** Clé du pointeur, seul objet du bucket qui change sous une clé fixe. */
export const POINTER_KEY = 'catalog/latest.json';

const POINTER_TIMEOUT_MS = 8000;

/**
 * Lit le pointeur. Renvoie `null` pour **toute** anomalie — réseau, HTTP, JSON.
 *
 * Aucune levée : l'appelant est un démarrage d'application, pas une requête
 * utilisateur, et il n'a rien à rattraper. Un `throw` ici obligerait chaque
 * appelant à un `try` dont la seule branche utile serait « ne rien faire ».
 */
export async function fetchPointer(baseUrl, { signal = null, timeoutMs = POINTER_TIMEOUT_MS } = {}) {
  const { url } = resolveObject(baseUrl, POINTER_KEY);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    return JSON.parse(await response.text());
  } catch {
    return null; // hors ligne, DNS mort, JSON cassé : silence
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function estEntierPositif(valeur) {
  return Number.isInteger(valeur) && valeur > 0;
}

/**
 * Décide s'il y a lieu de proposer une mise à jour.
 *
 * Fonction pure : c'est elle qu'on teste, pas le réseau. Toute branche
 * silencieuse rend `pointer: null`, pour qu'aucun appelant ne puisse installer
 * un catalogue qu'on vient de refuser.
 */
export function decideUpdate({ pointer, localVersion, declinedVersion }) {
  if (!pointer || typeof pointer !== 'object') {
    return { action: 'none', reason: 'noPointer', pointer: null };
  }
  if (!estEntierPositif(pointer.catalog_version) || !pointer.object_key) {
    return { action: 'none', reason: 'malformed', pointer: null };
  }
  if (
    !estEntierPositif(pointer.schema_version) ||
    pointer.schema_version > SUPPORTED_SCHEMA_VERSION
  ) {
    // L'application est trop ancienne pour ce catalogue. Le dire n'aiderait
    // pas : elle ne peut rien en faire.
    return { action: 'none', reason: 'schemaTooNew', pointer: null };
  }
  if (pointer.catalog_version <= (localVersion ?? 0)) {
    return { action: 'none', reason: 'upToDate', pointer: null };
  }
  if (pointer.catalog_version === declinedVersion) {
    return { action: 'none', reason: 'declined', pointer: null };
  }
  return { action: 'offer', reason: 'newer', pointer };
}
