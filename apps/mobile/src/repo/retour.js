/**
 * Le geste retour d'Android, rendu à l'interface.
 *
 * Sur Android il n'y a pas de croix : il y a le glissement depuis le bord de
 * l'écran, et c'est le geste le plus fait de l'appareil. Sans personne pour
 * l'écouter, il retombe sur le défaut de la WebView — `history.back()` — et
 * emporte donc l'écran entier alors qu'un panneau est ouvert par-dessus : on
 * lit, on ouvre le sommaire, on fait le geste pour le refermer, et l'on se
 * retrouve sur la fiche du livre. Aucun lecteur du marché ne se comporte ainsi.
 *
 * La règle est **une couche à la fois**, la plus haute d'abord — celle que
 * `Escape` applique déjà dans le lecteur.
 *
 * ## Comment il parle au rendu
 *
 * Par un évènement, jamais par un `import`. Ce fichier vit dans `src/repo/`,
 * que `prepare-www.mjs` dépose en `www/js/repo/` ; le registre, lui, vit dans
 * le rendu partagé, en `www/js/back-intent.js`. Un chemin relatif devrait être
 * juste dans les **deux** arbres — celui du dépôt, où `scripts/verify.mjs`
 * charge ce module, et celui de `www/`, où il s'exécute. Aucun ne peut l'être,
 * et c'est le même obstacle qui fait déjà charger `shared/arabic.js` par URL
 * calculée.
 *
 * L'évènement le supprime au lieu de le contourner, et il reprend la convention
 * que le projet a retenue pour `Ctrl+F` : celui qui répond appelle
 * `preventDefault()`, celui qui a émis lit le refus dans ce que rend
 * `dispatchEvent`.
 *
 * Fabrique sans aucun `import`, comme les autres modules de `repo/` : elle
 * reçoit `App` et `document` en argument, et se laisse donc éprouver hors
 * appareil.
 */

/** Le nom de l'évènement. Il est cité ici et dans `js/back-intent.js`, nulle part ailleurs. */
export const BACK_INTENT = 'beyt:back';

/**
 * Branche le bouton retour matériel. Rend de quoi le débrancher — ce dont
 * l'application n'a pas l'usage, mais dont un test en a besoin.
 *
 * [App] est le greffon `@capacitor/app`. Absent — sous Electron, ou dans une
 * vérification hors appareil — on ne branche rien et l'on rend une fonction
 * inerte : ce module doit pouvoir se charger là où il n'a rien à faire.
 */
export function brancherRetour({ App, document, history, quitter } = {}) {
  if (!App?.addListener || !document?.dispatchEvent) return () => {};

  const surRetour = () => {
    // `dispatchEvent` rend `false` quand un écouteur a appelé
    // `preventDefault()` : une couche s'est fermée, le geste est consommé.
    const passe = document.dispatchEvent(
      new CustomEvent(BACK_INTENT, { cancelable: true }),
    );
    if (!passe) return;

    // Personne n'a rien fermé : le geste redevient ce qu'il est ailleurs dans
    // le système — on remonte d'un écran, et à la racine on sort. Quitter
    // depuis n'importe où renverrait un lecteur au bureau d'Android au lieu de
    // sa bibliothèque.
    if ((history?.length ?? 0) > 1) history.back();
    else quitter?.();
  };

  const inscription = App.addListener('backButton', surRetour);
  // `addListener` rend une promesse d'inscription sous Capacitor 8, et
  // l'inscription elle-même sous les versions antérieures. Les deux se
  // débranchent de la même façon si l'on attend d'abord.
  return async () => {
    const posee = await inscription;
    await posee?.remove?.();
  };
}
