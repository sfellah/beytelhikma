#!/usr/bin/env node
/**
 * Remplit le cache local de la graine de catalogue embarquée dans l'APK.
 *
 *   node scripts/fetch-seed.mjs
 *
 * C'est **la recette du bureau, importée** : `fetchSeed` de
 * `apps/desktop/scripts/fetch-seed.mjs` télécharge le `.zst` depuis le bucket,
 * vérifie son empreinte contre le pointeur, refuse un `schema_version` trop
 * récent, et décrit ce qu'il a embarqué (`catalog-seed.json`) pour rendre
 * l'étape idempotente. La recopier ouvrirait la dérive que le projet a déjà
 * payée trois fois ; seule la destination change.
 *
 * La destination est le cache `data/` — jamais `www/` directement :
 * `prepare-www.mjs` efface et refait `www/` à chaque exécution, une graine
 * posée là disparaîtrait au premier `npm run sync`. C'est lui qui la copie
 * dans `www/assets/`, depuis ce cache.
 *
 * Aucun repli : une source injoignable arrête tout. Un APK silencieusement
 * obsolète est pire qu'un build raté, parce que l'erreur se découvre alors
 * chez l'utilisateur.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { fetchSeed } from '../../desktop/scripts/fetch-seed.mjs';
import { DEFAULT_BASE_URL } from '../../desktop/src/shared/distribution.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const lancéDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (lancéDirectement) {
  const baseUrl = process.env.BEYTELHIKMA_BASE_URL || DEFAULT_BASE_URL;
  try {
    const rapport = await fetchSeed({ baseUrl, assetsDir: path.join(RACINE, 'data') });
    const verbe = rapport.action === 'fetched' ? 'mise en cache' : 'déjà à jour';
    console.log(
      `graine ${verbe} : catalogue v${rapport.catalogVersion}, ` +
        `${rapport.pointeur.edition_count} éditions, depuis ${baseUrl}\n` +
        '  data/catalog.sqlite.zst — prepare-www la copie dans www/assets/ à chaque sync',
    );
  } catch (erreur) {
    console.error(`échec de la récupération de la graine : ${erreur.message}`);
    process.exit(1);
  }
}
