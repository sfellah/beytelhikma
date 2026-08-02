#!/usr/bin/env node
/**
 * Contrôle de parité du shim Capacitor.
 *
 *   node scripts/verify.mjs
 *
 * Ce que ça garde : `src/repository.capacitor.js` remplace mot pour mot
 * `src/renderer/js/repository.js`. Toutes les vues importent depuis lui, et le
 * pont Electron leur promet 68 méthodes. Une méthode oubliée ne casse rien au
 * démarrage — elle échoue au premier clic, sur un écran, chez quelqu'un. C'est
 * la panne que `test/repository.test.js` évite déjà côté Electron ; ce fichier
 * en est le pendant côté spike.
 *
 * La liste de référence est **lue dans `preload.cjs`**, jamais recopiée : une
 * copie dériverait avec ce qu'elle contrôle, et le contrôle deviendrait un
 * décor.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { registerHooks } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const preloadPath = path.join(repoRoot, 'apps', 'desktop', 'src', 'preload', 'preload.cjs');
const vraiRepoPath = path.join(repoRoot, 'apps', 'desktop', 'src', 'renderer', 'js', 'repository.js');
const specPath = path.join(repoRoot, 'docs', 'superpowers', 'specs', '2026-08-02-capacitor-lecteur-design.md');
const shimPath = path.join(appDir, 'src', 'repository.capacitor.js');
const wwwRelatif = 'apps/mobile/www';

// ---------------------------------------------------------------------------
// Lecture des listes de référence — par analyse, pas par copie
// ---------------------------------------------------------------------------

/** Les noms de `METHODS` dans `preload.cjs` : c'est le pont qui décide. */
function lireMethodes(source) {
  const bloc = /const\s+METHODS\s*=\s*\[([\s\S]*?)\]\s*;/.exec(source);
  if (!bloc) throw new Error('`const METHODS = [...]` introuvable dans preload.cjs');
  return [...bloc[1].matchAll(/'([A-Za-z0-9_$]+)'/g)].map((trouve) => trouve[1]);
}

/** Les noms exportés par un module ESM, lus dans sa source. */
function lireExports(source) {
  return [
    ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z0-9_$]+)/gm),
  ].map((trouve) => trouve[1]);
}

/**
 * Les méthodes que la spec **annonce** implémentées contre SQLite natif.
 *
 * Lues dans le tableau de la spec pour la même raison que `METHODS` : la spec
 * est ce qui promet, et une promesse recopiée ici cesserait de suivre la
 * promesse. L'intersection avec `METHODS` évacue les autres mots entre accents
 * graves du tableau (`user.sqlite`, par exemple).
 */
function lireMethodesPortees(spec, methodes) {
  const lignes = spec.split('\n');
  const debut = lignes.findIndex((ligne) => ligne.includes('Implémentées contre SQLite natif'));
  if (debut < 0) throw new Error('la section « Implémentées contre SQLite natif » a disparu de la spec');
  const noms = new Set();
  let commence = false;
  for (const ligne of lignes.slice(debut + 1)) {
    const tableau = ligne.trimStart().startsWith('|');
    if (!tableau) {
      if (commence) break;
      continue;
    }
    commence = true;
    for (const [, nom] of ligne.matchAll(/`([^`]+)`/g)) {
      if (methodes.includes(nom)) noms.add(nom);
    }
  }
  return [...noms];
}

// ---------------------------------------------------------------------------
// Chargement du shim — import avec les modules Capacitor bouchonnés
// ---------------------------------------------------------------------------

/**
 * Choix : **import avec bouchons**, pas analyse statique du shim.
 *
 * Pourquoi. Ce qu'on contrôle est une *surface d'objet* : les 68 noms peuvent
 * être posés par une boucle, un spread, un `Proxy` ou 68 propriétés écrites à
 * la main. Une analyse statique devrait deviner la forme choisie par l'auteur
 * du shim — et un contrôle qui devine finit par valider ce qu'il ne comprend
 * pas. `Object.keys()` sur le module chargé rend exactement ce que les vues
 * verront, quelle que soit la façon de l'écrire.
 *
 * C'est aussi le seul moyen d'honorer le troisième contrôle : « une méthode
 * portée ne lève pas `not-ported` » se vérifie en l'appelant, pas en la lisant.
 *
 * Ce qui est bouchonné, et rien d'autre : `@capacitor-community/sqlite`,
 * `@capacitor/filesystem` et `@capacitor/core`, qui n'ont de sens que sur un
 * appareil. Les bouchons sont inertes — aucun appel natif ne part, aucune base
 * n'est ouverte. Le code d'initialisation du shim s'exécute donc bien, mais
 * contre du vide : c'est ce qu'on veut, puisque c'est lui qui pose la surface.
 *
 * Le crochet est `module.registerHooks` (Node 24, en fil courant) et non
 * `module.register` : ce dernier réclame un fichier de crochets séparé, et ce
 * contrôle tient en un fichier.
 */
const EXPORTS_BOUCHONNES = {
  '@capacitor/core': [
    'Capacitor',
    'registerPlugin',
    'WebPlugin',
    'CapacitorException',
    'ExceptionCode',
    'CapacitorHttp',
    'CapacitorCookies',
    'WebView',
    'buildRequestInit',
  ],
  '@capacitor-community/sqlite': ['CapacitorSQLite', 'SQLiteConnection', 'SQLiteDBConnection'],
  '@capacitor/filesystem': [
    'Filesystem',
    'Directory',
    'Encoding',
    'FilesystemDirectory',
    'FilesystemEncoding',
  ],
};

/** Noms réclamés par le shim et absents de la liste ci-dessus, appris à l'échec. */
const extras = new Map(Object.keys(EXPORTS_BOUCHONNES).map((nom) => [nom, new Set()]));
let generation = 0;

/**
 * Un bouchon rend, pour tout, le même objet inerte : appelable, constructible,
 * traversable. `then` reste `undefined` pour qu'un `await` le rende tel quel au
 * lieu de boucler — le shim peut donc `await` n'importe lequel de ses appels.
 */
function sourceBouchon(noms) {
  return `
const inerte = () =>
  new Proxy(function () {}, {
    get: (cible, cle) => (typeof cle === 'symbol' || cle === 'then' ? undefined : inerte()),
    apply: () => inerte(),
    construct: () => inerte(),
  });
${noms.map((nom) => `export const ${nom} = inerte();`).join('\n')}
export default inerte();
`;
}

registerHooks({
  resolve(specificateur, contexte, suivant) {
    if (EXPORTS_BOUCHONNES[specificateur]) {
      return { url: `bouchon:${specificateur}?g=${generation}`, shortCircuit: true };
    }
    return suivant(specificateur, contexte);
  },
  load(url, contexte, suivant) {
    if (!url.startsWith('bouchon:')) return suivant(url, contexte);
    const nom = url.slice('bouchon:'.length).split('?')[0];
    return {
      format: 'module',
      shortCircuit: true,
      source: sourceBouchon([...EXPORTS_BOUCHONNES[nom], ...extras.get(nom)]),
    };
  },
});

/**
 * Charge le shim, en apprenant les exports qu'il réclame et que les bouchons
 * n'ont pas. Un import ESM échoue à la liaison, pas à l'exécution : le message
 * nomme l'export manquant, on l'ajoute et on recommence. La `generation`
 * change l'URL des bouchons et le paramètre change celle du shim, sinon Node
 * rendrait les modules déjà en cache.
 */
async function chargerShim() {
  for (let essai = 0; essai < 40; essai += 1) {
    try {
      return await import(`${pathToFileURL(shimPath).href}?essai=${essai}`);
    } catch (erreur) {
      const manque = /module '([^']+)' does not provide an export named '([^']+)'/.exec(
        String(erreur?.message ?? ''),
      );
      const cle = manque && Object.keys(EXPORTS_BOUCHONNES).find((nom) => manque[1].includes(nom));
      if (!cle) throw erreur;
      extras.get(cle).add(manque[2]);
      generation += 1;
    }
  }
  throw new Error('le shim réclame plus de 40 exports absents des bouchons — abandon');
}

/**
 * Appelle une méthode sans argument et rend l'erreur obtenue, s'il y en a une.
 * On ne juge pas de la réussite : `db-missing`, `query-failed` ou un `TypeError`
 * du bouchon sont tous des réponses acceptables. La seule qui ne l'est pas est
 * `not-ported`, qui dirait que la méthode n'est pas là.
 */
async function erreurDAppel(fonction) {
  const delai = new Promise((_, rejeter) => {
    setTimeout(() => rejeter(new Error('délai dépassé')), 2000).unref();
  });
  try {
    await Promise.race([Promise.resolve(fonction()), delai]);
    return null;
  } catch (erreur) {
    return erreur;
  }
}

const estNonPortee = (erreur) =>
  Boolean(erreur) &&
  (erreur.code === 'not-ported' || String(erreur.message ?? '').includes('not-ported'));

// ---------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------

let echecs = 0;
let sautes = 0;

/**
 * `verdict` rend le grief, ou `null` si tout va bien. Il peut pousser des
 * remarques dans `notes` : elles sortent **après** la ligne du contrôle, sinon
 * elles se liraient comme un commentaire du contrôle précédent.
 */
function controle(intitule, verdict) {
  const notes = [];
  const probleme = verdict(notes);
  if (probleme) {
    echecs += 1;
    console.log(`  FAIL ${intitule}\n       ${probleme}`);
  } else {
    console.log(`  ok   ${intitule}`);
  }
  for (const note of notes) console.log(`       ${note}`);
}

function saut(intitule, pourquoi) {
  sautes += 1;
  console.log(`  --   ${intitule}\n       non contrôlé : ${pourquoi}`);
}

const methodes = lireMethodes(fs.readFileSync(preloadPath, 'utf8'));
const exportsAttendus = lireExports(fs.readFileSync(vraiRepoPath, 'utf8'));
const portees = lireMethodesPortees(fs.readFileSync(specPath, 'utf8'), methodes);

console.log(
  `références : ${methodes.length} méthodes dans preload.cjs, ` +
    `${exportsAttendus.length} exports dans repository.js, ` +
    `${portees.length} méthodes portées d'après la spec\n`,
);

console.log('shim');

let shim = null;
let erreurChargement = null;
if (!fs.existsSync(shimPath)) {
  erreurChargement = new Error(
    `absent : ${shimPath}\n       ` +
      "il est écrit en parallèle ; tant qu'il manque, il n'y a rien à contrôler",
  );
} else {
  try {
    shim = await chargerShim();
  } catch (erreur) {
    erreurChargement = erreur;
  }
}

controle('le shim se charge avec les modules Capacitor bouchonnés', () =>
  erreurChargement ? erreurChargement.message : null,
);

if (!shim) {
  saut('les quatre exports de repository.js sont là', 'le shim ne s’est pas chargé');
  saut('la surface est exactement celle de METHODS', 'le shim ne s’est pas chargé');
  saut('les méthodes portées ne lèvent pas `not-ported`', 'le shim ne s’est pas chargé');
  saut('`onDownloadsChanged` rend une fonction de désabonnement', 'le shim ne s’est pas chargé');
} else {
  controle('les quatre exports de repository.js sont là', (notes) => {
    const presents = Object.keys(shim);
    const absents = exportsAttendus.filter((nom) => !presents.includes(nom));
    if (absents.length) return `manquants : ${absents.join(', ')}`;
    // Un export en plus (une `RepositoryError` exportée, par exemple) ne casse
    // rien : les vues n'importent que les quatre. On le signale sans échouer.
    const surplus = presents.filter((nom) => !exportsAttendus.includes(nom));
    if (surplus.length) notes.push(`en plus, sans conséquence : ${surplus.join(', ')}`);
    return null;
  });

  controle('la surface est exactement celle de METHODS', () => {
    const depot = shim.repository;
    if (!depot || typeof depot !== 'object') return '`repository` n’est pas un objet';
    const exposees = Object.keys(depot).filter((nom) => typeof depot[nom] === 'function');
    const absentes = methodes.filter((nom) => typeof depot[nom] !== 'function');
    const surplus = exposees.filter((nom) => !methodes.includes(nom));
    const griefs = [];
    if (absentes.length) griefs.push(`${absentes.length} manquante(s) : ${absentes.join(', ')}`);
    if (surplus.length) griefs.push(`${surplus.length} en trop : ${surplus.join(', ')}`);
    return griefs.length ? griefs.join(' ; ') : null;
  });

  const verdicts = new Map();
  for (const nom of portees) {
    const fonction = shim.repository?.[nom];
    verdicts.set(nom, typeof fonction === 'function' ? await erreurDAppel(() => fonction()) : null);
  }

  controle('les méthodes portées ne lèvent pas `not-ported`', () => {
    if (!portees.length) return 'la spec n’annonce aucune méthode portée — tableau illisible ?';
    const fautives = portees.filter((nom) => estNonPortee(verdicts.get(nom)));
    return fautives.length
      ? `annoncées portées mais refusées : ${fautives.join(', ')}`
      : null;
  });

  controle('`onDownloadsChanged` rend une fonction de désabonnement', () => {
    if (typeof shim.onDownloadsChanged !== 'function') return 'export absent ou non appelable';
    try {
      const desabonner = shim.onDownloadsChanged(() => {});
      if (typeof desabonner !== 'function') return `rend ${typeof desabonner}, une fonction attendue`;
      desabonner();
      return null;
    } catch (erreur) {
      return `lève : ${erreur.message}`;
    }
  });
}

console.log('\nbases');

controle('les deux applications écrivent la même version de `user.sqlite`', () => {
  // Les deux implémentations portent le numéro en dur, chacune de son côté —
  // il n'y a pas de module partagé pour lui, et il n'y en aura pas : le mobile
  // ne peut pas importer le processus principal d'Electron. Ce qu'on peut
  // faire, c'est interdire la dérive.
  //
  // Ce qui arriverait sans ce contrôle : les deux clients peuvent partager une
  // racine de bibliothèque. Celui qui pose le plus petit `user_version` fait
  // rejouer à l'autre des migrations déjà faites, ou pire, le fait lire des
  // tables qu'il croit absentes.
  const bureau = /export const USER_DB_SCHEMA_VERSION = (\d+)/.exec(
    fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'src', 'main', 'app-database.js'), 'utf8'),
  );
  const mobile = /const VERSION_SCHEMA = (\d+)/.exec(
    fs.readFileSync(path.join(appDir, 'src', 'repo', 'utilisateur.js'), 'utf8'),
  );
  if (!bureau) return 'USER_DB_SCHEMA_VERSION introuvable dans app-database.js';
  if (!mobile) return 'VERSION_SCHEMA introuvable dans repo/utilisateur.js';
  return bureau[1] === mobile[1]
    ? null
    : `bureau ${bureau[1]}, mobile ${mobile[1]} — deux clients sur une même racine se marcheraient dessus`;
});

console.log('\nartefact');

controle('www/ n’est pas suivi par git', () => {
  const rappel =
    'Le versionner recréerait le miroir entretenu à la main que le projet a déjà payé trois fois.';

  // La propriété qui compte est « non suivi », et elle se lit dans l'index :
  // une règle `.gitignore` ne défait pas un `git add -f`. On la vérifie donc en
  // premier, sinon `check-ignore` — qui se tait sur les fichiers suivis —
  // rendrait un diagnostic à côté de la plaque.
  const suivis = spawnSync('git', ['ls-files', '--', wwwRelatif], { cwd: repoRoot, encoding: 'utf8' });
  if (suivis.error) return `git indisponible : ${suivis.error.message}`;
  const listes = String(suivis.stdout ?? '').trim();
  if (listes) {
    return `suivis par git :\n       ${listes.split('\n').join('\n       ')}\n       ${rappel}`;
  }

  // Et non suivi ne suffit pas : sans règle d'exclusion, le premier `git add .`
  // les ferait entrer.
  const ignore = spawnSync('git', ['check-ignore', '-q', '--', wwwRelatif], { cwd: repoRoot });
  if (ignore.error) return `git indisponible : ${ignore.error.message}`;
  return ignore.status === 0
    ? null
    : `\`git check-ignore ${wwwRelatif}\` rend ${ignore.status} : aucune règle ne l’exclut. ${rappel}`;
});

console.log(
  `\n${methodes.length} méthodes contrôlées — ` +
    (echecs ? `${echecs} ÉCHEC(S)` : 'tout passe') +
    (sautes ? `, ${sautes} contrôle(s) sautés` : ''),
);
process.exit(echecs ? 1 : 0);
