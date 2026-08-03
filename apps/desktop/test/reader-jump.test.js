import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = readFileSync(
  fileURLToPath(new URL('../src/renderer/js/views/reader.js', import.meta.url)),
  'utf8',
);

/** Le corps d'une méthode, de sa signature à la suivante. */
function methode(nom, suivante) {
  const debut = source.indexOf(nom);
  const fin = source.indexOf(suivante, debut);
  assert.ok(debut > 0 && fin > debut, `${nom} introuvable, ou ${suivante} ne la suit plus`);
  return source.slice(debut, fin);
}

/** ------------------------------------------------------------------ la jauge */

test('la jauge ne tourne les pages qu’au relâchement', () => {
  const rail = source.slice(source.indexOf("class: 'reader__rail'"), source.indexOf('const previous ='));
  // À chaque cran, elle montait la page : sur mille pages, une glissade au
  // pouce, ce sont des dizaines de `getPages` — chacun un aller-retour du pont
  // natif sur Android — pour un seul écran regardé.
  assert.match(rail, /oninput: \(event\) => this\.#previewJump/);
  assert.match(rail, /onchange: \(event\) => this\.#commitJump/);
  assert.ok(!/oninput:[^\n]*#show\(/.test(rail), 'la jauge monte encore une page à chaque cran');
});

test('la destination s’annonce sans monter la page', () => {
  const apercu = methode('#previewJump(index) {', '#commitJump(index) {');
  assert.ok(!apercu.includes('#pageAt'), 'l’aperçu charge la page qu’il annonce');
  assert.ok(!apercu.includes('this.#show('), 'l’aperçu monte la page qu’il annonce');
  // Le rang, pas l'identifiant : la destination n'est pas chargée, on ne
  // connaît d'elle que sa place dans le livre.
  assert.match(apercu, /#chapterEntry\(target \+ 1, 'pageSequenceNum'\)/);
  // Le ruban suit la poignée, sinon la fraction ment tant qu'on n'a pas lâché.
  assert.match(apercu, /pagerCurrent\.textContent/);
});

test('deux montées qui se chevauchent : la dernière gagne', () => {
  const show = methode('async #show(index, {', '#restoreAnchor(page) {');
  // `#pageAt` peut attendre une fenêtre de vingt pages. Sans jeton, deux
  // appels se posaient dans le désordre et la page affichée n'était plus celle
  // qu'on venait de demander. C'est la panne que `router.js` a déjà réglée.
  assert.match(show, /const mine = \+\+this\.#showToken;/);
  const attente = show.indexOf('await this.#pageAt(index)');
  const garde = show.indexOf('mine !== this.#showToken');
  assert.ok(attente > 0 && garde > attente, 'le jeton est relu avant l’attente, donc jamais');
});

/** ------------------------------------------------------- revenir d’où l’on vient */

test('tout saut retient d’où il part', () => {
  const saut = methode('async #goToPage(pageId, {', '#scrollRatio() {');
  assert.match(saut, /this\.#rememberOrigin\(\);/);
  // Retenu **avant** l'attente : après, `#page` est déjà la destination.
  const memoire = saut.indexOf('#rememberOrigin()');
  const requete = saut.indexOf('await repository.getPageById');
  assert.ok(memoire < requete, 'le point de départ est relevé après être parti');
});

test('une seule mémoire, jamais une pile', () => {
  const memoire = methode('#rememberOrigin() {', '#hideReturn() {');
  // Après deux sauts d'affilée, ce qu'on veut retrouver est le dernier endroit
  // **lu**, pas le premier chapitre par lequel on est passé. Une pile
  // promettrait un chemin qu'on n'a pas parcouru.
  assert.match(memoire, /this\.#origin = \{/);
  assert.ok(!/push\(/.test(memoire), 'le point de départ s’empile');
  // Le retour rend l'endroit exact, pas seulement la page.
  const retour = methode('#goToOrigin() {', '/**');
  assert.match(retour, /ratio: origin\.ratio/);
});

/** --------------------------------------------------------------- occurrences */

test('un résultat de recherche amène son occurrence à l’écran', () => {
  // Sans cela, la page s'ouvrait en haut, l'occurrence pouvait être trois
  // écrans plus bas, et la page paraissait ne rien contenir.
  const resultats = source.slice(
    source.indexOf('results.replaceChildren('),
    source.indexOf('#applyHighlight(root) {'),
  );
  const sauts = resultats.match(/#goToPage\(entry\.pageId[^)]*\)/g) ?? [];
  assert.equal(sauts.length, 2, 'les deux familles de résultats ne sautent plus de la même façon');
  for (const saut of sauts) assert.match(saut, /focusMatch: true/);
});

test('le parcours des occurrences boucle sur la page', () => {
  const pas = methode('#stepMatch(sens) {', '#pageAt(index)');
  assert.match(pas, /\(this\.#matchAt \+ sens \+ total\) % total/);
  assert.match(pas, /scrollIntoView\(\{ block: 'center'/);
  // Le compteur ne désigne rien à l'écran si l'occurrence visée ne se
  // distingue pas des autres.
  assert.match(pas, /classList\.add\('is-current'\)/);
});

test('la pastille ne s’ouvre que s’il y a un parcours à faire', () => {
  const sync = methode('#syncMatches() {', '#stepMatch(sens) {');
  // Une occurrence unique n'a pas de « suivante » : deux chevrons inertes
  // demandent deux fois avant qu'on les croie voulus.
  assert.match(sync, /total > 1/);
});

/** ------------------------------------------------------------------ sommaire */

test('le sommaire s’ouvre sur le chapitre qu’on lit', () => {
  assert.match(source, /if \(opened && which === 'toc'\) this\.#nodes\.focusToc\?\.\(\);/);
  const focus = methode('refs.focusToc = () => {', "apply('');");
  assert.match(focus, /#chapterEntry\(this\.#page\?\.pageId\)/);
  assert.match(focus, /scrollIntoView\(\{ block: 'center' \}\)/);
  // Un filtre en cours est une question de l'utilisateur : la recentrer sur le
  // chapitre courant effacerait sa réponse.
  assert.match(focus, /if \(field\.value\) return;/);
});

test('le chapitre courant se marque, et la tranche s’ouvre autour de lui', () => {
  assert.match(source, /' is-current'/);
  const apply = methode('const apply = (term, center = 0)', 'let timer = null;');
  // Ouvrir le sommaire au chapitre 400 sur 3 000 ne doit pas monter les 399
  // d'avant : la tranche se centre, et deux boutons déplient de part et d'autre.
  assert.match(apply, /center - Math\.floor\(TOC_WINDOW \/ 2\)/);
  assert.match(source, /const growStart = \(\) => \{/);
});
