import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const lire = (chemin) => readFileSync(fileURLToPath(new URL(chemin, import.meta.url)), 'utf8');

const source = lire('../src/renderer/js/views/reader.js');
const ar = lire('../src/renderer/js/locales/ar.js');
const en = lire('../src/renderer/js/locales/en.js');
const css = lire('../src/renderer/styles/views.css');

/** Le corps du panneau du sommaire, de sa signature à la méthode suivante. */
const panneau = () => {
  const debut = source.indexOf('#tocPanel(refs) {');
  const fin = source.indexOf("h(\n      'aside',", debut);
  assert.ok(debut > 0 && fin > debut, '#tocPanel introuvable');
  return source.slice(debut, fin);
};

test('la tranche montée tient dans un écran de téléphone', () => {
  // Quatre-vingts boutons, c'était une dizaine d'écrans de défilement avant
  // d'atteindre le pied du panneau ; certains livres du corpus portent des
  // dizaines de milliers d'entrées.
  const declaration = source.match(/const TOC_WINDOW = (\d+);/);
  assert.ok(declaration, 'TOC_WINDOW a disparu');
  assert.ok(
    Number(declaration[1]) <= 30,
    `TOC_WINDOW vaut ${declaration[1]} : la tranche ne se parcourt plus d’un pouce`,
  );
});

test('le sommaire entier reste en mémoire : seul le dessin est fenêtré', () => {
  // Le lecteur s'en sert pour nommer le chapitre de chaque page — le tronquer
  // à la source rendrait le ruban muet passé la trentième entrée.
  assert.match(source, /this\.#toc = toc;/);
  assert.ok(
    !/this\.#toc = toc\.slice\(/.test(source),
    'le sommaire est tronqué à la source, pas seulement au dessin',
  );
  assert.match(source, /this\.#tocByPage \?\?= new Map\(this\.#toc\.map\(/);
});

test('le reste se dit en toutes lettres, des deux côtés de la tranche', () => {
  const corps = panneau();
  assert.match(corps, /t\(key, \{ count: remaining \}\)/);
  assert.match(corps, /unfold\(from, growStart, 'reader\.tocRemainingBefore'\)/);
  assert.match(corps, /unfold\(matches\.length - to, growEnd, 'reader\.tocRemainingAfter'\)/);
});

test('le bouton n’annonce qu’un cran, jamais les milliers qui restent', () => {
  // Il ne déplie que TOC_WINDOW : lui faire annoncer tout le reste promettait
  // ce qu'un seul clic ne donne pas.
  assert.match(panneau(), /t\('reader\.showMore', \{ count: Math\.min\(TOC_WINDOW, remaining\) \}\)/);
});

test('les deux comptes passent par t(), jamais par un nombre écrit', () => {
  // `translate` convertit lui-même les nombres qu'on lui passe : c'est ce qui
  // empêche un chiffre latin d'apparaître dans une interface arabe.
  for (const [nom, catalogue] of [
    ['ar', ar],
    ['en', en],
  ]) {
    for (const cle of ['reader.tocRemainingBefore', 'reader.tocRemainingAfter']) {
      assert.ok(catalogue.includes(`'${cle}'`), `${cle} manque dans ${nom}.js`);
    }
  }
  assert.match(ar, /'reader\.tocRemainingAfter': '[^']*\{count\}[^']*'/);
  assert.match(en, /'reader\.tocRemainingAfter': '[^']*\{count\}[^']*'/);
});

test('l’ouverture reste centrée sur le chapitre lu, et un filtre n’est pas recentré', () => {
  const corps = panneau();
  // Deux règles déjà en place que le fenêtrage ne doit pas emporter.
  assert.match(corps, /const current = this\.#chapterEntry\(this\.#page\?\.pageId\);/);
  assert.match(corps, /apply\('', current \? Math\.max\(0, this\.#toc\.indexOf\(current\)\) : 0\)/);
  assert.match(corps, /if \(field\.value\) return;/);
  assert.match(corps, /const apply = \(term, center = 0\) =>/);
});

test('arriver au bord de la tranche en monte la suivante, sans viser un bouton', () => {
  const corps = panneau();
  // Le geste qu'attend une liste, c'est le défilement. Un bouton tous les
  // trente titres, ce n'est pas parcourir, c'est faire avancer à la main.
  assert.match(corps, /list\.addEventListener\('scroll', onScroll\)/);
  assert.match(corps, /list\.scrollTop <= TOC_EDGE && from > 0/);
  assert.match(corps, /reste <= TOC_EDGE && to < matches\.length/);
  assert.match(source, /const TOC_EDGE = \d+;/);
});

test('le dépliage vers le haut ne se rappelle pas lui-même', () => {
  // `growStart` rend au défilement la hauteur qu'il ajoute : il repose
  // `scrollTop`, donc il rappelle `onScroll`. Sans le drapeau, un seul geste
  // vers le haut monterait le sommaire entier.
  const corps = panneau();
  assert.match(corps, /let growing = false;/);
  assert.match(corps, /if \(growing\) return;\s*growing = true;/);
  assert.match(corps, /finally \{\s*growing = false;/);
});

test('une tranche qui ne remplit pas le panneau est complétée, mais pas sans borne', () => {
  // Sans défilement possible, `onScroll` n'arrive jamais : sur un grand écran
  // la liste s'arrêterait à trente titres, sans que rien ne le dise.
  const corps = panneau();
  assert.match(corps, /if \(list\.scrollHeight > list\.clientHeight\) return;/);
  assert.match(corps, /for \(let i = 0; i < 10 && to < matches\.length; i \+= 1\)/);
  assert.match(corps, /growEnd\(\);\s*fill\(\);/);
});

test('un bord sans reste ne laisse aucun nœud derrière lui', () => {
  // Un span vide gardait la réserve du bloc : une bande morte au pied du
  // panneau, sous la dernière entrée.
  const corps = panneau();
  assert.ok(!/: h\('span', \{\}\)/.test(corps), 'le bloc de dépliage laisse un nœud vide');
  assert.match(css, /\.reader__toc-more:empty[\s\S]{0,80}display: none;/);
});

test('le bloc de dépliage empile son compte au-dessus de son bouton', () => {
  const bloc = css.slice(css.indexOf('.reader__toc-more-inner {'));
  assert.ok(bloc.startsWith('.reader__toc-more-inner {'), '.reader__toc-more-inner a disparu');
  assert.match(bloc.slice(0, 200), /flex-direction: column;/);
  // Aucun alignement physique : le panneau bascule avec l'interface.
  assert.ok(!/\b(left|right):/.test(bloc.slice(0, 200)), 'alignement physique dans le bloc');
});
