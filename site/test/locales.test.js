/**
 * La parité des catalogues, et l'interdiction d'un texte arabe écrit en dur
 * dans un gabarit — même règle et même raison que
 * `apps/desktop/test/no-hardcoded-strings.test.js` : sans ce test, la
 * prochaine section réintroduirait une chaîne non traduite, et le défaut ne se
 * verrait qu'en changeant de langue, c'est-à-dire jamais pendant le travail.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { PLATFORMS, SITE_LOCALES } from '../config.mjs';
import ar from '../locales/ar.mjs';
import en from '../locales/en.mjs';
import fr from '../locales/fr.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const CATALOGS = { ar, fr, en };

/** Tout ce qui peut citer une clé : gabarits, bibliothèque, build, script de page. */
async function sources() {
  const files = [
    'build.mjs',
    'config.mjs',
    'release-notes.mjs',
    'serve.mjs',
    ...(await fs.readdir(path.join(ROOT, 'templates'))).map((name) => `templates/${name}`),
    ...(await fs.readdir(path.join(ROOT, 'lib'))).map((name) => `lib/${name}`),
    ...(await fs.readdir(path.join(ROOT, 'assets')))
      .filter((name) => name.endsWith('.js'))
      .map((name) => `assets/${name}`),
  ];
  const read = await Promise.all(
    files.map((name) => fs.readFile(path.join(ROOT, name), 'utf8')),
  );
  return read.join('\n');
}

test('les trois catalogues portent exactement les mêmes clés', () => {
  const reference = Object.keys(fr).sort();
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    assert.deepEqual(Object.keys(catalog).sort(), reference, `écart de clés en ${locale}`);
  }
});

test('aucune valeur vide', () => {
  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    for (const [key, value] of Object.entries(catalog)) {
      assert.equal(typeof value, 'string', `${locale}/${key} n'est pas une chaîne`);
      assert.ok(value.trim().length > 0, `${locale}/${key} est vide`);
    }
  }
});

test('les mêmes paramètres apparaissent dans les trois langues', () => {
  // Un `{version}` oublié dans une traduction donne une phrase amputée, jamais
  // une erreur : `translate` laisse la clé manquante telle quelle.
  const params = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(fr)) {
    const reference = params(fr[key]);
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      assert.deepEqual(params(catalog[key]), reference, `paramètres différents pour ${key} en ${locale}`);
    }
  }
});

test('la liste des locales du site est celle des fichiers présents', async () => {
  const files = await fs.readdir(path.join(HERE, '..', 'locales'));
  assert.deepEqual(
    files.filter((name) => name.endsWith('.mjs')).sort(),
    SITE_LOCALES.map((locale) => `${locale.key}.mjs`).sort(),
  );
});

test('aucune clé du catalogue n’est un reste', async () => {
  // Même règle et même raison que `apps/desktop/test/i18n.test.js` : une clé que
  // plus personne n'appelle survit indéfiniment, et on la traduit encore trois
  // fois à chaque relecture. Le site en portait six — `site.tagline`,
  // `download.other`, `download.size`, `footer.source`, et le couple
  // `download.checksum.copy`/`.copied` d'un bouton « copier l'empreinte » qui
  // n'a jamais été posé. Dix-huit chaînes à tenir pour rien.
  //
  // Quatre familles se bâtissent à l'exécution et ne peuvent donc pas se citer
  // en clair. Comme dans l'application, **l'exemption est adossée à son
  // gabarit** : on vérifie que le littéral qui la bâtit est encore là. Une
  // liste d'exceptions nue survivrait au code qu'elle excuse.
  const source = await sources();
  const familles = [
    ['platform.', 't(`platform.${'],
    ['asset.', 't(`asset.${'],
    ['changelog.', 't(`changelog.${'],
    // `smartscreen.*` et `apk.unsigned.*` : le couple `.heading`/`.body` est
    // désigné par `PLATFORMS[].notice`, jamais nommé dans le gabarit.
    ...PLATFORMS.filter((platform) => platform.notice).map((platform) => [
      `${platform.notice}.`,
      't(`${key}.heading`)',
    ]),
  ];
  for (const [prefixe, gabarit] of familles) {
    assert.ok(
      source.includes(gabarit),
      `la famille ${prefixe}* est exemptée pour un gabarit qui n'existe plus : ${gabarit}`,
    );
  }

  const restes = Object.keys(fr).filter(
    (key) =>
      !source.includes(key) && !familles.some(([prefixe]) => key.startsWith(prefixe)),
  );
  assert.deepEqual(restes, [], 'clés que plus aucune source n’appelle');
});

test('le colophon nomme les caractères que sa propre page compose', async () => {
  // Un colophon dit « en quels caractères il est composé ». C'est la seule
  // phrase du site qui ne puisse pas être approximative — et elle l'était : les
  // trois langues annonçaient « EB Garamond, Literata et Amiri » alors que la
  // coupure display/texte de l'arabe a confié le texte courant à IBM Plex Sans
  // Arabic. Une page arabe ne charge donc **ni** EB Garamond **ni** Literata
  // (leurs `unicode-range` sont latins), et la face qui pose chacun de ses mots
  // n'était pas nommée ; une page latine, elle, compose toute sa voix de marge
  // en Plex sans le dire non plus.
  //
  // La vérité est dans la feuille : les trois voix y sont déclarées une fois au
  // `:root` et redéclarées pour l'arabe. On les relit, on n'en tient pas une
  // seconde liste.
  const css = await fs.readFile(path.join(ROOT, 'styles', 'site.css'), 'utf8');
  const bloc = (selecteur) => {
    const debut = css.indexOf(selecteur);
    assert.notEqual(debut, -1, `bloc introuvable : ${selecteur}`);
    return css.slice(debut, css.indexOf('}', debut));
  };
  const premiere = (source, axe) => source.match(new RegExp(`${axe}:\\s*'([^']+)'`))?.[1];

  const racine = bloc(':root {');
  const arabe = bloc("html[lang='ar'] {");
  const voix = (source, axe) => premiere(source, axe) ?? premiere(racine, axe);
  const composees = {
    ar: new Set(['--title', '--text', '--margin-voice'].map((axe) => voix(arabe, axe))),
    fr: new Set(['--title', '--text', '--margin-voice'].map((axe) => voix(racine, axe))),
  };
  composees.en = composees.fr;

  // Le nom d'une face se dit dans l'écriture de la page : « أميري » en arabe
  // est le nom d'Amiri, pas une autre fonte. C'est la même règle que le
  // `specimen` de `shared/fonts.js` côté application.
  const NOMS = {
    Amiri: /Amiri|أميري/,
    Literata: /Literata/,
    'EB Garamond': /EB Garamond/,
    'IBM Plex Sans Arabic': /IBM Plex Sans Arabic/,
    'Noto Naskh Arabic': /Noto Naskh Arabic/,
    'Source Serif 4': /Source Serif/,
  };

  for (const [locale, catalog] of Object.entries(CATALOGS)) {
    const phrase = catalog['colophon.typefaces'];
    for (const [face, motif] of Object.entries(NOMS)) {
      const attendue = composees[locale].has(face);
      assert.equal(
        motif.test(phrase),
        attendue,
        attendue
          ? `le colophon ${locale} tait ${face}, qui compose pourtant la page`
          : `le colophon ${locale} annonce ${face}, que la page ne charge jamais`,
      );
    }
  }
});

test('aucun gabarit ne porte de texte arabe en dur', async () => {
  const dir = path.join(HERE, '..', 'templates');
  const arabic = /[؀-ۿ]/;
  for (const name of await fs.readdir(dir)) {
    const source = await fs.readFile(path.join(dir, name), 'utf8');
    const offenders = source
      .split('\n')
      .map((line, index) => [index + 1, line])
      .filter(([, line]) => arabic.test(line) && !line.trim().startsWith('*'));
    assert.deepEqual(offenders, [], `texte arabe en dur dans templates/${name}`);
  }
});
