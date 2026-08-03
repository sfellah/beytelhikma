/**
 * La mémoire de l'écran des téléchargements.
 *
 * La file **efface** un travail dès qu'il est installé (`DownloadQueue.#run`
 * écrit `installed` puis retire le job) : il n'existe aucun état « terminé »
 * que l'écran puisse lire, et un livre qu'on vient de télécharger disparaît
 * sans un mot. C'est l'écran qui doit se souvenir de ce qu'il a vu passer.
 *
 * Ce module est pur, et il ne dit qu'une chose : ce qui a **quitté** la file.
 * Il ne dit jamais qu'un livre est installé — vues d'ici, les deux sorties d'un
 * travail se ressemblent : installé, ou annulé. C'est le dépôt qui tranche,
 * sinon le bouton « lire » s'afficherait sur un téléchargement annulé.
 */

/** Statuts pendant lesquels la file travaille encore sur ce livre. */
export const BUSY = new Set(['queued', 'downloading', 'verifying']);

/**
 * Combien de livres tout juste installés l'écran garde sous les yeux. Une
 * session qui en télécharge cent ne doit pas pousser la file en cours — celle
 * qu'on est venu surveiller — hors de l'écran.
 */
export const FINISHED_LIMIT = 5;

/**
 * Ce que la file porte maintenant, et ce qui l'a quittée depuis le passage
 * précédent. `watched` est le `present` rendu au passage d'avant.
 */
export function departures(watched = new Set(), jobs = []) {
  const present = new Set();
  for (const job of jobs) if (job?.editionId) present.add(job.editionId);
  return { present, left: [...watched].filter((id) => !present.has(id)) };
}

/**
 * Les derniers livres installés, le plus récent en tête et sans doublon : un
 * même livre confirmé deux fois ne fait qu'une ligne, et c'est la plus fraîche
 * qui reste.
 */
export function rememberFinished(finished = new Map(), rows = [], limit = FINISHED_LIMIT) {
  const next = new Map();
  for (const row of rows) if (row?.editionId) next.set(row.editionId, row);
  for (const [editionId, row] of finished) if (!next.has(editionId)) next.set(editionId, row);
  return new Map([...next].slice(0, Math.max(limit, 0)));
}
