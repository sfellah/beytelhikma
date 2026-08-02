/**
 * Le panneau de mesures de l'exemple Capacitor.
 *
 * Un exemple qui affirme « c'est rapide » ne prouve rien ; celui-ci affiche des
 * chiffres relevés sur l'appareil, à côté de l'écran qu'ils décrivent. Une
 * ligne par mesure : ce qui a été mesuré, en combien de temps, et le détail —
 * c'est le détail qui porte le verdict FTS5, le seul résultat qui décide.
 *
 * Module autonome, sans dépendance : le rendu n'a pas de bundler, et la sonde
 * doit pouvoir être chargée avant `app.js` sans rien attendre de lui. Le shim
 * l'appelle défensivement (`globalThis.__probe?.record(…)`) : ne pas la charger
 * ne casse rien, ça retire seulement les mesures.
 */

/** Mesures reçues, dans l'ordre d'arrivée. */
const mesures = [];

/** Le corps de la liste, une fois le panneau monté. Nul avant. */
let corps = null;
let compteur = null;

// --------------------------------------------------------------- la feuille

/**
 * Une `CSSStyleSheet` **construite**, pas une balise `<style>`.
 *
 * La CSP de l'application est `default-src 'none'; script-src 'self'; style-src
 * 'self'` : une balise `<style>` injectée est du style en ligne et se fait
 * refuser, un attribut `style=` aussi. Une feuille bâtie par le code ne passe
 * pas par l'analyseur de document et n'en relève donc pas — c'est exactement
 * le détour que `src/renderer/js/user-fonts.js` fait déjà pour ses `@font-face`.
 */
const CSS = `
.probe-host {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  /* L'hôte couvre l'écran pour placer le panneau ; il ne doit donc rien
     capter. Sans cette ligne, une sélection de texte dans le lecteur — le
     geste que ce portage existe pour rendre possible — serait avalée par une
     surface transparente. Seul le panneau lui-même reprend les événements. */
  pointer-events: none;
}

.probe {
  position: absolute;
  inset-block-start: 8px;
  inset-inline-start: 8px;
  pointer-events: auto;
  /* Des chiffres qu'on recopie dans un rapport : latins, alignés à gauche,
     lus de gauche à droite — l'interface, elle, peut être en RTL. */
  direction: ltr;
  max-width: min(92vw, 460px);
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(16, 18, 20, 0.92);
  color: #eef1f3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  line-height: 1.35;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.probe__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: rgba(255, 255, 255, 0.06);
}

.probe__title {
  font-weight: 700;
  letter-spacing: 0.04em;
}

.probe__count {
  color: #9aa4ac;
  margin-inline-end: auto;
}

.probe__toggle {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.24);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 2px 8px;
  cursor: pointer;
}

.probe__body {
  margin: 0;
  padding: 4px 0;
  list-style: none;
  overflow: auto;
}

/* Replié : le panneau masque le lecteur, et le lecteur est ce qu'on regarde. */
.probe--replie .probe__body {
  display: none;
}

.probe__row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  column-gap: 8px;
  padding: 3px 8px;
  border-block-start: 1px solid rgba(255, 255, 255, 0.06);
}

.probe__label {
  color: #cfd6db;
  overflow-wrap: anywhere;
}

.probe__ms {
  color: #7fd4a2;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.probe__detail {
  grid-column: 1 / -1;
  color: #98a2aa;
  overflow-wrap: anywhere;
}

/* Un échec est un résultat, pas une panne : il doit se lire d'un coup d'œil. */
.probe__row[data-etat='ko'] .probe__label,
.probe__row[data-etat='ko'] .probe__detail {
  color: #ffb4a2;
}
`;

function poserFeuille() {
  try {
    const feuille = new CSSStyleSheet();
    feuille.replaceSync(CSS);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, feuille];
    return true;
  } catch {
    // Moteur sans feuilles construites : on se passe de l'habillage plutôt que
    // d'injecter du style que la CSP refuserait de toute façon.
    return false;
  }
}

// ------------------------------------------------------------- le rendu

/** Chiffres latins, et une précision qui suit l'ordre de grandeur. */
function millisecondes(valeur) {
  const ms = Number(valeur) || 0;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  return `${ms.toFixed(2)} ms`;
}

function ligne({ label, millis, detail }) {
  const li = document.createElement('li');
  li.className = 'probe__row';
  // Heuristique assumée : le shim écrit « échec — <message> » quand une sonde
  // rate. C'est la seule chose qu'on colore, et se tromper ne coûte qu'une
  // teinte.
  if (/^échec|\bko\b/i.test(String(detail ?? ''))) li.dataset.etat = 'ko';

  const nom = document.createElement('span');
  nom.className = 'probe__label';
  nom.textContent = label;

  const temps = document.createElement('span');
  temps.className = 'probe__ms';
  // Une mesure à zéro est une ligne de synthèse, pas un temps : l'afficher
  // comme « 0.00 ms » ferait croire à une opération instantanée.
  temps.textContent = millis > 0 ? millisecondes(millis) : '—';

  li.append(nom, temps);

  if (detail) {
    const texte = document.createElement('span');
    texte.className = 'probe__detail';
    texte.textContent = String(detail);
    li.append(texte);
  }
  return li;
}

function monter() {
  if (corps || !document.body) return;
  poserFeuille();

  const hote = document.createElement('div');
  hote.className = 'probe-host';

  const panneau = document.createElement('div');
  panneau.className = 'probe';
  // Le panneau est un outil de mesure posé par-dessus l'application : il ne
  // fait pas partie de l'arbre que lit un lecteur d'écran.
  panneau.setAttribute('aria-hidden', 'true');

  const tete = document.createElement('div');
  tete.className = 'probe__head';

  const titre = document.createElement('span');
  titre.className = 'probe__title';
  titre.textContent = 'sonde';

  compteur = document.createElement('span');
  compteur.className = 'probe__count';

  const bouton = document.createElement('button');
  bouton.className = 'probe__toggle';
  bouton.type = 'button';
  bouton.textContent = 'replier';
  bouton.addEventListener('click', () => {
    const replie = panneau.classList.toggle('probe--replie');
    bouton.textContent = replie ? 'déplier' : 'replier';
  });

  tete.append(titre, compteur, bouton);

  corps = document.createElement('ol');
  corps.className = 'probe__body';

  panneau.append(tete, corps);
  hote.append(panneau);
  document.body.append(hote);

  // Tout ce qui est arrivé avant que le corps existe : le shim mesure
  // l'ouverture du catalogue, qui peut précéder le premier rendu.
  for (const mesure of mesures) corps.append(ligne(mesure));
  peindreCompteur();
}

function peindreCompteur() {
  if (compteur) compteur.textContent = `${mesures.length} mesure(s)`;
}

// ------------------------------------------------------------- la sonde

globalThis.__probe = {
  /**
   * Note une mesure. Appelée depuis `repository.capacitor.js`, toujours de
   * façon facultative : la sonde n'est pas une dépendance du shim.
   */
  record(label, millis, detail = '') {
    const mesure = { label: String(label), millis: Number(millis) || 0, detail };
    mesures.push(mesure);
    if (corps) {
      corps.append(ligne(mesure));
      peindreCompteur();
    }
    // Le journal survit à un panneau qu'on aurait replié, et se relit par
    // `adb logcat` quand l'écran ne se laisse pas photographier.
    console.log(`[sonde] ${mesure.label} ${millisecondes(mesure.millis)} ${detail}`);
    return mesure;
  },

  /** Les mesures brutes, pour les recopier depuis la console. */
  list() {
    return mesures.map(({ label, millis, detail }) => ({ label, millis, detail }));
  },
};

if (document.body) monter();
else document.addEventListener('DOMContentLoaded', monter, { once: true });
