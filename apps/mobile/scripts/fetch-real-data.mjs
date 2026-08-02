#!/usr/bin/env node
/**
 * Tire le vrai catalogue et un vrai livre du bucket de distribution, puis les
 * pousse sur l'appareil.
 *
 * Ce que le spike doit mesurer — l'ouverture de 28,8 Mo de catalogue, une
 * requête d'accueil sur 8 568 éditions, FTS5 — ne se mesure que sur les vraies
 * données. Le jeu d'exemple (5 livres, 3 à 5 pages) répondrait « instantané » à
 * toutes les questions et n'en trancherait aucune.
 *
 * Le zstd est résolu **ici**, sur la machine de développement, jamais sur
 * l'appareil : la décompression embarquée est explicitement hors périmètre du
 * spike, et passer par `adb push` garde ce maillon écarté sans l'escamoter.
 *
 * L'URL de base, la clé du pointeur et la version de schéma supportée sont
 * **importées** de l'application, pas recopiées. Le projet a déjà payé trois
 * fois le prix d'une constante entretenue en double (le thème `sepia`, la liste
 * des polices, `MIRROR_DIRS`) ; un spike n'a pas de raison d'ouvrir la
 * quatrième.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import { POINTER_KEY, SUPPORTED_SCHEMA_VERSION } from '../../../apps/desktop/src/main/catalog-updater.js';
import { assertEditionId } from '../../../apps/desktop/src/main/edition-id.js';
import { DEFAULT_BASE_URL, resolveObject } from '../../../apps/desktop/src/shared/distribution.js';

const RACINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DONNÉES = path.join(RACINE, 'data');
const MANIFESTE = path.join(DONNÉES, 'manifest.json');
const CATALOGUE = path.join(DONNÉES, 'catalog.sqlite');

/** Fourchette de pages visée : assez pour éprouver le rendu, assez peu pour tenir. */
const PAGES_MIN = 100;
const PAGES_MAX = 400;

const AIDE = `
fetch-real-data.mjs — tire le catalogue et un livre du bucket, puis les pousse
sur l'appareil.

  node scripts/fetch-real-data.mjs                 tout : télécharge, vérifie, pousse
  node scripts/fetch-real-data.mjs --push-only     repousse ce qui est déjà dans data/
  node scripts/fetch-real-data.mjs --edition sh-42 force l'édition au lieu de la choisir
  node scripts/fetch-real-data.mjs --help          ceci

Variables d'environnement :
  BEYTELHIKMA_BASE_URL   source de distribution (défaut : ${DEFAULT_BASE_URL})
  ADB                    chemin de l'exécutable adb, s'il n'est pas dans le PATH

Sans adb ni appareil, les fichiers sont écrits quand même et le push est sauté :
récupérer les données reste utile sans téléphone branché.
`.trimStart();

/**
 * Échec attendu — réseau coupé, empreinte fausse, adb absent. Il se raconte en
 * une phrase et se répare ; une trace de pile n'apprendrait rien de plus et
 * ferait passer un cas prévu pour un bug.
 */
class ÉchecPrévu extends Error {}

/**
 * La règle du projet sur les identifiants d'édition, avec un message qui dit
 * d'où venait la valeur. Elle s'applique aux trois provenances — la ligne de
 * commande, le catalogue, le manifeste — parce que toutes trois finissent en
 * nom de fichier, ici et sur l'appareil.
 */
function identifiant(valeur, provenance) {
  try {
    return assertEditionId(valeur);
  } catch {
    throw new ÉchecPrévu(
      `identifiant d'édition invalide (${provenance}) : ${valeur}\n` +
        '  attendu : lettres, chiffres, tiret et souligné — par exemple sh-7745.',
    );
  }
}

// ------------------------------------------------------------------ affichage

// Mégaoctets décimaux, comme le bucket et la spec les comptent (28,8 Mo de
// catalogue) : basculer en Mio ferait dire 27,5 au même fichier.
const mo = (octets) => `${(octets / 1_000_000).toFixed(1)} Mo`;

/**
 * Rend un rapporteur de progression qui ne parle qu'au changement de
 * pourcentage : un appel par paquet reçu noierait la sortie sous des milliers
 * de lignes. Sur un terminal on réécrit sur place, sinon on jalonne au quart —
 * un journal de build n'a pas de retour chariot. Le jalon est *franchi*, pas
 * atteint pile : aucun paquet ne tombe sur 25 % rond.
 */
function progression(étiquette, total) {
  const nom = étiquette.padEnd(9);
  let dernierPct = -1;
  let jalon = -25;
  return (reçu) => {
    const pct = total > 0 ? Math.min(100, Math.floor((reçu / total) * 100)) : -1;
    if (pct < 0 || pct === dernierPct) return;
    dernierPct = pct;
    if (process.stdout.isTTY) process.stdout.write(`\r  ${nom} ${String(pct).padStart(3)} %`);
    else if (pct >= jalon + 25) {
      jalon = pct - (pct % 25);
      console.log(`  ${nom} ${jalon} %`);
    }
  };
}

const finProgression = () => {
  if (process.stdout.isTTY) process.stdout.write('\n');
};

// ------------------------------------------------------------------- réseau

async function litPointeur(baseUrl) {
  const { url } = resolveObject(baseUrl, POINTER_KEY);
  let texte;
  try {
    texte = await fetch(url, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    });
  } catch (erreur) {
    throw new ÉchecPrévu(
      `pointeur illisible sur ${url} : ${erreur.message}\n` +
        '  vérifiez la connexion réseau, ou BEYTELHIKMA_BASE_URL si vous visez un autre bucket.',
    );
  }

  let pointeur;
  try {
    pointeur = JSON.parse(texte);
  } catch {
    throw new ÉchecPrévu(`pointeur malformé sur ${url} : ce n'est pas du JSON.`);
  }

  // Rien n'est codé en dur : tout ce qui suit vient de ces champs. S'ils
  // manquent, mieux vaut le dire ici que planter plus loin sur un `undefined`.
  for (const champ of ['catalog_version', 'schema_version', 'object_key', 'sha256']) {
    if (pointeur[champ] === undefined || pointeur[champ] === null) {
      throw new ÉchecPrévu(`pointeur incomplet : champ « ${champ} » absent de ${url}.`);
    }
  }
  if (pointeur.schema_version > SUPPORTED_SCHEMA_VERSION) {
    throw new ÉchecPrévu(
      `schéma de catalogue ${pointeur.schema_version} non supporté ` +
        `(ce spike lit jusqu'au ${SUPPORTED_SCHEMA_VERSION}) — ` +
        "le shim ne saurait pas ouvrir ce catalogue, inutile de le télécharger.",
    );
  }
  return pointeur;
}

async function empreinteFichier(chemin) {
  const empreinte = createHash('sha256');
  await pipeline(fs.createReadStream(chemin), empreinte);
  return empreinte.digest('hex');
}

/** Le fichier est-il déjà là, et bien celui qu'annonce l'empreinte attendue ? */
async function déjàBon(cible, sha256Attendu) {
  if (!fs.existsSync(cible)) return false;
  try {
    return (await empreinteFichier(cible)) === sha256Attendu;
  } catch {
    return false; // illisible : autant le retélécharger
  }
}

/**
 * Télécharge, décompresse, vérifie, installe — dans cet ordre, qui est le seul
 * qui tienne. L'empreinte porte sur le contenu **décompressé** (c'est celle que
 * `download-manager.js` contrôle aussi), et le `rename` est le dernier geste :
 * une coupure à n'importe quel point laisse `cible` intacte ou absente, jamais
 * à moitié écrite — un `.sqlite` tronqué s'ouvrirait sans broncher et mentirait.
 *
 * Pas de reprise par en-tête `Range` ici, contrairement au vrai téléchargeur :
 * lui installe 8 589 livres sur des liens qu'il ne choisit pas, ce script en
 * tire deux sur une machine de développement, et la reprise qui compte à cette
 * échelle est celle du fichier entier — voir `déjàBon`.
 */
async function tire({ url, cible, tailleCompressée, sha256Attendu, étiquette }) {
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  const temp = `${cible}.tmp`;
  fs.rmSync(temp, { force: true }); // reste d'une exécution interrompue

  let réponse;
  try {
    réponse = await fetch(url, { cache: 'no-store' });
  } catch (erreur) {
    throw new ÉchecPrévu(
      `téléchargement impossible (${étiquette}) : ${erreur.message}\n` +
        '  rien n\'a été écrit — vérifiez la connexion réseau, puis relancez.',
    );
  }
  if (réponse.status === 404) {
    throw new ÉchecPrévu(
      `objet absent du bucket : ${url}\n` +
        '  le catalogue annonce une clé que la source ne sert pas ; republiez, ou visez un autre bucket.',
    );
  }
  if (!réponse.ok) throw new ÉchecPrévu(`réponse HTTP ${réponse.status} pour ${url}`);

  const total = Number(réponse.headers.get('content-length')) || tailleCompressée || 0;
  const avance = progression(étiquette, total);
  let reçu = 0;
  const empreinte = createHash('sha256');

  try {
    await pipeline(
      Readable.fromWeb(réponse.body),
      // Compté **avant** la décompression : c'est le trafic réseau qui est long,
      // et `content-length` ne parle que de lui.
      new Transform({
        transform(paquet, _encodage, fini) {
          reçu += paquet.length;
          avance(reçu);
          fini(null, paquet);
        },
      }),
      zlib.createZstdDecompress(),
      new Transform({
        transform(paquet, _encodage, fini) {
          empreinte.update(paquet);
          fini(null, paquet);
        },
      }),
      fs.createWriteStream(temp),
    );
  } catch (erreur) {
    fs.rmSync(temp, { force: true });
    if (erreur?.code === 'ENOSPC') {
      throw new ÉchecPrévu(`disque plein en écrivant ${temp} — libérez de la place et relancez.`);
    }
    throw new ÉchecPrévu(
      `flux interrompu (${étiquette}) : ${erreur.message}\n` +
        '  le fichier partiel a été supprimé — relancez.',
    );
  }
  finProgression();

  const obtenue = empreinte.digest('hex');
  if (obtenue !== sha256Attendu) {
    fs.rmSync(temp, { force: true });
    throw new ÉchecPrévu(
      `empreinte invalide (${étiquette})\n` +
        `  obtenue : ${obtenue}\n` +
        `  attendue : ${sha256Attendu}\n` +
        '  le fichier a été supprimé ; relancez, et si cela persiste, la source est en cause.',
    );
  }

  fs.renameSync(temp, cible);
  return fs.statSync(cible).size;
}

// ---------------------------------------------------------------- catalogue

/**
 * Une release et son édition. `GROUP BY` sur l'édition parce qu'un livre peut
 * porter plusieurs auteurs : on en montre un, comme `SUMMARY_SELECT` du
 * repository, dont ce SQL reprend la forme.
 */
const SÉLECTION = `
  SELECT r.edition_id,
         r.object_key,
         r.sha256,
         r.compressed_size,
         r.uncompressed_size,
         r.page_count,
         e.title_ar,
         COALESCE(a.short_name_ar, a.full_name_ar) AS author_name
  FROM book_releases r
  JOIN editions e              ON e.edition_id = r.edition_id
  LEFT JOIN edition_authors ea ON ea.edition_id = e.edition_id AND ea.role = 'author'
  LEFT JOIN authors a          ON a.author_id = ea.author_id
  WHERE r.is_active = 1
`;

/**
 * Choisit **une** édition : la médiane en taille parmi celles de 100 à 400
 * pages. Ni la plus grosse — elle mesurerait le pire cas, pas le cas — ni la
 * plus petite, qui ne dirait rien du rendu. La médiane est stable d'une
 * exécution à l'autre pour un catalogue donné (`edition_id` départage les
 * tailles égales) : relancer le script ne change donc pas de livre, et le
 * manifeste garde son sens.
 */
function choisisÉdition(db, forcée) {
  if (forcée) {
    const ligne = db
      .prepare(`${SÉLECTION} AND r.edition_id = ? GROUP BY r.edition_id LIMIT 1`)
      .get(forcée);
    if (!ligne) {
      throw new ÉchecPrévu(
        `édition « ${forcée} » introuvable, ou sans release active dans ce catalogue.\n` +
          '  omettez --edition pour laisser le script en choisir une.',
      );
    }
    return ligne;
  }

  const candidates = db
    .prepare(
      `${SÉLECTION} AND e.is_hidden = 0
         AND r.page_count BETWEEN ? AND ?
         AND r.compressed_size > 0
       GROUP BY r.edition_id
       ORDER BY r.compressed_size, r.edition_id`,
    )
    .all(PAGES_MIN, PAGES_MAX);

  if (candidates.length === 0) {
    throw new ÉchecPrévu(
      `aucune édition de ${PAGES_MIN} à ${PAGES_MAX} pages dans ce catalogue.\n` +
        '  passez --edition <id> pour en désigner une à la main.',
    );
  }
  return candidates[Math.floor(candidates.length / 2)];
}

/** Ce que `catalog_info` dit de lui-même, plutôt que ce que le pointeur promet. */
function infoCatalogue(db) {
  return db.prepare('SELECT catalog_version, schema_version, edition_count FROM catalog_info').get();
}

// ---------------------------------------------------------------------- adb

/**
 * Le premier `adb` qui répond. Le PATH d'abord ; les emplacements du SDK
 * ensuite, parce qu'une installation par Android Studio ne met rien dans le
 * PATH et que faire échouer le push pour ça serait un faux négatif.
 */
function trouveAdb() {
  const candidats = [
    process.env.ADB,
    'adb',
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', 'adb'),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'),
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb'),
  ].filter(Boolean);

  for (const candidat of candidats) {
    const essai = spawnSync(candidat, ['version'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) return candidat;
  }
  return null;
}

/** Les appareils prêts. `unauthorized` et `offline` n'en sont pas. */
function appareilsPrêts(adb) {
  const sortie = spawnSync(adb, ['devices'], { encoding: 'utf8' });
  if (sortie.error || sortie.status !== 0) return [];
  return sortie.stdout
    .split(/\r?\n/)
    .slice(1) // « List of devices attached »
    .map((ligne) => ligne.trim().split(/\s+/))
    .filter(([série, état]) => série && état === 'device')
    .map(([série]) => série);
}

function lance(adb, série, args, quoi) {
  const complet = série ? ['-s', série, ...args] : args;
  const sortie = spawnSync(adb, complet, { encoding: 'utf8' });
  if (sortie.error) throw new ÉchecPrévu(`adb injoignable pendant ${quoi} : ${sortie.error.message}`);
  if (sortie.status !== 0) {
    const détail = (sortie.stderr || sortie.stdout || '').trim().split(/\r?\n/).slice(-3).join('\n  ');
    throw new ÉchecPrévu(`échec de ${quoi} :\n  ${détail}`);
  }
  return sortie.stdout;
}

/**
 * Pousse vers le répertoire externe **propre à l'application**. `adb` peut y
 * écrire et l'app le lit sans aucune permission, contrairement à `/sdcard` nu,
 * que le stockage cloisonné d'Android 11+ ferme.
 *
 * Rend `true` si le push a eu lieu, `false` s'il a été sauté faute d'appareil —
 * dans ce cas le script réussit quand même : les fichiers sont sur le disque,
 * et c'est déjà l'essentiel de ce qu'on venait chercher.
 */
function pousseSurAppareil(fichiers) {
  const adb = trouveAdb();
  if (!adb) {
    console.log(
      "\npush sauté : adb introuvable.\n" +
        '  ajoutez platform-tools au PATH, ou donnez ADB=<chemin de adb>.\n' +
        '  les fichiers sont écrits dans data/ ; relancez avec --push-only quand adb sera là.',
    );
    return false;
  }

  const prêts = appareilsPrêts(adb);
  if (prêts.length === 0) {
    console.log(
      "\npush sauté : aucun appareil connecté.\n" +
        '  branchez le téléphone (débogage USB actif) ou démarrez un émulateur,\n' +
        '  puis relancez avec --push-only. Les fichiers sont déjà dans data/.',
    );
    return false;
  }

  // Plusieurs appareils : `adb push` refuse de choisir. On le fait, et on le dit.
  const série = prêts.length > 1 ? prêts[0] : null;
  if (série) console.log(`\n${prêts.length} appareils connectés — cible : ${série}`);

  faitCréerLesDossiers(adb, série);

  for (const { local, distant } of fichiers) {
    console.log(`  push ${path.basename(local)} -> ${distant}`);
    lance(adb, série, ['push', local, distant], `le push de ${path.basename(local)}`);
  }

  avertitSiDossierAuShell(adb, série, `${racineAppareil()}/books`);
  return true;
}

/**
 * Fait poser les dossiers par l'application, en la démarrant une fois.
 *
 * Sous le stockage cloisonné d'Android, un dossier appartient à qui l'a créé.
 * `adb shell mkdir` — et `adb push`, qui crée ses parents de la même façon —
 * le posent au nom du shell, et l'application ne peut alors plus le
 * **traverser**. Un *fichier* déposé par adb reste pourtant lisible : d'où un
 * défaut qui ne ressemble pas à un problème de droits. Le catalogue, posé à
 * plat, s'ouvre parfaitement ; le livre, en sous-dossier, est déclaré absent.
 *
 * Le seul créateur légitime est donc l'application. On la démarre, elle pose
 * `beytelhikma/` et `beytelhikma/books/` en s'initialisant, et le push retombe
 * dans des dossiers qui lui appartiennent.
 */
function faitCréerLesDossiers(adb, série) {
  const config = JSON.parse(fs.readFileSync(path.join(RACINE, 'capacitor.config.json'), 'utf8'));
  const sortie = spawnSync(
    adb,
    [...(série ? ['-s', série] : []), 'shell', 'am', 'start', '-n', `${config.appId}/.MainActivity`],
    { encoding: 'utf8' },
  );

  if (sortie.status !== 0 || /Error/i.test(sortie.stderr ?? '')) {
    console.log(
      "  application pas encore installée : les dossiers seront créés par adb.\n" +
        '    relancez `npm run push` après `npm run android`, sinon le livre\n' +
        "    restera invisible à l'application.",
    );
    lance(adb, série, ['shell', 'mkdir', '-p', `${racineAppareil()}/books`], 'la création du dossier');
    return;
  }

  console.log("  application démarrée — elle pose ses dossiers");
  // Le pont Capacitor et le premier `Filesystem.mkdir` prennent un instant.
  spawnSync(adb, [...(série ? ['-s', série] : []), 'shell', 'sleep', '4'], { encoding: 'utf8' });
}

/** Dernier filet : si le dossier est resté au shell, le dire plutôt que de le taire. */
function avertitSiDossierAuShell(adb, série, dossier) {
  const sortie = spawnSync(
    adb,
    [...(série ? ['-s', série] : []), 'shell', 'ls', '-ld', dossier],
    { encoding: 'utf8' },
  );
  if (sortie.status !== 0) return;
  if (!/\s+shell\s+/.test(sortie.stdout)) return;

  console.log(
    `\nattention : ${dossier} appartient au shell, pas à l'application.\n` +
      "  elle ne pourra pas le traverser et déclarera le livre absent.\n" +
      `  correctif : adb shell rm -rf ${dossier}, puis relancez après avoir\n` +
      '  ouvert l\'application une fois.',
  );
}

/** `appId` vient du fichier Capacitor : deux copies dériveraient au premier renommage. */
function racineAppareil() {
  const config = JSON.parse(fs.readFileSync(path.join(RACINE, 'capacitor.config.json'), 'utf8'));
  if (!config.appId) throw new ÉchecPrévu('capacitor.config.json ne porte pas d\'appId.');
  return `/sdcard/Android/data/${config.appId}/files/beytelhikma`;
}

// -------------------------------------------------------------------- modes

async function récupère({ baseUrl, éditionForcée }) {
  console.log(`source : ${baseUrl}`);
  const pointeur = await litPointeur(baseUrl);
  console.log(
    `pointeur : catalogue v${pointeur.catalog_version}, schéma ${pointeur.schema_version}, ` +
      `${pointeur.edition_count} éditions, ${mo(pointeur.compressed_size ?? 0)} compressés`,
  );

  if (await déjàBon(CATALOGUE, pointeur.sha256)) {
    console.log(`catalogue déjà là et conforme au pointeur — pas de téléchargement.`);
  } else {
    const { url } = resolveObject(baseUrl, pointeur.object_key);
    await tire({
      url,
      cible: CATALOGUE,
      tailleCompressée: pointeur.compressed_size,
      sha256Attendu: pointeur.sha256,
      étiquette: 'catalogue',
    });
    console.log(`catalogue écrit : ${CATALOGUE} (${mo(fs.statSync(CATALOGUE).size)})`);
  }

  const db = new DatabaseSync(CATALOGUE, { readOnly: true });
  let release;
  let info;
  try {
    info = infoCatalogue(db);
    release = choisisÉdition(db, éditionForcée);
  } finally {
    db.close();
  }

  const editionId = identifiant(release.edition_id, 'catalogue');

  console.log(
    `\nédition retenue : ${editionId}\n` +
      `  titre  : ${release.title_ar}\n` +
      `  auteur : ${release.author_name ?? '—'}\n` +
      `  pages  : ${release.page_count}, ${mo(release.uncompressed_size ?? 0)} décompressés`,
  );

  const livre = path.join(DONNÉES, 'books', `${editionId}.sqlite`);
  if (await déjàBon(livre, release.sha256)) {
    console.log('livre déjà là et conforme au catalogue — pas de téléchargement.');
  } else {
    const { url } = resolveObject(baseUrl, release.object_key);
    await tire({
      url,
      cible: livre,
      tailleCompressée: release.compressed_size,
      sha256Attendu: release.sha256,
      étiquette: 'livre',
    });
    console.log(`livre écrit : ${livre} (${mo(fs.statSync(livre).size)})`);
  }

  return {
    catalogVersion: info?.catalog_version ?? pointeur.catalog_version,
    schemaVersion: info?.schema_version ?? pointeur.schema_version,
    editionCount: info?.edition_count ?? pointeur.edition_count,
    editionId,
    title: release.title_ar,
    author: release.author_name ?? null,
    pageCount: release.page_count,
    catalogBytes: fs.statSync(CATALOGUE).size,
    bookBytes: fs.statSync(livre).size,
    catalogSha256: pointeur.sha256,
    bookSha256: release.sha256,
  };
}

/** Relit le manifeste et vérifie que ce qu'il décrit est encore sur le disque. */
function relisManifeste() {
  if (!fs.existsSync(MANIFESTE)) {
    throw new ÉchecPrévu(
      `data/manifest.json manquant : il n'y a rien à repousser.\n` +
        '  lancez d\'abord `node scripts/fetch-real-data.mjs` sans --push-only.',
    );
  }
  let manifeste;
  try {
    manifeste = JSON.parse(fs.readFileSync(MANIFESTE, 'utf8'));
  } catch (erreur) {
    throw new ÉchecPrévu(
      `data/manifest.json illisible : ${erreur.message}\n` +
        '  supprimez-le et relancez sans --push-only.',
    );
  }

  const editionId = identifiant(manifeste.editionId, 'manifeste');
  const livre = path.join(DONNÉES, 'books', `${editionId}.sqlite`);
  for (const fichier of [CATALOGUE, livre]) {
    if (!fs.existsSync(fichier)) {
      throw new ÉchecPrévu(
        `${path.relative(RACINE, fichier)} annoncé par le manifeste mais absent.\n` +
          '  relancez sans --push-only pour le retélécharger.',
      );
    }
  }
  return { ...manifeste, editionId };
}

// --------------------------------------------------------------------- main

async function principal(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(AIDE);
    return 0;
  }

  const pushSeul = argv.includes('--push-only');
  const iÉdition = argv.indexOf('--edition');
  const éditionForcée = iÉdition >= 0 ? argv[iÉdition + 1] : null;
  if (iÉdition >= 0 && !éditionForcée) {
    throw new ÉchecPrévu('--edition attend un identifiant : --edition sh-1234');
  }
  if (éditionForcée) identifiant(éditionForcée, '--edition');
  if (pushSeul && éditionForcée) {
    console.log('--edition est ignoré avec --push-only : le manifeste décide.');
  }

  // La valeur de `--edition` est exemptée — mais seulement si `--edition` est
  // là : sans le garde `iÉdition >= 0`, l'index 0 se retrouvait exempté et la
  // toute première option inconnue passait sans un mot.
  const CONNUES = ['--push-only', '--edition', '--help', '-h'];
  const inconnu = argv.find(
    (a, i) => a.startsWith('-') && !CONNUES.includes(a) && !(iÉdition >= 0 && i === iÉdition + 1),
  );
  if (inconnu) throw new ÉchecPrévu(`option inconnue : ${inconnu}\n\n${AIDE}`);

  fs.mkdirSync(path.join(DONNÉES, 'books'), { recursive: true });
  const racine = racineAppareil();

  const données = pushSeul
    ? relisManifeste()
    : await récupère({
        baseUrl: process.env.BEYTELHIKMA_BASE_URL || DEFAULT_BASE_URL,
        éditionForcée,
      });

  const devicePaths = {
    catalog: `${racine}/catalog.sqlite`,
    book: `${racine}/books/${données.editionId}.sqlite`,
    manifest: `${racine}/manifest.json`,
  };

  // Le manifeste est réécrit dans les deux modes : c'est lui que le reste du
  // spike lit, et il doit dire les chemins d'appareil courants — l'appId peut
  // avoir changé dans `capacitor.config.json` depuis la dernière récupération.
  const manifeste = {
    catalogVersion: données.catalogVersion,
    schemaVersion: données.schemaVersion,
    editionCount: données.editionCount,
    editionId: données.editionId,
    title: données.title,
    author: données.author,
    pageCount: données.pageCount,
    catalogBytes: données.catalogBytes,
    bookBytes: données.bookBytes,
    catalogSha256: données.catalogSha256,
    bookSha256: données.bookSha256,
    devicePaths,
  };
  fs.writeFileSync(MANIFESTE, `${JSON.stringify(manifeste, null, 2)}\n`);
  console.log(`\nmanifeste : ${MANIFESTE}`);

  const poussé = pousseSurAppareil([
    { local: CATALOGUE, distant: devicePaths.catalog },
    {
      local: path.join(DONNÉES, 'books', `${données.editionId}.sqlite`),
      distant: devicePaths.book,
    },
    // Le manifeste part avec les bases, jamais après : c'est lui qui dit à
    // l'application quelle édition ouvrir. Poussé à part, on obtient une
    // application qui a les fichiers sans savoir lequel est le sien.
    { local: MANIFESTE, distant: devicePaths.manifest },
  ]);

  console.log(
    poussé
      ? `\nprêt : ${données.editionCount} éditions et « ${données.title} » sont sur l'appareil.`
      : `\nprêt sur disque : ${données.editionCount} éditions et « ${données.title} » dans data/.`,
  );
  return 0;
}

try {
  process.exitCode = await principal(process.argv.slice(2));
} catch (erreur) {
  if (erreur instanceof ÉchecPrévu) {
    console.error(`\n${erreur.message}`);
    process.exitCode = 1;
  } else {
    throw erreur; // vrai bug : la trace est ce qu'on veut voir
  }
}
