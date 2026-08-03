#!/usr/bin/env node
/**
 * Pose l'écran de démarrage dans le projet natif Android.
 *
 *   node scripts/prepare-android.mjs
 *
 * Pourquoi un script et pas des fichiers rangés dans `android/` : ce dossier
 * est **engendré** par `npx cap add android`, et le `.gitignore` l'exclut. Une
 * ressource déposée là à la main disparaît au premier clone — la panne serait
 * silencieuse, l'application se construisant très bien avec l'écran de
 * démarrage par défaut de Capacitor. C'est la leçon de `prepare-www.mjs`, à
 * l'identique : la source est suivie, la cible est refaite.
 *
 * Le script est **idempotent** : deux exécutions de suite donnent le même
 * arbre, et modifier `android/app/src/main/res/` à la main n'a aucun effet
 * durable.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptsDir, '..');

const sourceRes = path.join(appDir, 'resources', 'android', 'res');
const cibleRes = path.join(appDir, 'android', 'app', 'src', 'main', 'res');
const stylesPath = path.join(cibleRes, 'values', 'styles.xml');
const gradlePath = path.join(appDir, 'android', 'app', 'build.gradle');
const manifestePath = path.join(appDir, 'package.json');

// ---------------------------------------------------------------------------
// La version
// ---------------------------------------------------------------------------

/**
 * `npx cap add android` écrit `versionName "1.0"` et `versionCode 1`, et
 * personne ne les touche jamais : `android/` est engendré et ignoré par git.
 * L'écran « عن التطبيق » lit `App.getInfo()`, c'est-à-dire ces deux valeurs —
 * il annonçait donc « 1.0 (1) » pendant que le dépôt en était à 0.5. Ce n'est
 * pas un détail d'affichage : c'est la ligne qu'on recopie dans un rapport de
 * bug, et elle désignait un binaire qui n'existe pas.
 *
 * La version suivie est celle de `package.json`, et c'est ce script qui la
 * pose — même règle que l'écran de démarrage : la source est suivie, la cible
 * est refaite, deux exécutions donnent le même arbre.
 */
function codeDeVersion(version) {
  const morceaux = version.split('.').map(Number);
  const [majeur, mineur, correctif] = morceaux;
  if (
    morceaux.length !== 3 ||
    morceaux.some((n) => !Number.isInteger(n) || n < 0 || n > 99)
  ) {
    throw new Error(
      `version « ${version} » : trois nombres de 0 à 99 attendus.\n` +
        '  Le `versionCode` d’Android est un entier qui ne peut que croître, et\n' +
        '  il est ici dérivé de la version — au-delà de 99, deux versions\n' +
        '  différentes rendraient le même code et le Play Store refuserait la\n' +
        '  seconde.',
    );
  }
  return majeur * 10000 + mineur * 100 + correctif;
}

/** Le bloc `defaultConfig`, réécrit sur ses deux lignes de version. */
function poserVersion(gradle, version) {
  const code = codeDeVersion(version);
  const remplacements = [
    [/versionCode\s+\d+/g, `versionCode ${code}`],
    [/versionName\s+"[^"]*"/g, `versionName "${version}"`],
  ];
  let sortie = gradle;
  for (const [motif, valeur] of remplacements) {
    const occurrences = sortie.match(motif)?.length ?? 0;
    if (occurrences !== 1) {
      throw new Error(
        `app/build.gradle : ${occurrences} occurrence(s) de « ${motif.source} », une seule attendue.\n` +
          '  Capacitor a changé son gabarit : relisez le fichier avant de le réécrire.',
      );
    }
    sortie = sortie.replace(motif, valeur);
  }
  return { gradle: sortie, code, change: sortie !== gradle };
}

// ---------------------------------------------------------------------------
// Le thème de lancement
// ---------------------------------------------------------------------------

/**
 * Capacitor pose un `AppTheme.NoActionBarLaunch` qui hérite bien de
 * `Theme.SplashScreen`, mais ne lui donne qu'un `android:background` vers
 * `@drawable/splash` — un attribut de **vue**, pas de fenêtre, qui ne décide
 * donc de rien. L'écran de démarrage effectif était celui que le système
 * compose seul à partir de l'icône du lanceur.
 *
 * Les quatre lignes ci-dessous sont les attributs de `core-splashscreen`, sans
 * préfixe `android:` — la bibliothèque les redirige elle-même vers les
 * attributs de plateforme sur API 31+, et s'en sert pour composer un fond de
 * fenêtre en deçà. Les écrire une fois couvre donc Android 7 à 16.
 */
const THEME_LANCEMENT = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <!-- Posé par scripts/prepare-android.mjs — voir resources/android/. -->
        <item name="windowSplashScreenBackground">@color/splash_fond</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_reveal</item>
        <item name="windowSplashScreenAnimationDuration">700</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>`;

/** Le bloc `<style name="AppTheme.NoActionBarLaunch" …>…</style>`, tel quel. */
const MOTIF_LANCEMENT = /[ \t]*<style\s+name="AppTheme\.NoActionBarLaunch"[\s\S]*?<\/style>/;

function poserTheme(xml) {
  const occurrences = xml.match(new RegExp(MOTIF_LANCEMENT.source, 'g'))?.length ?? 0;
  if (occurrences !== 1) {
    throw new Error(
      `values/styles.xml : ${occurrences} bloc(s) « AppTheme.NoActionBarLaunch », un seul attendu.\n` +
        "  Capacitor a changé son thème de lancement : relisez le fichier avant de le réécrire.",
    );
  }
  const remplace = xml.replace(MOTIF_LANCEMENT, THEME_LANCEMENT);
  return { xml: remplace, change: remplace !== xml };
}

// ---------------------------------------------------------------------------
// Copie et nettoyage
// ---------------------------------------------------------------------------

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

/**
 * Efface les onze `splash.png` de Capacitor, et les dossiers de densité qui
 * n'existaient que pour eux.
 *
 * Ce n'est pas du ménage : `@drawable/splash` n'est plus référencé nulle part
 * une fois le thème réécrit, et un dessin orphelin dans `res/` est exactement
 * ce qui fait croire, six mois plus tard, qu'on regarde l'écran de démarrage
 * en vigueur.
 */
function effacerOrphelins(res) {
  const efface = [];
  // `splash.png` : plus référencé une fois le thème réécrit.
  //
  // `ic_launcher_foreground.png` : l'avant-plan est devenu un vectoriel.
  //
  // `drawable-v24/ic_launcher_foreground.xml` : celui de Capacitor, et le
  // défaut qu'il a causé mérite d'être écrit. Un qualificateur de version
  // **l'emporte** sur le dossier nu dès que l'appareil l'atteint, et
  // `minSdkVersion` vaut 24 : le nôtre, posé dans `drawable/`, n'était donc
  // lu par aucun appareil. Rien n'échouait — l'icône montrait le petit robot
  // d'Android sur notre fond crème, ce qui se lit comme une icône à moitié
  // appliquée plutôt que comme une ressource masquée.
  const condamnes = [
    [/^drawable/, 'splash.png'],
    [/^mipmap-[a-z]+dpi$/, 'ic_launcher_foreground.png'],
    [/^drawable-v\d+$/, 'ic_launcher_foreground.xml'],
  ];
  for (const entree of fs.readdirSync(res, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const dossier = path.join(res, entree.name);
    for (const [motif, fichier] of condamnes) {
      if (!motif.test(entree.name)) continue;
      const cible = path.join(dossier, fichier);
      if (!fs.existsSync(cible)) continue;
      fs.rmSync(cible);
      efface.push(path.join(entree.name, fichier));
    }
    if (fs.existsSync(dossier) && !fs.readdirSync(dossier).length) {
      fs.rmSync(dossier, { recursive: true });
    }
  }
  return efface;
}

/**
 * Relève les ressources qu'un dossier **qualifié** masquerait.
 *
 * Android choisit la variante la plus spécifique : `drawable-v24/x.xml`
 * l'emporte sur `drawable/x.xml` dès l'API 24, et `minSdkVersion` vaut 24 —
 * donc toujours. Poser une ressource dans le dossier nu pendant qu'une
 * variante qualifiée traîne revient à ne rien poser du tout, et **rien
 * n'échoue** : le build passe, l'icône montre celle de Capacitor.
 *
 * C'est arrivé, et c'est le genre de défaut qu'on ne voit qu'en regardant le
 * lanceur d'un vrai appareil. Le contrôle est donc dans la chaîne.
 */
function masquees(source, cible) {
  const griefs = [];
  for (const entree of fs.readdirSync(source, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const nus = fs.readdirSync(path.join(source, entree.name));
    for (const voisin of fs.readdirSync(cible, { withFileTypes: true })) {
      if (!voisin.isDirectory()) continue;
      // Même famille, mais qualifiée — et pas un dossier que nous fournissons.
      if (!voisin.name.startsWith(`${entree.name}-`)) continue;
      if (fs.existsSync(path.join(source, voisin.name))) continue;
      for (const nom of nus) {
        if (fs.existsSync(path.join(cible, voisin.name, nom))) {
          griefs.push(`${voisin.name}/${nom} masque ${entree.name}/${nom}`);
        }
      }
    }
  }
  return griefs;
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------

// Tout est vérifié avant d'écrire quoi que ce soit : échouer à mi-parcours
// laisserait un `res/` qui référence un dessin absent, et le build d'après
// tomberait sur une erreur d'AAPT sans rapport visible avec la cause.
const exigences = [
  [sourceRes, 'les ressources suivies `resources/android/res/`'],
  [path.join(sourceRes, 'drawable', 'splash_icon.xml'), 'le dessin engendré — lancez `python tools/gen_brand_assets.py`'],
  [path.join(sourceRes, 'drawable-v31', 'splash_reveal.xml'), 'l’animation engendrée — lancez `python tools/gen_brand_assets.py`'],
  [
    path.join(sourceRes, 'drawable', 'ic_launcher_foreground.xml'),
    'l’avant-plan de l’icône — lancez `python tools/gen_brand_assets.py`',
  ],
  [cibleRes, 'le projet natif `android/` — lancez `npx cap add android`'],
  [stylesPath, 'le thème `android/app/src/main/res/values/styles.xml`'],
  [gradlePath, 'le montage `android/app/build.gradle`'],
];
const manquants = exigences.filter(([chemin]) => !fs.existsSync(chemin));
if (manquants.length) {
  console.error('prepare-android : rien n’a été touché, il manque :\n');
  for (const [chemin, quoi] of manquants) console.error(`  ${quoi}\n    attendu : ${chemin}`);
  process.exit(1);
}

console.log('prépare android/ — version, écran de démarrage');

const { version } = JSON.parse(fs.readFileSync(manifestePath, 'utf8'));
const versions = poserVersion(fs.readFileSync(gradlePath, 'utf8'), version);
fs.writeFileSync(gradlePath, versions.gradle);
console.log(
  versions.change
    ? `  réécrit    app/build.gradle — versionName "${version}", versionCode ${versions.code}`
    : `  app/build.gradle portait déjà « ${version} » : rien à réécrire`,
);


const copies = copierDossier(sourceRes, cibleRes);
console.log(`  ${String(copies).padStart(2)} fichiers  resources/android/res/ -> android/app/src/main/res/`);

const theme = poserTheme(fs.readFileSync(stylesPath, 'utf8'));
fs.writeFileSync(stylesPath, theme.xml);
console.log(
  theme.change
    ? '  réécrit    values/styles.xml — AppTheme.NoActionBarLaunch'
    : '  values/styles.xml portait déjà le thème : rien à réécrire',
);

const efface = effacerOrphelins(cibleRes);
if (efface.length) {
  console.log(`  effacé     ${efface.length} ressource(s) de Capacitor devenues orphelines`);
} else {
  console.log('  aucune ressource orpheline à effacer');
}

const ombres = masquees(sourceRes, cibleRes);
if (ombres.length) {
  console.error('\nprepare-android : une variante qualifiée masque ce qu’on vient de poser :\n');
  for (const grief of ombres) console.error(`  ${grief}`);
  console.error(
    '\nAndroid préfère la variante la plus spécifique, et rien n’échoue :\n' +
      'le build passe, la ressource posée n’est jamais lue. Ajoutez-la aux\n' +
      '`condamnes` d’`effacerOrphelins`, ou fournissez la variante qualifiée.',
  );
  process.exit(1);
}

console.log(
  '\nÉcran de démarrage : Android 12+ joue `drawable-v31/splash_reveal.xml` (700 ms),\n' +
    'Android 7 à 11 montrent le dessin fixe de `drawable/splash_reveal.xml`.\n' +
    'Icône : adaptative à partir d’Android 8.1, PNG hérités en deçà.',
);
