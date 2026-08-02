#!/usr/bin/env node
/**
 * Régénère `www/` depuis `apps/desktop/src/renderer/`.
 *
 *   node scripts/prepare-www.mjs
 *
 * Pourquoi un script et pas une copie dans le dépôt : `www/` est un **artefact**,
 * pas un miroir entretenu. Le projet a déjà payé trois fois le prix d'une copie
 * tenue à la main — le thème `sepia` que les réglages proposaient sans qu'aucune
 * règle CSS ne le lise, la liste des polices déclarée trois d'un côté et deux de
 * l'autre, et `MIRROR_DIRS`. Une copie régénérée à chaque `cap sync` ne peut pas
 * dériver : la seule façon de la produire est de relire la source.
 *
 * Le script est donc **idempotent par construction** : il efface `www/` et le
 * refait entièrement à partir de la source. Deux exécutions de suite donnent le
 * même arbre, et modifier `www/` à la main n'a aucun effet durable — ce qui est
 * exactement la propriété recherchée.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptsDir, '..');
const repoRoot = path.resolve(appDir, '..', '..');

const rendererDir = path.join(repoRoot, 'apps', 'desktop', 'src', 'renderer');
const sharedDir = path.join(repoRoot, 'apps', 'desktop', 'src', 'shared');
const wwwDir = path.join(appDir, 'www');
const shimSource = path.join(appDir, 'src', 'repository.capacitor.js');
const probeSource = path.join(appDir, 'src', 'probe.js');

/**
 * La sonde est un **instrument**, pas une fonctionnalité : elle affiche les
 * temps relevés sur l'appareil pour que l'exemple prouve ce qu'il avance. Un
 * build de release n'a rien à prouver, et un panneau de mesures posé sur
 * l'écran d'un lecteur est du bruit — c'est d'ailleurs le seul signe visible
 * qui distingue les deux montages.
 *
 * `www/` est effacé et refait à chaque exécution : ne pas la copier suffit,
 * aucun reste d'un passage précédent ne survit.
 */
const sansSonde = process.argv.includes('--sans-sonde');

// ---------------------------------------------------------------------------
// CSP : ce que Capacitor réclame, et rien de plus
// ---------------------------------------------------------------------------

/**
 * Le CSP du rendu est `default-src 'none'` avec quatre ouvertures nommées. La
 * question n'est pas « qu'est-ce qui pourrait servir » mais « qu'est-ce qui
 * casse sous Capacitor ». Réponse, après lecture du plugin Android installé
 * (`node_modules/@capacitor/android/.../Bridge.java`) :
 *
 * - `script-src 'self'` — **inchangée**. Sous Capacitor la page est servie
 *   depuis `https://localhost`, donc nos modules sont bien `'self'`. Le pont
 *   natif, lui, n'est pas un script de la page : `Bridge.loadWebView()` le pose
 *   par `WebViewCompat.addDocumentStartJavaScript()` quand la WebView le
 *   supporte (Android WebView ≥ 83), injection hors document que le CSP ne
 *   gouverne pas. Sur une WebView plus ancienne, le repli `JSInjector` insère un
 *   `<script>` en ligne juste après `<head>` — donc **avant** ce `<meta>`, qui ne
 *   s'applique qu'à partir du point où il est analysé. Dans les deux cas
 *   `'unsafe-inline'` serait inutile, et l'ajouter reviendrait à ouvrir toute la
 *   page pour un script que le moteur exécute déjà.
 * - `default-src 'none'` — **inchangée**. Elle couvre `connect-src`, et rien
 *   dans le rendu ne fait de `fetch`/XHR (vérifié : aucune occurrence hors des
 *   `placeholder` de `views/settings.js`). Le pont Capacitor passe par
 *   `@JavascriptInterface` sur Android, pas par le réseau ; les plugins SQLite
 *   et Filesystem sont natifs. Ouvrir `connect-src` n'achèterait rien.
 * - `style-src 'self'` — **inchangée**. `user-fonts.js` pose ses règles dans une
 *   `CSSStyleSheet` construite, qui ne relève pas de `style-src`.
 * - `img-src 'self' data:` — **inchangée**. Les images de marque sont des
 *   fichiers du même dossier.
 * - `font-src` — **modifiée** : `userfont:` retiré. Voir la règle ci-dessous.
 */
const REGLES_CSP = [
  {
    directive: 'font-src',
    // `userfont:` est un protocole enregistré par le processus principal
    // d'Electron (`src/main/font-installer.js`) pour servir `userData/fonts/`.
    // Hors d'Electron il n'existe pas, et les trois méthodes qui l'alimentent
    // — `installFont`, `listFonts`, `removeFont` — ne sont pas portées par le
    // spike : `user-fonts.js` retombe sur `loaded = []` et aucune règle
    // `@font-face` en `userfont:` n'est jamais écrite. Le laisser serait
    // inoffensif mais mensonger : un CSP énumère ce que la page a le droit de
    // charger, et cette page-là n'a aucun moyen de charger ça.
    raison: "userfont: n'existe que dans Electron ; les fichiers déposés passent par convertFileSrc",
    appliquer: (sources) => sources.filter((source) => source !== 'userfont:'),
  },
  {
    directive: 'connect-src',
    ajouterSiAbsente: true,
    // Trois hôtes, trois rôles, et rien d'autre. `default-src 'none'` couvre
    // `connect-src` et interdit donc tout `fetch` : sans cette directive, ni
    // les livres ni les polices ne peuvent être téléchargés.
    //
    // Le bucket est celui de `DEFAULT_BASE_URL`. Conséquence à connaître :
    // changer `distribution.base_url` vers un autre hôte depuis les réglages
    // **ne marchera pas** — un CSP est figé au chargement du document, il ne
    // suit pas un réglage. Le portage réel devra soit énumérer les hôtes
    // permis, soit passer les téléchargements côté natif, où le CSP de la page
    // ne s'applique pas.
    raison:
      'le bucket de distribution et les deux hôtes de Google Fonts ; sans cela aucun fetch ne part',
    appliquer: () => [
      "'self'",
      'https://beytelhima-library.s3.eu-west-1.amazonaws.com',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
    ],
  },
];

// ---------------------------------------------------------------------------
// Copie
// ---------------------------------------------------------------------------

/** Copie récursive qui compte : `cpSync` ne rend rien à afficher. */
function copierDossier(source, cible) {
  fs.mkdirSync(cible, { recursive: true });
  let copies = 0;
  for (const entree of fs.readdirSync(source, { withFileTypes: true })) {
    const depuis = path.join(source, entree.name);
    const vers = path.join(cible, entree.name);
    if (entree.isDirectory()) copies += copierDossier(depuis, vers);
    else {
      fs.copyFileSync(depuis, vers);
      copies += 1;
    }
  }
  return copies;
}

// ---------------------------------------------------------------------------
// Transformations de `index.html`
// ---------------------------------------------------------------------------

const ANCRE_APP = '<script type="module" src="js/app.js"></script>';
const BALISE_SONDE = '<script type="module" src="js/probe.js"></script>';

/**
 * Pose la sonde **avant** `app.js`. Les modules s'exécutent dans l'ordre du
 * document : la sonde doit donc précéder l'application, sinon elle mesurerait
 * un démarrage déjà fait.
 */
function injecterSonde(html) {
  if (html.includes(BALISE_SONDE)) return { html, injecte: false };
  const occurrences = html.split(ANCRE_APP).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `index.html : ${occurrences} occurrence(s) de « ${ANCRE_APP} », une seule attendue — ` +
        "l'entrée du rendu a changé, la sonde ne sait plus où se poser",
    );
  }
  const index = html.indexOf(ANCRE_APP);
  const debutLigne = html.lastIndexOf('\n', index) + 1;
  const indentation = html.slice(debutLigne, index);
  const commentaire =
    '<!-- Sonde du spike Capacitor : elle relève des chiffres (ouverture des\n' +
    `${indentation}     bases, FTS5, première requête) et doit exister avant que\n` +
    `${indentation}     l'application ne mesure quoi que ce soit. -->`;
  return {
    html: html.slice(0, index) + commentaire + '\n' + indentation + BALISE_SONDE + '\n' + indentation + html.slice(index),
    injecte: true,
  };
}

/**
 * Pose la balise `viewport`, que le rendu n'a pas.
 *
 * Electron n'en a jamais eu besoin : sa fenêtre donne une largeur CSS égale à
 * sa largeur réelle. Un WebView Android, lui, applique **sa** largeur par
 * défaut — mesurée à 1028 px CSS sur un téléphone de 1221 px physiques.
 *
 * La conséquence n'a rien de cosmétique, et ne ressemble pas à un problème de
 * balise manquante : à 1028 px, les points de rupture **bureau** s'activent.
 * La colonne latérale se voit réserver 621 px alors qu'une autre règle la
 * masque, il ne reste que 407 px de contenu poussés sur le côté, et la fiche
 * d'un livre s'affiche entièrement blanche. Les facettes d'`/explore`
 * mangeaient l'écran pour la même raison.
 *
 * `viewport-fit=cover` en plus : sans lui, la barre de navigation basse se
 * pose sous l'encoche et sous la barre gestuelle du système.
 */
// `minimum-scale=1` n'est pas un détail. Sans lui, le WebView Android
// « rétrécit pour faire tenir » dès qu'un élément déborde un instant, et ne
// revient jamais : le viewport passait de 411 à 569 px sur `/settings` et à
// 1028 px sur la fiche d'un livre. Or à 1028 px les points de rupture bureau
// s'activent, la colonne latérale réserve sa place tout en étant masquée, et
// la page paraît blanche. Le remède masquait donc la cause. Interdire le
// dézoom rend le débordement visible — c'est-à-dire réparable.
const BALISE_VIEWPORT =
  '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, viewport-fit=cover" />';

function injecterViewport(html) {
  if (/<meta\s+name="viewport"/i.test(html)) return { html, injecte: false };
  const ancre = /(<meta\s+charset="[^"]*"\s*\/?>)/i.exec(html);
  if (!ancre) throw new Error('index.html : aucun <meta charset> où accrocher le viewport');
  return {
    html: html.replace(ancre[1], `${ancre[1]}\n    ${BALISE_VIEWPORT}`),
    injecte: true,
  };
}

/** Applique `REGLES_CSP` au `<meta http-equiv="Content-Security-Policy">`. */
function ajusterCsp(html) {
  const motif = /(<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?content=")([^"]*)(")/;
  const trouve = motif.exec(html);
  if (!trouve) throw new Error('index.html : aucun <meta> Content-Security-Policy trouvé');

  const directives = trouve[2]
    .split(';')
    .map((morceau) => morceau.trim())
    .filter(Boolean)
    .map((morceau) => {
      const [nom, ...sources] = morceau.split(/\s+/);
      return { nom, sources };
    });

  const changements = [];
  for (const regle of REGLES_CSP) {
    let cible = directives.find((directive) => directive.nom === regle.directive);
    if (!cible && regle.ajouterSiAbsente) {
      // `connect-src` n'existe pas dans le CSP du rendu : il est couvert par
      // `default-src 'none'`, qui interdit donc tout `fetch`. Une directive
      // ajoutée est un ajout de droit — elle porte sa raison, comme les autres.
      cible = { nom: regle.directive, sources: [] };
      directives.push(cible);
    }
    if (!cible) continue;
    const avant = cible.sources.join(' ');
    const apres = regle.appliquer(cible.sources);
    if (apres.join(' ') === avant) continue;
    cible.sources = apres;
    changements.push({ directive: regle.directive, avant, apres: apres.join(' '), raison: regle.raison });
  }

  const contenu =
    directives.map((directive) => [directive.nom, ...directive.sources].join(' ')).join('; ') + ';';
  return {
    html: html.replace(motif, `$1${contenu}$3`),
    changements,
    inchangees: directives
      .filter((directive) => !changements.some((c) => c.directive === directive.nom))
      .map((directive) => directive.nom),
  };
}

// ---------------------------------------------------------------------------
// Garde-fou : le rendu n'a pas de bundler
// ---------------------------------------------------------------------------

/**
 * Relève les spécificateurs nus (`@capacitor/core`, `lodash`, …) d'un module.
 *
 * Ce n'est pas une lubie de style : le rendu se sert **tel quel**, en
 * `<script type="module">`, et `cap sync` ne fait que recopier `www/`. Un
 * navigateur ne sait pas résoudre un spécificateur nu — sans bundler ni carte
 * d'imports, `import { CapacitorSQLite } from '@capacitor-community/sqlite'`
 * échoue au chargement et l'écran reste blanc. On avertit sans échouer : c'est
 * une décision qui appartient à l'auteur du shim, pas à ce script.
 */
function specificateursNus(source) {
  const trouves = new Set();
  for (const motif of [/from\s*['"]([^'"]+)['"]/g, /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g]) {
    for (const [, specificateur] of source.matchAll(motif)) {
      if (specificateur.startsWith('.') || specificateur.startsWith('/')) continue;
      if (specificateur.includes(':')) continue; // schéma explicite : assumé
      trouves.add(specificateur);
    }
  }
  return [...trouves];
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

/**
 * Tout est vérifié **avant** d'effacer `www/`. Sortir en erreur à mi-parcours
 * laisserait un `www/` amputé qui se synchroniserait quand même : mieux vaut ne
 * rien toucher.
 */
const exigences = [
  [rendererDir, 'le rendu Electron (apps/desktop/src/renderer/)'],
  [sharedDir, 'les modules partagés (apps/desktop/src/shared/)'],
  [shimSource, 'le shim `src/repository.capacitor.js` — écrit en parallèle, il n’existe pas encore'],
  ...(sansSonde
    ? []
    : [[probeSource, 'la sonde `src/probe.js` — écrite en parallèle, elle n’existe pas encore']]),
];
const manquants = exigences.filter(([chemin]) => !fs.existsSync(chemin));
if (manquants.length) {
  console.error('prepare-www : impossible de produire www/, il manque :\n');
  for (const [chemin, quoi] of manquants) {
    console.error(`  ${quoi}\n    attendu : ${chemin}`);
  }
  console.error(
    '\nRien n’a été touché : `www/` est laissé tel quel. Aucun remplaçant n’est\n' +
      'inventé — un shim bricolé ici serait précisément la copie qui dérive.',
  );
  process.exit(1);
}

console.log('prépare www/');

fs.rmSync(wwwDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
const copiesRendu = copierDossier(rendererDir, wwwDir);
console.log(`  ${String(copiesRendu).padStart(3)} fichiers  src/renderer/ -> www/`);

/**
 * `src/shared/` doit suivre, et se poser à la racine de `www/`.
 *
 * Les vues importent `../../shared/digits.js` (depuis `js/`) et
 * `../../../shared/arabic.js` (depuis `js/views/`). Sous Electron ces chemins
 * sortent de `src/renderer/` et tombent dans `src/shared/`. Sous Capacitor la
 * racine du serveur est `www/`, et un navigateur **rabote** les `..` qui
 * remontent au-dessus de la racine : les deux formes se résolvent donc en
 * `/shared/…`. Poser `src/shared/` en `www/shared/` fait marcher les deux sans
 * réécrire une seule ligne d'import — ce qui est tout l'intérêt du portage.
 */
const copiesPartage = copierDossier(sharedDir, path.join(wwwDir, 'shared'));
console.log(`  ${String(copiesPartage).padStart(3)} fichiers  src/shared/   -> www/shared/`);

fs.copyFileSync(shimSource, path.join(wwwDir, 'js', 'repository.js'));
console.log('  remplacé   www/js/repository.js  <- src/repository.capacitor.js');

if (sansSonde) {
  console.log('  écartée    www/js/probe.js       — montage release, la sonde ne part pas');
} else {
  fs.copyFileSync(probeSource, path.join(wwwDir, 'js', 'probe.js'));
  console.log('  ajouté     www/js/probe.js       <- src/probe.js');
}

// Les modules du dépôt, écrits comme des fabriques sans aucun import : c'est
// ce qui leur permet d'être servis à plat, sans résolution de spécificateur.
const repoDir = path.join(appDir, 'src', 'repo');
if (fs.existsSync(repoDir)) {
  const cible = path.join(wwwDir, 'js', 'repo');
  const n = copierDossier(repoDir, cible);
  console.log(`  ajouté     www/js/repo/          <- src/repo/ (${n} module(s))`);
}

// zstd est embarqué, pas résolu. `fzstd` livre un ESM d'un seul tenant, sans
// import interne : le recopier suffit, et le rendu peut l'importer en relatif.
// C'est le pendant, côté navigateur, du `zlib.createZstdDecompress` que le
// processus principal d'Electron obtient de Node.
const fzstdSource = path.join(appDir, 'node_modules', 'fzstd', 'esm', 'index.mjs');
if (fs.existsSync(fzstdSource)) {
  const vendor = path.join(wwwDir, 'js', 'vendor');
  fs.mkdirSync(vendor, { recursive: true });
  fs.copyFileSync(fzstdSource, path.join(vendor, 'fzstd.js'));
  console.log('  ajouté     www/js/vendor/fzstd.js <- node_modules/fzstd');
} else {
  console.log('  fzstd absent : `npm install fzstd`, sinon les téléchargements ne se décompressent pas');
}

const indexPath = path.join(wwwDir, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

const viewport = injecterViewport(html);
html = viewport.html;
console.log(
  viewport.injecte
    ? '  injecté    <meta name="viewport"> — sans lui le WebView rend en 1028 px CSS'
    : '  viewport déjà présent dans le rendu source',
);

if (!sansSonde) {
  const sonde = injecterSonde(html);
  html = sonde.html;
  console.log(
    sonde.injecte
      ? '  injecté    <script src="js/probe.js"> avant js/app.js'
      : '  sonde déjà présente dans le rendu source : rien à injecter',
  );
}

const csp = ajusterCsp(html);
html = csp.html;
fs.writeFileSync(indexPath, html);

console.log('\nCSP');
for (const changement of csp.changements) {
  console.log(`  ${changement.directive}  « ${changement.avant} »  ->  « ${changement.apres} »`);
  console.log(`    ${changement.raison}`);
}
if (!csp.changements.length) console.log('  aucune directive modifiée');
console.log(`  inchangées : ${csp.inchangees.join(', ')}`);

// Avertissements — ils ne font pas échouer, mais ils se voient.
const nus = [
  ...specificateursNus(fs.readFileSync(shimSource, 'utf8')),
  ...(sansSonde ? [] : specificateursNus(fs.readFileSync(probeSource, 'utf8'))),
];
if (nus.length) {
  console.log('\nAVERTISSEMENT — spécificateurs nus dans le code du spike');
  console.log(`  ${[...new Set(nus)].join(', ')}`);
  console.log(
    '  Le rendu se sert en `<script type="module">` sans bundler, et `cap sync`\n' +
      '  ne fait que recopier www/. Un navigateur ne résout pas un spécificateur\n' +
      '  nu : ces imports échoueront au chargement et laisseront un écran blanc.\n' +
      '  Deux issues : passer par les globales du pont (`window.Capacitor.Plugins`),\n' +
      '  ou déposer les modules ESM sous www/js/vendor/ avec des imports relatifs.',
  );
}

console.log(
  `\nwww/ : ${copiesRendu + copiesPartage + 1} fichiers, 1 remplacement ` +
    `(js/repository.js), ${csp.changements.length} directive(s) CSP modifiée(s).`,
);
