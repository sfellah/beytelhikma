/**
 * Le seul script des pages de contenu. Trois gestes, tous facultatifs : retenir
 * la langue lue, mettre en avant la plateforme du visiteur, et pointer le
 * bouton de l'accueil sur le fichier qui lui convient.
 *
 * Amélioration progressive stricte : sans ce fichier la page reste complète.
 * Les trois langues sont dans l'en-tête, toutes les plateformes sont rendues au
 * build, et le bouton de l'accueil mène à la page de téléchargement, où les
 * trois sont écrites. Un bouton de téléchargement qui n'existerait qu'après
 * exécution d'un script serait une page de téléchargement qui ne télécharge
 * rien le jour où le script échoue.
 */
(function () {
  'use strict';

  var LOCALES = ['ar', 'fr', 'en'];
  var KEY = 'beyt.site.locale';

  // --- retenir la langue lue ---------------------------------------------
  // C'est ce qui permet à la racine de respecter un choix explicite plutôt que
  // la préférence du système : quelqu'un qui lit l'arabe sur un système anglais
  // ne doit pas être renvoyé vers l'anglais à chaque visite.
  var lang = document.documentElement.getAttribute('lang');
  if (LOCALES.indexOf(lang) !== -1) {
    try {
      window.localStorage.setItem(KEY, lang);
    } catch (error) {
      // Stockage refusé : la racine suivra le navigateur. Sans conséquence.
    }
  }

  /**
   * Le système du visiteur, ou `null` quand aucune réponse n'est sûre.
   *
   * Une seule fonction pour les deux pages : c'est l'ordre des tests qui porte
   * la règle, et deux copies divergeraient au premier ajout de plateforme.
   *
   * iOS n'a aucun build, et n'en aura pas tant que rien ne le construit : sur
   * un iPhone, aucune carte n'est la bonne, et en mettre une en avant serait
   * une recommandation fausse.
   *
   * Aucune détection d'architecture : les cibles publiées sont x86-64 pour le
   * bureau et une archive unique pour Android. Deviner `arm64` pour proposer un
   * binaire qui n'existe pas ne rendrait service à personne.
   */
  function detectOs() {
    var agent = String(navigator.userAgent || '');
    if (/iphone|ipad|ipod/i.test(agent)) return null;

    var hinted = navigator.userAgentData && navigator.userAgentData.platform;
    var haystack = String(hinted || agent).toLowerCase();
    // Android **avant** Linux, et l'ordre est tout : un Android se présente
    // comme Linux, donc tester Linux d'abord enverrait chaque téléphone sur
    // l'AppImage.
    if (haystack.indexOf('android') !== -1) return 'android';
    if (haystack.indexOf('win') === 0 || haystack.indexOf('windows') !== -1) return 'windows';
    if (haystack.indexOf('linux') !== -1 || haystack.indexOf('x11') !== -1) return 'linux';
    if (haystack.indexOf('mac') !== -1) return 'macos';
    return null;
  }

  var os = detectOs();
  if (!os) return;

  // --- l'accueil : le bouton mène au fichier du visiteur -------------------
  // La table est rendue au build, libellés déjà traduits : le script désigne,
  // il ne compose pas. Une plateforme absente de la table n'a pas d'artefact
  // dans cette version — le bouton garde alors la page de téléchargement, qui
  // dit « pas encore publiée » au lieu de promettre un fichier inexistant.
  var cta = document.querySelector('[data-cta-targets]');
  if (cta) {
    var targets = null;
    try {
      targets = JSON.parse(cta.getAttribute('data-cta-targets'));
    } catch (error) {
      targets = null;
    }
    var target = targets && targets[os];
    // `https:` exigé : la table vient de l'API GitHub, et un `javascript:`
    // posé dans un `href` par une donnée de build serait une exécution.
    if (target && /^https:\/\//i.test(String(target.href))) {
      cta.setAttribute('href', target.href);
      var label = cta.querySelector('[data-cta-label]');
      if (label && target.label) label.textContent = target.label;
    }
  }

  // --- la page de téléchargement : la carte du visiteur en tête ------------
  var container = document.querySelector('[data-platforms]');
  if (!container) return;

  // La carte peut être celle d'une plateforme pas encore publiée : la remonter
  // reste juste. « Voici votre système, et il n'est pas encore sorti » est une
  // réponse ; laisser chercher au bas de la page n'en est pas une.
  var card = container.querySelector('[data-platform="' + os + '"]');
  if (!card) return;

  card.classList.add('platform--mine');
  container.insertBefore(card, container.firstElementChild);

  var recommended = container.getAttribute('data-recommended');
  if (recommended) {
    var chip = document.createElement('p');
    chip.className = 'platform__recommended';
    chip.textContent = recommended;
    card.insertBefore(chip, card.firstElementChild);
  }
})();
