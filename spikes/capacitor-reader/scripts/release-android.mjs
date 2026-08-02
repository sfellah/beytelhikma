/**
 * Monte l'application en **release**, aligne l'archive et la signe.
 *
 * Pourquoi un script plutôt qu'une configuration Gradle : `android/` est
 * engendré par `npx cap add android` et ignoré par git. Une `signingConfig`
 * écrite dans `app/build.gradle` disparaîtrait au premier regénération, sans
 * que rien ne le dise. Ce fichier-ci est versionné, donc la recette survit.
 *
 * La clé est celle de **débogage d'Android** (`~/.android/debug.keystore`,
 * mot de passe public `android`). Ce n'est pas un raccourci de paresse : elle
 * signe déjà l'installation présente sur l'appareil, et changer de signataire
 * obligerait à désinstaller — donc à effacer les 78 Mo de livres téléchargés,
 * le catalogue et les annotations, que rien ne restaurerait. Pour une
 * publication, `--ks` accepte n'importe quelle autre clé.
 *
 * Ce que le mode release change vraiment : l'application n'est plus
 * `debuggable`, ses ressources sont optimisées, et la WebView n'accepte plus
 * le protocole DevTools — donc plus d'inspection à distance.
 *
 *   node scripts/release-android.mjs [--ks <keystore>] [--alias <nom>]
 *                                    [--pass <mdp>] [--install]
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const ANDROID = path.join(RACINE, 'android');

const args = process.argv.slice(2);
const option = (nom, defaut) => {
  const index = args.indexOf(`--${nom}`);
  return index === -1 ? defaut : args[index + 1];
};

const keystore = option('ks', path.join(homedir(), '.android', 'debug.keystore'));
const alias = option('alias', 'androiddebugkey');
const motDePasse = option('pass', 'android');
const installer = args.includes('--install');

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

console.log(`SDK          ${racineSdk}`);
console.log(`build-tools  ${path.basename(buildTools)}`);
console.log(`clé          ${keystore} (alias ${alias})`);
console.log('');

// Gradle prend le Java qu'on lui donne : `~/.gradle/gradle.properties` peut
// épingler une version trop ancienne pour le projet, et l'erreur qui en sort
// (« invalid source release ») ne dit pas d'où vient le conflit.
const jbr = 'C:/Program Files/Android/Android Studio/jbr';
const javaHome = process.env.JAVA_HOME_ANDROID ?? (existsSync(jbr) ? jbr : null);

console.log('— montage release —');
lance(path.join(ANDROID, `gradlew${suffixe}`), [
  'assembleRelease',
  ...(javaHome ? [`-Dorg.gradle.java.home=${javaHome}`] : []),
], { cwd: ANDROID });

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
  '--key-pass', `pass:${motDePasse}`,
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
