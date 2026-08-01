/**
 * Validation d'un identifiant d'édition, avant tout `path.join`.
 *
 * Un `edition_id` arrive du rendu par le pont IPC, et le rendu le tient d'un
 * fragment d'URL (`#/reader/:id`). Il désigne pourtant un **nom de fichier** :
 * `books/<edition_id>.sqlite`, `downloads/<edition_id>.zst.part`. Un
 * identifiant qui contient `..` ou un séparateur sort du dossier, et
 * `deleteBook` efface alors ce qu'il trouve — `fs.rmSync(…, { force: true })`
 * ne pose aucune question.
 *
 * La règle est donc posée ici, une fois, et appelée à chaque frontière avec le
 * disque : ouverture d'un livre, suppression, mesure de place, mise en file.
 * Le corpus n'utilise que deux formes — `sh-1234` (Shamela) et
 * `ed-bukhari-01` (jeu d'exemple) — toutes deux couvertes.
 */

/**
 * Une lettre ou un chiffre en tête, puis lettres, chiffres, `-` et `_`.
 *
 * Le point est **exclu** : il n'apparaît dans aucun identifiant du corpus, et
 * l'admettre laisserait passer `..`, qui est précisément ce qu'on refuse.
 */
const EDITION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isEditionId(value) {
  return EDITION_ID.test(String(value ?? ''));
}

/** Rend l'identifiant tel quel, ou lève. */
export function assertEditionId(value) {
  const id = String(value ?? '');
  if (!EDITION_ID.test(id)) throw new Error(`identifiant d'édition invalide : ${id}`);
  return id;
}
