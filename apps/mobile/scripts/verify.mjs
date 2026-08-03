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

console.log('\ngraine');

/**
 * La graine de catalogue embarquée dans l'APK. Trois contrôles :
 *
 * 1. le planteur (`src/repo/graine.js`) est **éprouvé** avec des dépendances
 *    factices — c'est une fabrique sans aucun `import`, précisément pour ça ;
 * 2. il ne plante que si le catalogue est absent : la graine est figée à la
 *    date du build, le catalogue installé a pu être mis à jour depuis le
 *    bucket, et l'écraser ferait régresser le catalogue de l'utilisateur à
 *    chaque mise à jour de l'application ;
 * 3. le shim et `prepare-www.mjs` sont bien câblés — sans eux, le planteur
 *    est un module mort et l'APK repart sans catalogue.
 */
let creerPlanteurGraine = null;
let erreurGraine = null;
try {
  ({ creerPlanteurGraine } = await import(
    pathToFileURL(path.join(appDir, 'src', 'repo', 'graine.js')).href
  ));
} catch (erreur) {
  erreurGraine = erreur;
}

/** Un monde factice : journal des écritures, présence du catalogue simulée. */
function mondeGraine({ cataloguePresent }) {
  const operations = [];
  let lectures = 0;
  const planter = creerPlanteurGraine({
    RepositoryError: class extends Error {
      constructor(what, code, cause) {
        super(what);
        this.code = code;
        this.cause = cause;
      }
    },
    chrono: () => () => {},
    filesystem: () => ({
      writeFile: async ({ path: p }) => operations.push(['writeFile', p]),
      appendFile: async ({ path: p }) => operations.push(['appendFile', p]),
      rename: async ({ from, to }) => operations.push(['rename', from, to]),
      deleteFile: async ({ path: p }) => operations.push(['deleteFile', p]),
    }),
    sqlite: () => ({
      isNCDatabase: async () => ({ result: cataloguePresent }),
    }),
    decompressZstd: async (octets) => new Uint8Array(octets.length * 3),
    chargerGraine: async () => {
      lectures += 1;
      return new Uint8Array(1024);
    },
  });
  return { planter, operations, lectures: () => lectures };
}

let verdictPlantation = erreurGraine ? `repo/graine.js illisible : ${erreurGraine.message}` : null;
let verdictPresence = verdictPlantation;

if (creerPlanteurGraine) {
  // Premier lancement : catalogue absent, la graine doit s'installer — de
  // côté puis renommée, le `rename` en dernier geste, jamais d'écriture
  // directe dans la cible : une coupure laisserait un catalogue tronqué qui
  // s'ouvrirait sans broncher au démarrage suivant.
  try {
    const premier = mondeGraine({ cataloguePresent: false });
    const resultat = await premier.planter('/racine');
    const ops = premier.operations;
    const derniere = ops[ops.length - 1];
    if (resultat?.action !== 'planted') {
      verdictPlantation = `action « ${resultat?.action} », « planted » attendue`;
    } else if (!premier.lectures()) {
      verdictPlantation = 'la graine embarquée n’a jamais été lue';
    } else if (derniere?.[0] !== 'rename' || derniere[2] !== '/racine/catalog.sqlite') {
      verdictPlantation = `dernier geste « ${derniere?.join(' ')} », « rename -> /racine/catalog.sqlite » attendu`;
    } else if (
      ops.some(([op, p]) => (op === 'writeFile' || op === 'appendFile') && p === '/racine/catalog.sqlite')
    ) {
      verdictPlantation = 'écriture directe dans catalog.sqlite : une coupure laisserait un catalogue tronqué';
    }
  } catch (erreur) {
    verdictPlantation = `la plantation lève : ${erreur.message}`;
  }

  // Catalogue déjà installé : rien ne doit être lu ni écrit. C'est la règle
  // d'`AppDatabase.#plantSeed`, et elle n'est pas devinable — une graine plus
  // ancienne que le catalogue téléchargé l'écraserait en silence.
  try {
    const second = mondeGraine({ cataloguePresent: true });
    const resultat = await second.planter('/racine');
    if (resultat?.action !== 'present') {
      verdictPresence = `action « ${resultat?.action} », « present » attendue`;
    } else if (second.lectures()) {
      verdictPresence = 'la graine a été lue alors qu’un catalogue est installé';
    } else if (second.operations.length) {
      verdictPresence = `écritures inattendues : ${second.operations.map(([op]) => op).join(', ')}`;
    } else {
      verdictPresence = null;
    }
  } catch (erreur) {
    verdictPresence = `le cas « déjà installé » lève : ${erreur.message}`;
  }
}

controle('la graine se plante au premier lancement, de côté puis renommée', () => verdictPlantation);
controle('la graine ne se plante que si le catalogue est absent', () => verdictPresence);

controle('le shim plante la graine avant d’ouvrir le catalogue', () => {
  const source = fs.readFileSync(shimPath, 'utf8');
  if (!source.includes('creerPlanteurGraine')) return 'le shim n’assemble pas repo/graine.js';
  const plantation = source.indexOf('await planterGraine(');
  if (plantation < 0) return 'catalogue() ne plante jamais la graine';
  const ouverture = source.indexOf("fin('catalogue:ouverture'");
  if (ouverture >= 0 && plantation > ouverture) {
    return 'la graine se plante après l’ouverture du catalogue : trop tard';
  }
  return null;
});

controle('prepare-www embarque la graine depuis le cache data/', () => {
  const source = fs.readFileSync(path.join(scriptsDir, 'prepare-www.mjs'), 'utf8');
  const griefs = [];
  if (!source.includes('catalog.sqlite.zst')) griefs.push('la graine n’est jamais copiée vers www/');
  if (!source.includes('catalog-seed.json')) griefs.push('la description de la graine n’est pas embarquée');
  return griefs.length
    ? `${griefs.join(' ; ')} — www/ est effacé à chaque exécution, la graine doit être recopiée par prepare-www`
    : null;
});

console.log('\nretour matériel');

/**
 * Le geste retour d'Android. Sans écouteur, il retombe sur `history.back()` de
 * la WebView et emporte l'écran entier alors qu'un panneau est ouvert par
 * dessus — on ouvre le sommaire, on fait le geste pour le refermer, et l'on se
 * retrouve sur la fiche du livre.
 *
 * `brancherRetour` est une fabrique sans `import`, comme le planteur de graine :
 * elle s'éprouve donc entièrement ici, avec un `App` et un `document` factices,
 * sans appareil.
 */
let brancherRetour = null;
let erreurRetour = null;
try {
  ({ brancherRetour } = await import(
    pathToFileURL(path.join(appDir, 'src', 'repo', 'retour.js')).href
  ));
} catch (erreur) {
  erreurRetour = erreur;
}

/** Un monde factice : un `App` qui rend le geste, un `document` qui le refuse ou non. */
function mondeRetour({ consomme, entrees }) {
  const journal = [];
  let tirer = null;
  brancherRetour({
    App: { addListener: (_nom, fn) => ((tirer = fn), { remove: () => {} }) },
    document: {
      dispatchEvent: (evenement) => {
        journal.push(['dispatch', evenement.type, evenement.cancelable]);
        return !consomme;
      },
    },
    history: { length: entrees, back: () => journal.push(['back']) },
    quitter: () => journal.push(['quitter']),
  });
  return { tirer, journal };
}

controle('le geste retour ferme la couche du dessus avant de quitter', (notes) => {
  if (erreurRetour) return `repo/retour.js illisible : ${erreurRetour.message}`;
  if (typeof globalThis.CustomEvent !== 'function') {
    notes.push('CustomEvent absent de ce Node : contrôle sauté');
    return null;
  }

  const ferme = mondeRetour({ consomme: true, entrees: 5 });
  if (!ferme.tirer) return 'aucun écouteur `backButton` posé';
  ferme.tirer();
  if (ferme.journal.some(([quoi]) => quoi === 'back' || quoi === 'quitter')) {
    return 'une couche a consommé le geste et l’écran a quand même été quitté';
  }
  const [[, type, annulable] = []] = ferme.journal;
  if (type !== 'beyt:back') return `évènement émis « ${type} » au lieu de « beyt:back »`;
  if (!annulable) return 'l’évènement n’est pas annulable : personne ne peut le consommer';

  const remonte = mondeRetour({ consomme: false, entrees: 5 });
  remonte.tirer();
  if (!remonte.journal.some(([quoi]) => quoi === 'back')) {
    return 'rien n’était ouvert et le geste n’a pas remonté d’un écran';
  }

  // À la racine il n'y a plus d'écran à remonter : le geste sort. Quitter
  // depuis n'importe où renverrait un lecteur au bureau d'Android au lieu de sa
  // bibliothèque.
  const racine = mondeRetour({ consomme: false, entrees: 1 });
  racine.tirer();
  if (!racine.journal.some(([quoi]) => quoi === 'quitter')) {
    return 'à la racine, le geste ne quitte pas l’application';
  }
  return null;
});

controle('sans greffon, brancherRetour ne branche rien', () => {
  if (erreurRetour) return `repo/retour.js illisible : ${erreurRetour.message}`;
  // Sous Electron et dans cette vérification, `Capacitor.Plugins.App` est
  // absent : le module doit se charger sans rien faire, pas lever.
  const debrancher = brancherRetour({ App: null, document: null });
  return typeof debrancher === 'function' ? null : 'aucune fonction de débranchement rendue';
});

controle('le nom de l’évènement est le même des deux côtés', () => {
  const rendu = path.join(repoRoot, 'apps', 'desktop', 'src', 'renderer', 'js', 'back-intent.js');
  if (!fs.existsSync(rendu)) return `${rendu} absent : le rendu n’a pas de registre de retour`;
  const cite = (fichier) => {
    const trouve = fs.readFileSync(fichier, 'utf8').match(/BACK_INTENT\s*=\s*'([^']+)'/);
    return trouve?.[1] ?? null;
  };
  const cote = cite(rendu);
  const mobile = cite(path.join(appDir, 'src', 'repo', 'retour.js'));
  if (!cote || !mobile) return 'BACK_INTENT introuvable dans l’un des deux fichiers';
  return cote === mobile
    ? null
    : `« ${cote} » côté rendu contre « ${mobile} » côté mobile : le geste ne sera jamais entendu`;
});

controle('le shim branche le retour sur le greffon', () => {
  const source = fs.readFileSync(shimPath, 'utf8');
  if (!source.includes('brancherRetour(')) return 'le shim n’assemble pas repo/retour.js';
  // Le greffon se prend sur `globalThis.Capacitor.Plugins`, comme les deux
  // autres : le rendu se sert sans bundler, et `import '@capacitor/app'` serait
  // un spécificateur nu qu'aucun navigateur ne résout.
  if (!/pont\(\)\?\.App/.test(source)) return 'le greffon App n’est pas pris sur le pont Capacitor';
  return null;
});

controle('@capacitor/app est déclaré', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  return manifeste.dependencies?.['@capacitor/app']
    ? null
    : 'sans la dépendance, `cap sync` n’embarque pas le greffon natif et l’évènement n’arrive jamais';
});

/**
 * L'identité de l'APK, telle que « عن التطبيق » la montre.
 *
 * Le rendu est le même des deux côtés : c'est donc au dépôt de porter les trois
 * mêmes champs — version, plateforme, moteur — sous les mêmes noms. Un `null`
 * de plus côté mobile ne casserait rien à l'écran, il y laisserait juste un
 * trou silencieux, et c'est exactement le genre de dérive que cette
 * vérification existe pour attraper.
 *
 * `creerMethodesCatalogue` est une fabrique sans `import`, comme le planteur et
 * le retour : un `ctx` factice suffit à l'éprouver hors appareil.
 */
let creerMethodesCatalogue = null;
let erreurCatalogue = null;
try {
  ({ creerMethodesCatalogue } = await import(
    pathToFileURL(path.join(appDir, 'src', 'repo', 'catalogue-plus.js')).href
  ));
} catch (erreur) {
  erreurCatalogue = erreur;
}

/** Un `ctx` factice : juste ce que `getAbout` traverse, et rien d'autre. */
const mondeAbout = (App) =>
  creerMethodesCatalogue({
    garde: (_quoi, fn) => fn(),
    catalogue: async () => '/data/data/app/files/beyt/catalog.sqlite',
    livreInstalle: async () => false,
    first: async () => ({ catalog_version: 2, schema_version: 2 }),
    all: async () => [],
    allUser: async () => [],
    manifeste: async () => null,
    pont: () => (App ? { App } : null),
  }).getAbout();

// `controle` n'attend pas : une fonction `async` lui rendrait une promesse,
// qu'il afficherait telle quelle en échec. Les deux lectures se font donc ici,
// et les contrôles ne font que lire leur résultat.
let avecGreffon = null;
let sansGreffon = null;
if (!erreurCatalogue) {
  try {
    avecGreffon = await mondeAbout({
      getInfo: async () => ({ name: 'Beyt El Hikma', version: '0.3.1', build: '12' }),
    });
    sansGreffon = await mondeAbout(null);
  } catch (erreur) {
    erreurCatalogue = erreur;
  }
}

controle('« عن التطبيق » porte la version de l’APK, pas celle du dépôt', () => {
  if (erreurCatalogue) return `repo/catalogue-plus.js illisible : ${erreurCatalogue.message}`;
  // `versionName` et `versionCode` ensemble : deux APK peuvent porter le même
  // « 0.3.1 » sans être le même binaire.
  if (avecGreffon.appVersion !== '0.3.1 (12)') {
    return `version rendue « ${avecGreffon.appVersion} » au lieu de « 0.3.1 (12) »`;
  }
  if (avecGreffon.platform !== 'android') {
    return `plateforme « ${avecGreffon.platform} » au lieu d’« android »`;
  }
  if (!('runtime' in avecGreffon)) {
    return 'le champ `runtime` manque : l’écran le montre des deux côtés';
  }
  return null;
});

controle('sans greffon, la version se tait au lieu de mentir', () => {
  if (erreurCatalogue) return `repo/catalogue-plus.js illisible : ${erreurCatalogue.message}`;
  // Pont pas encore posé, ou greffon absent : `null`, jamais une version
  // inventée — c'est cette ligne-là qu'on recopie dans un rapport de bug.
  if (sansGreffon.appVersion !== null) {
    return `version rendue « ${sansGreffon.appVersion} » sans greffon`;
  }
  if (sansGreffon.platform !== 'android') return 'la plateforme ne dépend pas du greffon';
  return null;
});

/**
 * La version, et le fait qu'il n'y en ait qu'une.
 *
 * Les deux applications ont dérivé — 0.5.0 au bureau, 0.3.1 sur Android — et
 * l'APK, lui, annonçait « 1.0 (1) » : le gabarit de `npx cap add android`, que
 * personne ne touchait puisque `android/` est engendré et ignoré par git. Trois
 * numéros pour un seul logiciel, dont celui que l'écran montre était le faux.
 */
controle('les deux applications annoncent la même version', () => {
  const lire = (...morceaux) =>
    JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', ...morceaux), 'utf8')).version;
  const bureau = lire('desktop', 'package.json');
  const mobile = lire('mobile', 'package.json');
  return bureau === mobile
    ? null
    : `le bureau est en ${bureau} et le mobile en ${mobile} : « عن التطبيق » ne dit pas la même chose des deux côtés`;
});

controle('prepare-android pose la version dans le projet engendré', () => {
  const source = fs.readFileSync(path.join(appDir, 'scripts', 'prepare-android.mjs'), 'utf8');
  // Le gabarit de Capacitor écrit `versionName "1.0"` une fois pour toutes :
  // sans réécriture, l'écran des informations annonce un binaire inexistant.
  if (!/versionName\\s\+"/.test(source)) return 'le script ne réécrit pas `versionName`';
  if (!source.includes('codeDeVersion')) return 'le script ne dérive pas de `versionCode`';
  if (!source.includes('manifestePath')) return 'la version ne vient pas de package.json';

  // Là où le projet natif existe — sur la machine de développement, pas en CI —
  // on relit ce qui a été posé plutôt que de croire le script sur parole.
  const gradle = path.join(appDir, 'android', 'app', 'build.gradle');
  if (!fs.existsSync(gradle)) return null;
  const attendue = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8')).version;
  const posee = fs.readFileSync(gradle, 'utf8').match(/versionName\s+"([^"]*)"/)?.[1] ?? null;
  return posee === attendue
    ? null
    : `app/build.gradle porte « ${posee} » au lieu de « ${attendue} » — lancez \`npm run prepare:android\``;
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
  //
  // La question porte sur un fichier **dans** `www/`, jamais sur le dossier :
  // la règle `www/` ne vise que des répertoires, et `check-ignore` interrogé
  // sur un chemin qui n'existe pas encore ne peut pas savoir que c'en est un.
  // Le contrôle échouait donc sur tout dépôt fraîchement cloné — c'est-à-dire
  // en CI, précisément là où il doit servir. Le chemin interrogé est celui que
  // `git add .` verrait : un fichier engendré.
  const sonde = `${wwwRelatif}/index.html`;
  const ignore = spawnSync('git', ['check-ignore', '-q', '--', sonde], { cwd: repoRoot });
  if (ignore.error) return `git indisponible : ${ignore.error.message}`;
  return ignore.status === 0
    ? null
    : `\`git check-ignore ${sonde}\` rend ${ignore.status} : aucune règle ne l’exclut. ${rappel}`;
});

controle('la graine (data/) n’est pas suivie par git', () => {
  // Même méthode que www/ : l'index d'abord, la règle ensuite, interrogée sur
  // un chemin **dans** le dossier — la règle `data/` ne vise que des
  // répertoires, et `check-ignore` sur un chemin encore absent ne peut pas
  // deviner que c'en est un. La graine est un artefact du build : la
  // versionner ferait entrer plusieurs Mo de binaire dans l'historique à
  // chaque publication de catalogue.
  const dataRelatif = 'apps/mobile/data';
  const suivis = spawnSync('git', ['ls-files', '--', dataRelatif], { cwd: repoRoot, encoding: 'utf8' });
  if (suivis.error) return `git indisponible : ${suivis.error.message}`;
  const listes = String(suivis.stdout ?? '').trim();
  if (listes) {
    return `suivis par git :\n       ${listes.split('\n').join('\n       ')}`;
  }
  const sonde = `${dataRelatif}/catalog.sqlite.zst`;
  const ignore = spawnSync('git', ['check-ignore', '-q', '--', sonde], { cwd: repoRoot });
  if (ignore.error) return `git indisponible : ${ignore.error.message}`;
  return ignore.status === 0
    ? null
    : `\`git check-ignore ${sonde}\` rend ${ignore.status} : aucune règle ne l’exclut de git`;
});

// ---------------------------------------------------------------------------
// Écran de démarrage
// ---------------------------------------------------------------------------
//
// Rien de tout ceci ne demande un appareil, et c'est le point : `android/` est
// engendré, donc absent en CI, et les ressources qui l'alimentent sont les
// seules qu'on puisse contrôler. Une icône qui déborde de la ligne de garde ne
// casse aucun build — elle se voit rognée, une fois, sur un téléphone.

console.log('\nécran de démarrage et icône du lanceur');

const splashRes = path.join(appDir, 'resources', 'android', 'res');
const lire = (...morceaux) => {
  const chemin = path.join(splashRes, ...morceaux);
  return fs.existsSync(chemin) ? fs.readFileSync(chemin, 'utf8') : null;
};

const vecteur = lire('drawable', 'splash_icon.xml');

controle('les ressources engendrées sont là', () => {
  const attendus = [
    ['drawable', 'splash_icon.xml'],
    ['drawable-v31', 'splash_reveal.xml'],
    ['drawable', 'splash_reveal.xml'],
    ['drawable', 'ic_launcher_foreground.xml'],
    ['mipmap-anydpi-v26', 'ic_launcher.xml'],
    ['mipmap-anydpi-v26', 'ic_launcher_round.xml'],
    ['values', 'splash.xml'],
    ['values', 'ic_launcher_background.xml'],
    ['animator', 'splash_apparait.xml'],
    ['animator', 'splash_grandit.xml'],
  ];
  const manquants = attendus
    .filter((morceaux) => !fs.existsSync(path.join(splashRes, ...morceaux)))
    .map((morceaux) => morceaux.join('/'));
  return manquants.length
    ? `absents : ${manquants.join(', ')} — lancez \`python tools/gen_brand_assets.py\``
    : null;
});

controle('resources/android/ peut entrer dans git', () => {
  // Le contraire de `www/` et de `data/`, et pour la même raison retournée :
  // ces ressources sont la **source**, et le projet natif qui les consomme est
  // engendré. Ignorées, elles disparaissent au clone et l'écran de démarrage
  // redevient celui de Capacitor — sans que rien n'échoue.
  //
  // Le défaut est arrivé : la règle `android/` du `.gitignore`, sans barre
  // oblique de tête, vise tout dossier de ce nom à n'importe quelle
  // profondeur. Elle avalait `resources/android/`.
  const sonde = 'apps/mobile/resources/android/res/values/splash.xml';
  const ignore = spawnSync('git', ['check-ignore', '-v', '--', sonde], { cwd: repoRoot, encoding: 'utf8' });
  if (ignore.error) return `git indisponible : ${ignore.error.message}`;
  return ignore.status === 0
    ? `une règle l’exclut : ${String(ignore.stdout ?? '').trim()}\n       ` +
        'ancrez-la (`/android/`) pour qu’elle ne vise que le projet natif'
    : null;
});

// Les deux dessins, avec la garde que leur impose le système. Elles ne sont
// **pas** la même : 192 dp sur 288 pour l'écran de démarrage, 66 sur 108 pour
// le lanceur, dont le masque est bien plus serré. Confondre les deux, c'est
// livrer une icône rognée.
const GARDES = [
  ['drawable/splash_icon.xml', 'l’écran de démarrage', 192, 288],
  ['drawable/ic_launcher_foreground.xml', 'l’icône du lanceur', 66, 108],
];

for (const [fichier, quoi, garde, toileAttendue] of GARDES) {
  controle(`le dessin de ${quoi} tient dans sa ligne de garde`, (notes) => {
    const xml = lire(...fichier.split('/'));
    if (!xml) return `${fichier} est absent — lancez \`python tools/gen_brand_assets.py\``;

    const toile = Number(/android:viewportWidth="([\d.]+)"/.exec(xml)?.[1]);
    if (!toile) return 'aucun `viewportWidth` : le fichier n’est pas un <vector>';
    if (toile !== toileAttendue) {
      return `toile de ${toile}, attendue ${toileAttendue} : la garde de ${garde} ne veut plus rien dire`;
    }

    // Le masque d'Android est un **disque**. Un dessin calé sur le carré passe
    // pour correct et se fait rogner : c'est ce qui arrivait à la pointe du
    // mihrab.
    const rayonPermis = garde / 2;
    const centre = toile / 2;

    let rayonMax = 0;
    for (const [, donnees] of xml.matchAll(/android:pathData="([^"]*)"/g)) {
      const nombres = donnees.match(/-?\d*\.?\d+/g) ?? [];
      for (let i = 0; i + 1 < nombres.length; i += 2) {
        rayonMax = Math.max(
          rayonMax,
          Math.hypot(Number(nombres[i]) - centre, Number(nombres[i + 1]) - centre),
        );
      }
    }

    // Les points de contrôle d'une cubique sortent de la courbe : ce rayon
    // majore le vrai. Un contrôle qui majore ne peut pas laisser passer un
    // débordement, et c'est le sens qui compte ici.
    notes.push(
      `rayon ${rayonMax.toFixed(1)} sur ${rayonPermis} permis (majoré par les points de contrôle)`,
    );
    return rayonMax > rayonPermis * 1.1
      ? `le tracé sort du disque de ${rayonPermis} : le masque le rognerait`
      : null;
  });
}

controle('les icônes héritées sont là, aux cinq densités', () => {
  // Android 7 et 8.0 ignorent l'icône adaptative. Sans ces PNG, ils
  // retomberaient sur celle de Capacitor — sur les seules versions que
  // personne ne teste.
  const tailles = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  const griefs = [];
  for (const densite of Object.keys(tailles)) {
    for (const nom of ['ic_launcher.png', 'ic_launcher_round.png']) {
      if (!fs.existsSync(path.join(splashRes, `mipmap-${densite}`, nom))) {
        griefs.push(`mipmap-${densite}/${nom}`);
      }
    }
  }
  return griefs.length ? `absents : ${griefs.join(', ')}` : null;
});

controle('l’icône adaptative cite des ressources qui existent', () => {
  const griefs = [];
  for (const nom of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const xml = lire('mipmap-anydpi-v26', nom);
    if (!xml) {
      griefs.push(`mipmap-anydpi-v26/${nom} est absent`);
      continue;
    }
    for (const [, type, ressource] of xml.matchAll(/android:drawable="@(drawable|color|mipmap)\/(\w+)"/g)) {
      const trouve =
        type === 'color'
          ? (lire('values', 'ic_launcher_background.xml') ?? '').includes(`name="${ressource}"`)
          : fs.existsSync(path.join(splashRes, type, `${ressource}.xml`));
      if (!trouve) griefs.push(`${nom} : @${type}/${ressource} introuvable dans resources/android/`);
    }
  }
  return griefs.length ? griefs.join(' ; ') : null;
});

controle('le fond de l’icône et celui du démarrage sont la même couleur', () => {
  // L'icône du lanceur est le premier écran de l'application, l'écran de
  // démarrage le second. Deux crèmes différents à une fraction de seconde
  // d'intervalle se lisent comme un clignotement.
  const teinte = (fichier, nom) =>
    new RegExp(`<color name="${nom}">(#[0-9A-Fa-f]{6,8})<`).exec(lire('values', fichier) ?? '')?.[1];
  const icone = teinte('ic_launcher_background.xml', 'ic_launcher_background');
  const demarrage = teinte('splash.xml', 'splash_fond');
  if (!icone || !demarrage) return 'une des deux couleurs est absente de values/';
  return icone.toUpperCase() === demarrage.toUpperCase()
    ? null
    : `icône ${icone} contre démarrage ${demarrage} : le passage clignoterait`;
});

controle('l’animation vise des noms que le dessin porte', () => {
  const anime = lire('drawable-v31', 'splash_reveal.xml');
  if (!anime || !vecteur) return 'drawable-v31/splash_reveal.xml ou son dessin est absent';

  const poses = new Set([...vecteur.matchAll(/android:name="([^"]+)"/g)].map((m) => m[1]));
  const vises = [...anime.matchAll(/<target\s+android:name="([^"]+)"/g)].map((m) => m[1]);
  if (!vises.length) return 'aucune <target> : l’animation ne ferait rien';

  // Un `<target>` qui ne trouve pas son nom ne lève rien : l'animation est
  // simplement sautée, et l'icône paraît d'un coup. Le défaut ne se voit que
  // sur un appareil, une fois, au premier lancement.
  const orphelins = vises.filter((nom) => !poses.has(nom));
  return orphelins.length
    ? `${orphelins.join(', ')} : aucun élément du <vector> ne porte ce nom`
    : null;
});

controle('les animateurs cités existent', () => {
  const anime = lire('drawable-v31', 'splash_reveal.xml');
  if (!anime) return 'drawable-v31/splash_reveal.xml est absent';
  const cites = [...anime.matchAll(/android:animation="@animator\/([^"]+)"/g)].map((m) => m[1]);
  const absents = cites.filter((nom) => !fs.existsSync(path.join(splashRes, 'animator', `${nom}.xml`)));
  return absents.length ? `@animator/${absents.join(', @animator/')} : fichier absent` : null;
});

controle('aucun commentaire XML ne porte deux tirets', () => {
  // AAPT refuse `--` dans un commentaire, et le message qu'il rend ne dit pas
  // quel fichier de la source en est la cause : il nomme la copie posée dans
  // `android/`, que personne n'édite. Le contrôle le dit ici.
  const coupables = [];
  const parcourir = (dossier) => {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) parcourir(chemin);
      else if (entree.name.endsWith('.xml')) {
        for (const [, corps] of fs.readFileSync(chemin, 'utf8').matchAll(/<!--([\s\S]*?)-->/g)) {
          if (corps.includes('--')) coupables.push(path.relative(appDir, chemin));
        }
      }
    }
  };
  if (!fs.existsSync(splashRes)) return 'resources/android/res/ est absent';
  parcourir(splashRes);
  return coupables.length ? `${[...new Set(coupables)].join(', ')} — AAPT refuse la séquence` : null;
});

controle('le thème posé cite des ressources qui existent', () => {
  const source = fs.readFileSync(path.join(scriptsDir, 'prepare-android.mjs'), 'utf8');
  const bloc = /const THEME_LANCEMENT = `([\s\S]*?)`;/.exec(source);
  if (!bloc) return 'prepare-android.mjs : `THEME_LANCEMENT` introuvable';

  // Le thème est un littéral du script, pas un fichier : sans ce contrôle,
  // renommer `splash_reveal` dans le générateur casserait le build Android
  // sans que rien, côté source, ne l'ait signalé.
  const manquants = [];
  for (const [, type, nom] of bloc[1].matchAll(/@(drawable|color|animator)\/([\w]+)/g)) {
    const trouve =
      type === 'color'
        ? (lire('values', 'splash.xml') ?? '').includes(`name="${nom}"`)
        : fs.existsSync(path.join(splashRes, type, `${nom}.xml`));
    if (!trouve) manquants.push(`@${type}/${nom}`);
  }
  return manquants.length ? `${manquants.join(', ')} : rien ne les définit dans resources/android/` : null;
});

controle('`npm run sync` pose l’écran de démarrage', () => {
  const manifeste = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  // `android/` est engendré : une chaîne de build qui oublie ce script rend
  // toutes les ressources ci-dessus décoratives.
  // Les deux formes se valent : `npm run prepare:android` ou l'appel direct au
  // fichier. Exiger l'une des deux ferait échouer le contrôle sur une chaîne
  // parfaitement correcte.
  const oublieux = ['sync', 'android:release'].filter(
    (nom) => !/prepare[-:]android/.test(String(manifeste.scripts?.[nom] ?? '')),
  );
  return oublieux.length
    ? `${oublieux.join(', ')} n’appelle pas prepare-android.mjs : le splash resterait celui de Capacitor`
    : null;
});

console.log(
  `\n${methodes.length} méthodes contrôlées — ` +
    (echecs ? `${echecs} ÉCHEC(S)` : 'tout passe') +
    (sautes ? `, ${sautes} contrôle(s) sautés` : ''),
);
process.exit(echecs ? 1 : 0);
