/**
 * Le rendu complet, sur fixtures. Aucun réseau : le générateur n'en fait pas,
 * et c'est ce qui rend ce test possible.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from '../build.mjs';
import { BASE_PATH, PAGES, SITE_LOCALES, SITE_ORIGIN } from '../config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RENDERER = path.join(HERE, '..', '..', 'apps', 'desktop', 'src', 'renderer');

let out;
let report;

test.before(async () => {
  out = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-'));
  report = await build({
    out,
    dataDir: path.join(HERE, 'fixtures', 'data'),
    books: 8568,
  });
});

test.after(async () => {
  await fs.rm(out, { recursive: true, force: true });
});

const read = (relative) => fs.readFile(path.join(out, relative), 'utf8');

test('neuf pages et la bascule de racine sont écrites', async () => {
  assert.equal(report.pages.length, SITE_LOCALES.length * PAGES.length);
  await fs.access(path.join(out, 'index.html'));
  await fs.access(path.join(out, 'releases.json'));
  await fs.access(path.join(out, 'sitemap.xml'));
  await fs.access(path.join(out, '.nojekyll'));
});

test('le domaine personnalisé part dans l’artefact déployé', async () => {
  // `actions/deploy-pages` publie ce qu'on lui donne : un artefact sans `CNAME`
  // peut faire retomber le site sur `github.io`, et la panne est silencieuse —
  // le déploiement réussit, seule l'URL change.
  const cname = await read('CNAME');
  assert.equal(cname.trim().split('\n').length, 1, 'un seul hôte, une seule ligne');
  assert.equal(cname.trim(), new URL(SITE_ORIGIN).host);
});

test('chaque page annonce sa langue et sa direction', async () => {
  for (const locale of SITE_LOCALES) {
    for (const page of PAGES) {
      const file = page === 'index' ? `${locale.key}/index.html` : `${locale.key}/${page}/index.html`;
      const html = await read(file);
      assert.match(html, new RegExp(`<html lang="${locale.key}" dir="${locale.dir}">`), file);
    }
  }
});

test('chaque page porte les trois alternats et un x-default', async () => {
  const html = await read('fr/download/index.html');
  for (const locale of SITE_LOCALES) {
    assert.match(html, new RegExp(`hreflang="${locale.hreflang}"`));
  }
  assert.match(html, /hreflang="x-default"/);
});

test('aucun lien interne n’oublie le préfixe de GitHub Pages', async () => {
  // Un `/assets/…` écrit en dur marcherait en local et donnerait un 404 en
  // production : la panne ne se verrait qu'après publication.
  const html = await read('ar/index.html');
  const internal = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((match) => match[1]);
  assert.ok(internal.length > 0, 'la page doit porter des liens internes');
  for (const link of internal) {
    assert.ok(link.startsWith(BASE_PATH), `lien sans préfixe : ${link}`);
  }
});

test('aucun lien interne ne commence par une double barre', async () => {
  // Le seul piège du `BASE_PATH` à `/` : `//assets/x` est une URL
  // protocol-relative, que le navigateur lit comme un hôte distant nommé
  // `assets`. Le test du préfixe ci-dessus ne peut plus la voir — tout chemin
  // absolu commence par `/`, y compris celui-là.
  for (const locale of SITE_LOCALES) {
    for (const page of PAGES) {
      const file = page === 'index' ? `${locale.key}/index.html` : `${locale.key}/${page}/index.html`;
      const html = await read(file);
      const doubled = [...html.matchAll(/(?:href|src)="(\/\/[^"]*)"/g)].map((match) => match[1]);
      assert.deepEqual(doubled, [], `lien protocol-relative dans ${file}`);
    }
  }
  assert.deepEqual([...(await read('index.html')).matchAll(/(?:href|src)="(\/\/[^"]*)"/g)], []);
});

test('aucune ressource ne vient d’un tiers', async () => {
  // Les maquettes tiraient Tailwind, Google Fonts et Material Symbols d'un CDN,
  // et leurs images d'un domaine Google. Rien de tout cela ne doit revenir.
  for (const locale of SITE_LOCALES) {
    const html = await read(`${locale.key}/index.html`);
    const external = [...html.matchAll(/(?:href|src)="(https?:\/\/[^"]+)"/g)].map((m) => m[1]);
    for (const link of external) {
      assert.ok(
        // `SITE_ORIGIN` et non l'hôte écrit en clair : une origine figée ici
        // resterait tolérée après un déménagement, et la vérification
        // deviendrait une passoire qui accepte l'ancien domaine.
        link.startsWith('https://github.com/') || link.startsWith(SITE_ORIGIN),
        `ressource tierce : ${link}`,
      );
    }
    assert.doesNotMatch(html, /cdn\.tailwindcss|fonts\.googleapis|googleusercontent/);
  }
});

test('les jetons de l’application sont copiés à l’identique', async () => {
  const source = await fs.readFile(path.join(RENDERER, 'styles', 'tokens.css'), 'utf8');
  assert.equal(await read('styles/tokens.css'), source);
});

test('le site n’a qu’une lumière : aucune ambiance nuit', async () => {
  // Trois ambiances servent à lire des heures durant ; une page de
  // présentation se parcourt, et son fond est une identité, pas un confort.
  const css = await read('styles/site.css');
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.doesNotMatch(await read('ar/index.html'), /theme-system\.css/);
});

test('le papier et l’encre sont dérivés des jetons, jamais posés en valeurs neuves', async () => {
  // Une seconde palette finit toujours par diverger : c'est la panne `sepia`
  // déjà vécue sur ce projet. Les couleurs propres au site se dérivent donc
  // par `color-mix` des jetons de l'application.
  const css = await read('styles/site.css');
  assert.match(css, /--paper: color-mix\(in srgb, var\(--secondary-container\)/);
  assert.match(css, /--ink: color-mix\(in srgb, var\(--on-surface\)/);
});

test('les trois voix typographiques sont posées', async () => {
  const css = await read('styles/site.css');
  assert.match(css, /--title: 'EB Garamond'/);
  assert.match(css, /--text: 'Literata'/);
  assert.match(css, /--margin-voice: 'IBM Plex Sans Arabic'/);
  // La coupure display/texte existe aussi en arabe — elle n'est pas serif
  // contre sans, elle est naskh contre grotesque humaniste. Amiri porte le
  // titre, où son autorité de page de garde se voit ; il portait aussi le
  // texte, et une page entière composée à petit corps dans une face taillée
  // pour l'in-octavo se lit lentement. Plex Sans Arabic prend le texte.
  assert.match(css, /html\[lang='ar'\][^}]*--title: 'Amiri'/);
  assert.match(css, /html\[lang='ar'\][^}]*--text: 'IBM Plex Sans Arabic'/);
});

test('l’arabe se compose par des axes, jamais par annulation du latin', async () => {
  // Chaque règle de marge s'écrivait deux fois : une pour le latin, une pour
  // l'arabe où l'on annulait la capitale et l'interlettrage. Quatorze blocs qui
  // ne disaient rien de l'arabe — seulement « pas de latin ici ». Les quatre
  // axes portent la différence, et une règle qui repose `text-transform: none`
  // hors du bloc racine est le retour de l'ancienne façon.
  const css = await read('styles/site.css');
  const root = css.slice(css.indexOf("html[lang='ar'] {"));
  const head = root.slice(0, root.indexOf('}'));
  for (const axis of ['--voice-case', '--voice-tracking', '--voice-sm', '--title-tracking']) {
    assert.match(head, new RegExp(`${axis}:`), `axe manquant : ${axis}`);
  }
  const overrides = [...css.matchAll(/html\[lang='ar'\][^{]+\{[^}]*text-transform:/g)];
  assert.deepEqual(overrides, [], 'la capitale se règle par --voice-case, pas par annulation');
});

test('les tics du gabarit de démonstration ne reviennent pas', async () => {
  // Dégradés, verre dépoli, halos sans décalage et rayons de 16 px : ce sont
  // les marques du gabarit qu'on est venu retirer. Elles reviennent seules si
  // rien ne les surveille.
  const css = await read('styles/site.css');
  assert.doesNotMatch(css, /linear-gradient|radial-gradient/);
  assert.doesNotMatch(css, /backdrop-filter/);
  assert.doesNotMatch(css, /box-shadow/);
  for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g)) {
    assert.match(value.trim(), /^(0|[1-4]px)$/, `rayon de coin trop grand : ${value.trim()}`);
  }
});

test('polices, marque et captures sont présentes', async () => {
  await fs.access(path.join(out, 'styles', 'fonts.css'));
  await fs.access(path.join(out, 'assets', 'fonts', 'amiri-400-arabic.woff2'));
  await fs.access(path.join(out, 'assets', 'brand', 'mark.png'));
  await fs.access(path.join(out, 'assets', 'shots', 'home.png'));
  await fs.access(path.join(out, 'assets', 'site.js'));
});

test('une planche réserve la place qu’elle prendra vraiment', async () => {
  // `width`/`height` n'existent que pour empêcher le saut de mise en page. Ils
  // annonçaient 1280 × 800 alors que les quatre captures font 1360 × 900 : le
  // navigateur réservait la hauteur du mauvais rapport, puis repeignait vingt
  // pixels plus bas — et les deux planches de tête ne sont pas différées, donc
  // le saut tombait juste sous la ligne de flottaison. Un attribut faux produit
  // exactement le défaut qu'il existe pour éviter, et rien ne le disait.
  const html = await read('en/index.html');
  const planches = [...html.matchAll(/src="([^"]*assets\/shots\/([^"]+))"[^>]*width="(\d+)" height="(\d+)"/g)];
  assert.ok(planches.length >= 3, 'aucune planche trouvée dans la page');
  for (const [, lien, nom, largeur, hauteur] of planches) {
    const png = await fs.readFile(path.join(out, lien.slice(BASE_PATH.length)));
    // Les dimensions d'un PNG vivent dans l'en-tête IHDR, aux octets 16 et 20.
    assert.equal(png.readUInt32BE(16), Number(largeur), `largeur annoncée fausse : ${nom}`);
    assert.equal(png.readUInt32BE(20), Number(hauteur), `hauteur annoncée fausse : ${nom}`);
  }
});

test('la couleur de barre du navigateur est le papier, jamais une seconde valeur', async () => {
  // `<meta name="theme-color">` ne peut pas prendre un `var()` : la valeur y est
  // forcément recopiée à la main. C'est donc le seul endroit du site où la règle
  // « rien n'est inventé en couleur » ne peut pas se tenir toute seule — on la
  // tient ici. Changer les 34 % de `--paper` sans toucher au gabarit laisserait
  // la barre du navigateur sur l'ancien papier, en silence.
  const site = await read('styles/site.css');
  const [, part] = site.match(/--paper: color-mix\(in srgb, var\(--secondary-container\) (\d+)%, #ffffff\)/);

  const tokens = await read('styles/tokens.css');
  const racine = tokens.slice(tokens.indexOf(':root'), tokens.indexOf('}', tokens.indexOf(':root')));
  const [, sable] = racine.match(/--secondary-container:\s*#([0-9a-f]{6})/i);

  const ratio = Number(part) / 100;
  const papier = `#${[0, 1, 2]
    .map((canal) => parseInt(sable.slice(canal * 2, canal * 2 + 2), 16))
    .map((valeur) => Math.round(valeur * ratio + 255 * (1 - ratio)))
    .map((valeur) => valeur.toString(16).padStart(2, '0'))
    .join('')}`;

  for (const locale of SITE_LOCALES) {
    assert.match(
      await read(`${locale.key}/index.html`),
      new RegExp(`name="theme-color" content="${papier}"`, 'i'),
      `la barre du navigateur n’est plus le papier (${papier} attendu)`,
    );
  }
});

test('chaque fichier référencé par une page existe vraiment', async () => {
  const html = await read('fr/download/index.html');
  const links = [...html.matchAll(/(?:href|src)="(\/[^"#?]*\.[a-z0-9]+)"/g)].map((m) => m[1]);
  for (const link of links) {
    await fs.access(path.join(out, link.slice(BASE_PATH.length)));
  }
});

test('la page de téléchargement propose les quatre artefacts et aucun fichier machine', async () => {
  const html = await read('en/download/index.html');
  assert.match(html, /Setup%200\.3\.0\.exe/);
  assert.match(html, /portable\.exe/);
  assert.match(html, /\.AppImage/);
  assert.match(html, /amd64\.deb/);
  assert.doesNotMatch(html, /latest\.yml/);
  assert.doesNotMatch(html, /blockmap/);
});

test('l’empreinte publiée est affichée', async () => {
  const html = await read('en/download/index.html');
  assert.match(html, /4Nc9jTUq2rkVnCcnbLXfCUX3HbfsNiE5aP5wJ1lz3rGZ5vT0m1B5CzQ8VwqLpXbJ0d2Q==/);
});

test('l’avertissement Windows est dit, pas tu', async () => {
  const html = await read('fr/download/index.html');
  assert.match(html, /Windows a protégé votre ordinateur/);
});

test('les tailles sont en chiffres arabes-indiens sur les pages arabes', async () => {
  // 98 566 144 octets → 94 Mo → ٩٤ م.ب. C'est le contrat de `translate` :
  // il convertit les nombres, jamais les chaînes.
  const arabic = await read('ar/download/index.html');
  assert.match(arabic, /٩٤ م\.ب/);
  const french = await read('fr/download/index.html');
  assert.match(french, /94 Mo/);
});

test('les dates aussi : une page arabe n’a qu’un système de chiffres', async () => {
  // `Intl.DateTimeFormat('ar')` rend « 1 أغسطس 2026 » — des chiffres latins au
  // milieu d'une phrase arabe, à deux lignes de tailles déjà converties. Deux
  // systèmes dans une même page se lisent comme une coquille, pas comme un
  // choix. `-u-nu-arab` demande les chiffres de la langue.
  const arabic = await read('ar/releases/index.html');
  assert.match(arabic, /١ أغسطس ٢٠٢٦/);
  assert.doesNotMatch(arabic, /1 أغسطس 2026/);
  // Le français et l'anglais ne bougent pas : leur locale n'a rien demandé.
  assert.match(await read('fr/releases/index.html'), /1 août 2026/);
  // Le numéro de version, lui, **reste latin** dans la même phrase, et ce
  // n'est pas un oubli : c'est un identifiant. Il nomme un tag, un fichier
  // (`Setup 0.3.0.exe`) et l'ancre `#v0.3.0` de cette page même ; on le
  // recopie dans un rapport de bug. La règle du projet tient en deux mots —
  // une quantité et une date se lisent donc se convertissent, un identifiant
  // se recopie donc ne se convertit jamais.
  assert.match(arabic, /id="v0\.3\.0"/);
});

test('les notes de version sont rendues dans la langue de la page', async () => {
  const arabic = await read('ar/releases/index.html');
  assert.match(arabic, /الإصدار العلني الأول/);
  const english = await read('en/releases/index.html');
  assert.match(english, /First public release/);
});

test('le contrat de données est écrit tel que la page le consomme', async () => {
  const index = JSON.parse(await read('releases.json'));
  assert.equal(index.latest.version, '0.3.0');
  assert.equal(index.latest.assets.length, 4);
  assert.ok(index.latest.notes.ar.length > 0);
});

/* ------------------------------------------------------------- Android ---- */

test('sans APK publié, Android est annoncé et aucun lien n’est fabriqué', async () => {
  // Le cas réel aujourd'hui : l'application Android existe, aucune chaîne ne
  // publie son APK. La plateforme doit se voir — sinon elle ne se distingue
  // pas d'une plateforme oubliée — et ne porter aucun lien.
  const html = await read('fr/download/index.html');
  assert.match(html, /data-platform="android"/);
  assert.match(html, /Pas encore publié/);
  assert.doesNotMatch(html, /\.apk/);
});

test('l’APK publié est proposé avec l’URL de la Release, jamais une URL devinée', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-apk-'));
  await build({
    out: path.join(scratch, 'dist'),
    dataDir: path.join(HERE, 'fixtures', 'data-apk'),
    books: 8568,
  });
  const html = await fs.readFile(
    path.join(scratch, 'dist', 'fr', 'download', 'index.html'),
    'utf8',
  );

  // La fixture nomme l'artefact `beyt-el-hikma-0.3.0.apk` et le publie sous
  // `renomme-a-la-main.apk` : seule l'URL de la Release doit paraître.
  assert.match(html, /renomme-a-la-main\.apk/);
  assert.doesNotMatch(html, /beyt-el-hikma-0\.3\.0\.apk"/);
  assert.match(html, /data-platform="android"/);
  assert.match(html, /Paquet APK/);
  assert.doesNotMatch(html, /Pas encore publié/);
  // 47 185 920 octets → 45 Mo.
  assert.match(html, /45 Mo/);
  // `.idsig` est un fichier d'outil : il ne se propose pas.
  assert.doesNotMatch(html, /idsig/);

  const index = JSON.parse(await fs.readFile(path.join(scratch, 'dist', 'releases.json'), 'utf8'));
  assert.equal(index.latest.assets.filter((asset) => asset.os === 'android').length, 1);
  await fs.rm(scratch, { recursive: true, force: true });
});

/* ------------------------------------------- le bouton suit le visiteur ---- */

/**
 * Le bouton de l'accueil portait « Télécharger pour Windows » à tout le monde,
 * y compris au visiteur venu d'un téléphone Android, et menait à la page de
 * téléchargement dans tous les cas.
 *
 * Ce qu'il porte maintenant est une **table rendue au build**, libellés déjà
 * traduits : le script désigne la ligne du système qu'il reconnaît, il ne
 * compose rien. Sans script, le `href` reste la page de téléchargement, où les
 * trois plateformes sont écrites — c'est la même règle que les cartes.
 */
test('le bouton de l’accueil porte un lien par plateforme publiée', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-cta-'));
  await build({
    out: path.join(scratch, 'dist'),
    dataDir: path.join(HERE, 'fixtures', 'data-apk'),
    books: 8568,
  });
  const html = await fs.readFile(path.join(scratch, 'dist', 'fr', 'index.html'), 'utf8');

  const raw = /data-cta-targets="([^"]*)"/.exec(html);
  assert.ok(raw, 'la table des liens doit être rendue');
  const targets = JSON.parse(raw[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));

  assert.match(targets.android.href, /renomme-a-la-main\.apk$/, 'l’URL est celle publiée');
  assert.match(targets.android.label, /Android/);
  assert.match(targets.windows.href, /\.exe$/);
  assert.match(targets.windows.label, /Windows/);

  // Sans script, le bouton mène à la page qui les nomme toutes : un lien qui
  // n'existe qu'après exécution d'un script manque le jour où il échoue.
  assert.match(html, /data-cta="primary"/);
  assert.match(html, new RegExp(`href="${BASE_PATH}fr/download/"`));

  await fs.rm(scratch, { recursive: true, force: true });
});

test('sans artefact pour une plateforme, le bouton ne fabrique aucun lien', async () => {
  // La fixture par défaut ne publie pas d'APK : Android ne doit pas figurer
  // dans la table. Une URL devinée serait un 404 différé, et le repli — la page
  // de téléchargement — dit « pas encore publié » au lieu de le promettre.
  const html = await read('fr/index.html');
  const raw = /data-cta-targets="([^"]*)"/.exec(html);
  assert.ok(raw, 'la table doit exister dès qu’une version est publiée');
  const targets = JSON.parse(raw[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.equal(targets.android, undefined);
  assert.ok(targets.windows && targets.linux, 'les deux plateformes exigées y sont');
});

test('la détection du système vit dans une seule fonction, Android avant Linux', async () => {
  // Un Android se présente comme Linux : tester Linux d'abord enverrait chaque
  // téléphone sur l'AppImage. La règle est dans l'ordre des tests, donc dans
  // une seule fonction — deux copies divergeraient au premier ajout.
  const script = await fs.readFile(path.join(HERE, '..', 'assets', 'site.js'), 'utf8');
  assert.equal(script.split('function detectOs(').length - 1, 1, 'une seule détection');
  assert.ok(
    script.indexOf("'android'") < script.indexOf("'linux'"),
    'Android doit être reconnu avant Linux',
  );
  // La table vient de l'API GitHub : un `javascript:` posé dans un `href` par
  // une donnée de build serait une exécution.
  assert.match(script, /\^https:\\\/\\\//, 'le lien appliqué doit être un https');
});

test('l’avertissement de signature de l’APK est dit dans les trois langues', async () => {
  // Il est dit là où l'on clique, dans la carte Android, et pas en note de bas
  // de page. Une langue qui l'oublierait laisserait un lecteur devant une
  // alerte d'Android sans explication.
  const expected = {
    fr: [/L’APK n’est pas signé/, /Installer quand même/],
    en: [/The APK is not signed/, /Install anyway/],
    ar: [/حزمة APK غير موقَّعة/, /التثبيت على أيّة حال/],
  };
  for (const [locale, patterns] of Object.entries(expected)) {
    const html = await read(`${locale}/download/index.html`);
    for (const pattern of patterns) assert.match(html, pattern, `manquant en ${locale}`);
  }
});

test('l’avertissement vit dans la carte de sa plateforme, pas dans le cahier de côté', async () => {
  // SmartScreen a longtemps vécu dans l'aside « configuration requise », où il
  // parlait de Windows à qui téléchargeait un .deb. Les deux avertissements
  // suivent maintenant la même règle, portée par `PLATFORMS[].notice`.
  const html = await read('fr/download/index.html');
  const windows = html.slice(html.indexOf('data-platform="windows"'), html.indexOf('data-platform="linux"'));
  assert.match(windows, /Windows a protégé votre ordinateur/);
  const android = html.slice(html.indexOf('data-platform="android"'));
  assert.match(android, /L’APK n’est pas signé/);
  assert.doesNotMatch(html.slice(html.indexOf('class="specs"')), /notice/);
});

test('les trois systèmes portent un tracé, et aucun n’est un logo de marque', async () => {
  const sprite = await fs.readFile(path.join(HERE, '..', 'assets', 'icons.svg'), 'utf8');
  for (const name of ['windows', 'linux', 'android']) {
    assert.match(sprite, new RegExp(`id="i-${name}"`), `tracé manquant : ${name}`);
  }
  // Monochromes et pilotés par le contexte : aucune couleur en dur, sinon un
  // tracé cesserait de suivre l'encre de la page.
  assert.doesNotMatch(sprite, /fill="#|stroke="#/);

  // Et ils sont bien posés sur les cartes, par `PLATFORMS[].icon`.
  const html = await read('en/download/index.html');
  for (const name of ['windows', 'linux', 'android']) {
    assert.match(html, new RegExp(`href="#i-${name}"`), `tracé non posé : ${name}`);
  }
});

test('l’accueil annonce Android au même rang, et dit ce qui n’est pas publié', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-accueil-'));
  await build({
    out: path.join(scratch, 'dist'),
    dataDir: path.join(HERE, 'fixtures', 'data'),
    books: 8568,
  });
  const html = await fs.readFile(path.join(scratch, 'dist', 'en', 'index.html'), 'utf8');

  assert.match(html, /Available for/);
  for (const name of ['Windows', 'Linux', 'Android']) {
    assert.match(html, new RegExp(`<span>${name}</span>`), `plateforme absente : ${name}`);
  }
  // La fixture ne porte pas d'APK : Android est là, et se dit « bientôt ».
  assert.match(html, /hero__platform--pending/);
  assert.match(html, /hero__soon">soon/);
  await fs.rm(scratch, { recursive: true, force: true });
});

test('sans version publiée, l’accueil ne liste aucune plateforme', async () => {
  // Le rappel et l'appel disent déjà « première version en préparation » :
  // répéter le fait trois fois, une par plateforme, ne l'apprend à personne.
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-sans-'));
  await build({
    out: path.join(scratch, 'dist'),
    dataDir: path.join(scratch, 'data'),
    books: 8568,
  });
  const html = await fs.readFile(path.join(scratch, 'dist', 'en', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /hero__platforms/);
  assert.match(html, /First release in preparation/);
  await fs.rm(scratch, { recursive: true, force: true });
});

test('une plateforme requise sans artefact fait échouer le build', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-partiel-'));
  const dataDir = path.join(scratch, 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(
    path.join(dataDir, 'releases.api.json'),
    JSON.stringify([
      {
        tag_name: 'v0.3.0',
        published_at: '2026-08-01T10:00:00Z',
        assets: [
          {
            name: 'Beyt El Hikma Setup 0.3.0.exe',
            browser_download_url: 'https://github.com/sfellah/beytelhikma/releases/download/v0.3.0/a.exe',
            size: 1,
          },
        ],
      },
    ]),
  );

  await assert.rejects(
    build({ out: path.join(scratch, 'dist'), dataDir, books: 8568 }),
    /aucun artefact pour : linux/,
  );
  await fs.rm(scratch, { recursive: true, force: true });
});

test('sans version publiée, la page de téléchargement le dit au lieu de mentir', async () => {
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'beyt-site-vide-'));
  await build({
    out: path.join(scratch, 'dist'),
    dataDir: path.join(scratch, 'data'),
    books: 8568,
  });
  const html = await fs.readFile(path.join(scratch, 'dist', 'fr', 'download', 'index.html'), 'utf8');
  assert.match(html, /Aucune version publiée/);
  assert.doesNotMatch(html, /releases\/download/);
  await fs.rm(scratch, { recursive: true, force: true });
});
