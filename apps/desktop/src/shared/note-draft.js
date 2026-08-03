/**
 * Écrire une note sur une sélection : **demander d'abord, écrire ensuite**.
 *
 * Le défaut que cette règle corrige : le surlignage était posé — donc écrit
 * dans `user.sqlite` — *avant* que l'éditeur ne s'ouvre. « Annuler » ne rendait
 * alors que la note ; le passage restait teinté, et rien à l'écran ne disait
 * comment le retirer. Annuler doit rendre l'état d'avant la sélection, entier.
 *
 * L'ordre **est** la correction. Rien n'est persisté tant que le texte n'est
 * pas validé : il n'y a donc aucun rattrapage à écrire, aucun surlignage à
 * supprimer après coup, et surtout aucun risque de défaire celui d'à côté — un
 * surlignage **préexistant** qu'on annote n'est jamais créé ici, donc jamais
 * emporté par un refus. C'est la seule différence entre « nouvelle note sur
 * nouvelle sélection » et « édition d'une note existante », et elle se lit dans
 * le fait que la seconde ne passe pas par cette fonction.
 *
 * Les trois gestes arrivent en argument : c'est la seule façon d'éprouver la
 * règle dans les deux sens — accepté, refusé — sans un DOM ni une base.
 *
 * @param {object} gestes
 * @param {() => Promise<string|null>} gestes.ask ouvre l'éditeur ; `null` ou
 *   vide valent refus.
 * @param {() => Promise<object|null>} gestes.createHighlight pose le surlignage,
 *   et **seulement** si le texte a été validé.
 * @param {(highlight: object, content: string) => Promise<object|null>} gestes.saveNote
 * @returns {Promise<object|null>} la note écrite, ou `null` si rien ne l'a été.
 */
export async function composeNote({ ask, createHighlight, saveNote }) {
  const content = await ask();
  // `null` (annulé) et le vide se valent : une note sans texte n'est pas une
  // note, et la poser laisserait un surlignage que personne n'a demandé.
  if (!content) return null;

  const highlight = await createHighlight();
  // L'écriture du surlignage a échoué : pas de note orpheline. Une note sans
  // ancre ne se repeindrait sur aucune page.
  if (!highlight) return null;

  return (await saveNote(highlight, content)) ?? null;
}
