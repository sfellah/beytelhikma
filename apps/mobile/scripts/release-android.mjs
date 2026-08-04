/**
 * Monte l'application en **release** : un APK signé pour l'appareil, ou un
 * bundle `.aab` pour le Play Store.
 *
 * Pourquoi un script plutôt qu'une configuration Gradle : `android/` est
 * engendré par `npx cap add android` et ignoré par git. Une `signingConfig`
 * écrite dans `app/build.gradle` disparaîtrait au premier regénération, sans
 * que rien ne le dise. Ce fichier-ci est versionné, donc la recette survit.
 *
 * **Deux sorties, deux façons de signer**, et la différence n'est pas un
 * détail de commande :
 *
 * - Un **APK** se monte non signé, s'aligne (`zipalign`), puis se signe
 *   (`apksigner`). L'ordre est imposé : la signature v2 porte sur l'octet, et
 *   aligner après signer la casserait.
 * - Un **bundle** ne connaît ni l'un ni l'autre. `zipalign` et `apksigner` ne
 *   travaillent que sur un `.apk` ; un `.aab` se signe **pendant**
 *   `bundleRelease`, par Gradle. C'est pourquoi les identifiants lui sont
 *   passés en propriétés injectées et non appliqués après coup.
 *
 * Ce que Play fait ensuite : il vérifie cette signature, la **retire**, découpe
 * le bundle en APK par appareil et les signe avec sa propre clé — celle de
 * `certificates/deployment_cert.der`. La clé d'ici ne sert qu'à prouver que
 * l'envoi vient de nous.
 *
 * **La clé par défaut est celle de débogage d'Android** (`~/.android/
 * debug.keystore`, mot de passe public `android`). Ce n'est pas un raccourci
 * de paresse : elle signe déjà l'installation présente sur l'appareil, et
 * changer de signataire obligerait à désinstaller — donc à effacer les livres
 * téléchargés, le catalogue et les annotations, que rien ne restaurerait.
 *
 * Elle est en revanche **refusée pour un bundle** : Play rejette la clé de
 * débogage, elle est publique et identique sur toutes les machines du monde.
 * Le refus est prononcé **avant** le montage, pour ne pas faire attendre trois
 * minutes une archive qu'on jettera.
 *
 * Ce que le mode release change vraiment : l'application n'est plus
 * `debuggable`, ses ressources sont optimisées, et la WebView n'accepte plus
 * le protocole DevTools — donc plus d'inspection à distance.
 *
 *   node scripts/release-android.mjs [--aab] [--ks <keystore>] [--alias <nom>]
 *                                    [--pass <mdp>] [--install]
 */
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const ANDROID = path.join(RACINE, 'android');
const PROPRIETES = path.join(RACINE, 'keystore.properties');

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const index = args.indexOf(`--${nom}`);
  return index === -1 ? defaut : args[index + 1];
};

const bundle = args.includes('--aab');
const installer = args.includes('--install');

/**
 * `keystore.properties`, s'il existe. Format `clé=valeur`, celui d'Android :
 * on ne l'invente pas, la documentation de Google l'écrit ainsi et l'habitude
 * vaut mieux qu'un format à nous.
 *
 * Le fichier est ignoré par git. Le lire **avec** `utf8` et découper sur le
 * premier `=` seulement : un mot de passe en contient légitimement.
 */
function proprietes(fichier) {
  if (!existsSync(fichier)) return {};
  const table = {};
  for (const ligne of readFileSync(fichier, 'utf8').split('\n')) {
    const propre = ligne.trim();
    if (!propre || propre.startsWith('#')) continue;
    const coupe = propre.indexOf('=');
    if (coupe === -1) continue;
    table[propre.slice(0, coupe).trim()] = propre.slice(coupe + 1).trim();
  }
  return table;
}

/**
 * D'où viennent les identifiants, du plus explicite au plus commode :
 * options de ligne de commande, puis variables d'environnement (la CI, qui
 * n'a pas de fichier), puis `keystore.properties` (la machine de
 * développement), puis la clé de débogage.
 *
 * L'ordre compte : une variable posée par un runner ne doit pas l'emporter sur
 * ce qu'on tape à la main pour un essai ponctuel.
 */
function signataire() {
  const fichier = proprietes(PROPRIETES);
  const env = process.env;
  const keystore =
    option('ks') ??
    env.BEYT_KEYSTORE_FILE ??
    fichier.storeFile ??
    path.join(homedir(), '.android', 'debug.keystore');

  const parDefaut = keystore === path.join(homedir(), '.android', 'debug.keystore');
  return {
    keystore,
    alias: option('alias') ?? env.BEYT_KEY_ALIAS ?? fichier.keyAlias ?? 'androiddebugkey',
    motDePasseMagasin:
      option('pass') ?? env.BEYT_KEYSTORE_PASSWORD ?? fichier.storePassword ?? 'android',
    // Android distingue le mot de passe du magasin de celui de la clé. Ils sont
    // presque toujours identiques ; presque n'est pas toujours, et une clé dont
    // ils diffèrent échouerait avec un message qui ne dit pas lequel des deux.
    motDePasseCle:
      option('keypass') ??
      env.BEYT_KEY_PASSWORD ??
      fichier.keyPassword ??
      option('pass') ??
      env.BEYT_KEYSTORE_PASSWORD ??
      fichier.storePassword ??
      'android',
    debogage: parDefaut,
    source: option('ks')
      ? 'option --ks'
      : env.BEYT_KEYSTORE_FILE
        ? 'environnement'
        : fichier.storeFile
          ? 'keystore.properties'
          : 'clé de débogage',
  };
}

const identite = signataire();
const { keystore, alias, motDePasseMagasin: motDePasse, motDePasseCle } = identite;

if (bundle && identite.debogage) {
  throw new Error(
    'un bundle ne peut pas être signé par la clé de débogage : elle est publique,\n' +
      "  et le Play Console le refuse à l'envoi.\n" +
      `  Créez une clé d'upload, puis renseignez ${path.relative(process.cwd(), PROPRIETES)}\n` +
      '  (le modèle est dans keystore.properties.example).',
  );
}

/** Le SDK, tel que le système le désigne — jamais un chemin en dur. */
function sdk() {
  for (const variable of ['ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
    if (process.env[variable] && existsSync(process.env[variable])) return process.env[variable];
  }
  for (const candidat of [
    path.join(homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
    'C:/Android/Sdk',
    path.join(homedir(), 'Android', 'Sdk'),
  ]) {
    if (existsSync(candidat)) return candidat;
  }
  throw new Error('SDK Android introuvable : posez ANDROID_HOME');
}

/** La version la plus récente des outils de build, comparée en numérique. */
function outils(racine) {
  const dossier = path.join(racine, 'build-tools');
  const versions = readdirSync(dossier)
    .filter((nom) => /^\d+\./.test(nom))
    .sort((a, b) => {
      const decoupe = (v) => v.split('.').map(Number);
      const [ax, ay, az] = decoupe(a);
      const [bx, by, bz] = decoupe(b);
      return ax - bx || ay - by || az - bz;
    });
  if (!versions.length) throw new Error(`aucun build-tools sous ${dossier}`);
  return path.join(dossier, versions.at(-1));
}

/**
 * Node refuse depuis la 20 de lancer un `.bat` sans passer par un interpréteur
 * (`EINVAL`) — c'est la parade à l'injection d'arguments sous Windows. On
 * repasse donc par le shell pour ces seuls fichiers, et on cite chaque
 * paramètre : les chemins du SDK et de la clé contiennent des espaces.
 */
const lance = (commande, parametres, options = {}) => {
  const parLeShell = /\.(bat|cmd)$/i.test(commande);
  if (!parLeShell) return execFileSync(commande, parametres, { stdio: 'inherit', ...options });
  // Une seule chaîne, et aucun tableau : passer des arguments *et* `shell`
  // fait avertir Node (DEP0190), parce qu'il les concatène sans les échapper.
  // On les échappe donc nous-mêmes, une bonne fois.
  const cite = (valeur) => `"${String(valeur).replace(/"/g, '""')}"`;
  const ligne = [commande, ...parametres].map(cite).join(' ');
  return execSync(ligne, { stdio: 'inherit', ...options });
};

const suffixe = process.platform === 'win32' ? '.bat' : '';
const exe = process.platform === 'win32' ? '.exe' : '';

const racineSdk = sdk();
const buildTools = outils(racineSdk);

if (!existsSync(keystore)) throw new Error(`clé introuvable : ${keystore}`);

console.log(`sortie       ${bundle ? 'bundle .aab (Play Store)' : 'APK signé (appareil)'}`);
console.log(`SDK          ${racineSdk}`);
console.log(`build-tools  ${path.basename(buildTools)}`);
console.log(`clé          ${keystore} (alias ${alias}) — ${identite.source}`);
console.log('');

// Gradle prend le Java qu'on lui donne : `~/.gradle/gradle.properties` peut
// épingler une version trop ancienne pour le projet, et l'erreur qui en sort
// (« invalid source release ») ne dit pas d'où vient le conflit.
const jbr = 'C:/Program Files/Android/Android Studio/jbr';
const javaHome = process.env.JAVA_HOME_ANDROID ?? (existsSync(jbr) ? jbr : null);
const java = javaHome ? [`-Dorg.gradle.java.home=${javaHome}`] : [];

if (bundle) {
  /*
   * La signature d'un bundle se passe **dans** Gradle : `apksigner` ne sait pas
   * lire un `.aab`, et `zipalign` non plus. On lui passe donc la clé en
   * propriétés injectées.
   *
   * Pourquoi pas une `signingConfig` dans `app/build.gradle`, qui serait plus
   * propre : ce fichier est engendré par `npx cap add android`. La
   * configuration y survivrait jusqu'au premier clone, et le build continuerait
   * de réussir — en produisant un bundle non signé. C'est la règle qui vaut
   * déjà pour l'icône et l'écran de démarrage, et pour la version.
   *
   * Ce que ce choix coûte : les mots de passe passent par la ligne de commande
   * de Gradle, donc sont lisibles dans la liste des processus le temps du
   * montage. Sur une machine personnelle et sur un runner jetable, c'est
   * acceptable ; ça ne le serait pas sur une machine partagée.
   */
  console.log('— montage du bundle —');
  lance(
    path.join(ANDROID, `gradlew${suffixe}`),
    [
      'bundleRelease',
      `-Pandroid.injected.signing.store.file=${keystore}`,
      `-Pandroid.injected.signing.store.password=${motDePasse}`,
      `-Pandroid.injected.signing.key.alias=${alias}`,
      `-Pandroid.injected.signing.key.password=${motDePasseCle}`,
      ...java,
    ],
    { cwd: ANDROID },
  );

  const aab = path.join(ANDROID, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  if (!existsSync(aab)) throw new Error(`bundle introuvable : ${aab}`);

  /*
   * La vérification passe par `jarsigner` et non `apksigner` : un `.aab` est un
   * zip signé à l'ancienne (v1), et c'est ce que Play attend. Sans ce contrôle,
   * un bundle non signé se téléverserait et se ferait refuser après plusieurs
   * minutes d'envoi — le genre d'échec qui se découvre le plus tard possible.
   */
  const jarsigner = javaHome
    ? path.join(javaHome, 'bin', `jarsigner${exe}`)
    : `jarsigner${exe}`;
  console.log('\n— vérification de la signature —');
  // La sortie est **capturée** et non déversée : `jarsigner` émet une trentaine
  // de lignes « signed in JarFile but is not signed in JarInputStream », qui
  // sont normales sur un bundle et n'apprennent rien. Noyer le verdict dans
  // trente avertissements bénins, c'est le rendre invisible le jour où il
  // change. On ne garde que la ligne qui décide.
  // `spawnSync` et non `execFileSync` : ce dernier lève sur un code de retour
  // non nul, et l'on perdrait alors le rapport, c'est-à-dire la seule chose qui
  // dise *pourquoi* la vérification a échoué. Les deux flux sont recousus, la
  // répartition variant d'un JDK à l'autre.
  const passe = spawnSync(jarsigner, ['-verify', aab], { encoding: 'utf8' });
  if (passe.error) throw passe.error;
  const rapport = `${passe.stdout ?? ''}
${passe.stderr ?? ''}`;
  const verdict = rapport.split('\n').find((ligne) => /^jar (verified|is unsigned)/i.test(ligne));
  if (!/^jar verified/i.test(verdict ?? '')) {
    throw new Error(
      `le bundle n'est pas signé : ${verdict?.trim() ?? 'verdict illisible'}\n` +
        "  Play le refuserait après plusieurs minutes d'envoi.",
    );
  }
  console.log(`  ${verdict.trim()}`);
  // Deux formulations selon la verbosité et le JDK — « will expire on » avec
  // `-verbose:summary`, « as early as » sans. N'en reconnaître qu'une donnait
  // une ligne morte que rien ne signalait : elle ne s'imprimait simplement
  // jamais.
  const expire = rapport.match(/(?:will expire on|as early as) (\d{4}-\d{2}-\d{2})/);
  if (expire) console.log(`  certificat valide au moins jusqu'au ${expire[1]}`);

  const poids = (statSync(aab).size / 1024 / 1024).toFixed(1);
  console.log(`\nécrit : ${aab} (${poids} Mo)`);
  console.log(
    '\nÀ téléverser dans le Play Console. Play retirera cette signature et\n' +
      'signera lui-même les APK livrés, avec la clé de certificates/.',
  );
  process.exit(0);
}

console.log('— montage release —');
lance(path.join(ANDROID, `gradlew${suffixe}`), ['assembleRelease', ...java], { cwd: ANDROID });

const sortie = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release');
const brut = readdirSync(sortie).find((nom) => nom.endsWith('.apk') && nom.includes('unsigned'));
const source = path.join(sortie, brut ?? 'app-release-unsigned.apk');
if (!existsSync(source)) throw new Error(`archive introuvable dans ${sortie}`);

const aligne = path.join(sortie, 'app-release-aligned.apk');
const signe = path.join(sortie, 'app-release.apk');

// `apksigner` exige une archive alignée : la signature v2 porte sur l'octet,
// et aligner après signer la casserait.
console.log('\n— alignement —');
lance(path.join(buildTools, `zipalign${exe}`), ['-p', '-f', '4', source, aligne]);

console.log('\n— signature —');
lance(path.join(buildTools, `apksigner${suffixe}`), [
  'sign',
  '--ks', keystore,
  '--ks-pass', `pass:${motDePasse}`,
  '--ks-key-alias', alias,
  '--key-pass', `pass:${motDePasseCle}`,
  '--out', signe,
  aligne,
]);

console.log('\n— vérification —');
lance(path.join(buildTools, `apksigner${suffixe}`), ['verify', '--print-certs', signe]);

const taille = (statSync(signe).size / 1024 / 1024).toFixed(1);
console.log(`\nécrit : ${signe} (${taille} Mo)`);

if (installer) {
  console.log('\n— installation —');
  // `-r` conserve les données : c'est possible parce que le signataire ne
  // change pas. Avec une autre clé, Android exigerait une désinstallation.
  lance(path.join(racineSdk, 'platform-tools', `adb${exe}`), ['install', '-r', signe]);
}
