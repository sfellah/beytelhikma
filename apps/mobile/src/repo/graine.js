/**
 * Plante la graine de catalogue au premier lancement.
 *
 * L'APK embarque `assets/catalog.sqlite.zst` — le catalogue compressé, tiré du
 * bucket au moment du build par `scripts/fetch-seed.mjs` (la recette du bureau,
 * importée et non recopiée). Sans elle, une application installée sans
 * `adb push` ouvrait `catalog.sqlite`, ne le trouvait pas, et ne montrait
 * rien : aucun chemin de premier lancement n'allait le chercher.
 *
 * Fabrique sans aucun `import`, comme les autres modules de `repo/` : le rendu
 * se sert sans bundler, et c'est ce qui permet à `scripts/verify.mjs`
 * d'éprouver ce module avec des dépendances factices, sans appareil.
 */

/**
 * Taille d'une tranche d'écriture : 384 Kio, la même que `telechargements.js`
 * et pour les mêmes raisons — `Filesystem.writeFile` prend du base64, un
 * multiple de 3 s'encode sans remplissage `=`, et la chaîne transmise fait
 * 512 Kio, un message confortable pour le pont Android.
 */
const TRANCHE = 384 * 1024;

/**
 * Octets vers base64, par blocs de 32 Kio : `String.fromCharCode(...octets)`
 * étale le tableau en arguments, que le moteur refuse au-delà de quelques
 * dizaines de milliers d'éléments.
 */
function versBase64(octets) {
  const BLOC = 0x8000;
  let binaire = '';
  for (let i = 0; i < octets.length; i += BLOC) {
    binaire += String.fromCharCode.apply(null, octets.subarray(i, i + BLOC));
  }
  return btoa(binaire);
}

/**
 * Rend `planterGraineSiAbsente(racine)`, fermée sur [ctx] : les erreurs
 * (`RepositoryError`), la sonde (`chrono`), les greffons (`filesystem`,
 * `sqlite`), la décompression (`decompressZstd`) et la lecture de l'archive
 * embarquée (`chargerGraine`) — le shim est le seul à savoir d'où elle vient.
 */
export function creerPlanteurGraine(ctx) {
  const { RepositoryError, chrono, filesystem, sqlite, decompressZstd, chargerGraine } = ctx;

  /** Écrit un tampon complet : la première tranche crée, les suivantes ajoutent. */
  async function ecrireParTranches(chemin, octets) {
    for (let ecrit = 0; ecrit < octets.length; ecrit += TRANCHE) {
      const data = versBase64(octets.subarray(ecrit, ecrit + TRANCHE));
      if (ecrit === 0) await filesystem().writeFile({ path: chemin, data, recursive: true });
      else await filesystem().appendFile({ path: chemin, data });
    }
  }

  /**
   * Rend `{ action: 'present' }` sans rien toucher si le catalogue est là,
   * `{ action: 'planted', bytes }` après l'avoir installé sinon.
   *
   * Pas de mémoïsation ici : le seul appelant est `catalogue()`, dont la
   * promesse est déjà mémorisée — et oubliée en cas d'échec, ce qui laisse la
   * lecture suivante retenter la plantation.
   */
  return async function planterGraineSiAbsente(racine) {
    const cible = `${racine}/catalog.sqlite`;

    // **Seulement si le catalogue est absent** — la règle d'`AppDatabase.#plantSeed`,
    // et elle n'est pas devinable : la graine est figée à la date du build,
    // alors que le catalogue installé a pu être mis à jour depuis le bucket.
    // L'écraser ferait régresser le catalogue de l'utilisateur à chaque mise à
    // jour de l'application — une mise à jour qui retire des livres.
    let present = false;
    try {
      present = Boolean((await sqlite().isNCDatabase({ databasePath: cible }))?.result);
    } catch {
      present = false; // fichier absent : c'est le premier lancement
    }
    if (present) return { action: 'present' };

    const fin = chrono();
    const clair = await decompressZstd(await chargerGraine());

    // De côté puis renommé, comme `#plantSeed` et comme toute écriture du
    // projet : une coupure ne laisse jamais un catalogue tronqué qui serait
    // pris pour valide au démarrage suivant. L'empreinte n'est pas revérifiée
    // ici — `fetch-seed.mjs` l'a contrôlée au build, et l'archive voyage dans
    // l'APK, pas sur le réseau.
    const depose = `${cible}.seed`;
    try {
      await ecrireParTranches(depose, clair);
      await filesystem().rename({ from: depose, to: cible }); // le dernier geste
    } catch (erreur) {
      try {
        await filesystem().deleteFile({ path: depose });
      } catch {
        // Jamais écrit, ou déjà parti : les deux conviennent.
      }
      throw new RepositoryError('plantation de la graine de catalogue', 'query-failed', erreur);
    }

    fin('graine:plantation', `${clair.length} octet(s)`);
    return { action: 'planted', bytes: clair.length };
  };
}
