/**
 * Le seul script des pages de contenu. Deux gestes, tous deux facultatifs :
 * retenir la langue lue, et mettre en avant la plateforme du visiteur.
 *
 * Amélioration progressive stricte : sans ce fichier la page reste complète.
 * Les trois langues sont dans l'en-tête, toutes les plateformes sont rendues au
 * build. Un bouton de téléchargement qui n'existerait qu'après exécution d'un
 * script serait une page de téléchargement qui ne télécharge rien le jour où le
 * script échoue.
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

  // --- mettre en avant la plateforme du visiteur --------------------------
  var container = document.querySelector('[data-platforms]');
  if (!container) return;

  // iOS n'a aucun build, et n'en aura pas tant que rien ne le construit : sur
  // un iPhone, aucune carte n'est la bonne, et en mettre une en avant serait
  // une recommandation fausse.
  var agent = String(navigator.userAgent || '');
  if (/iphone|ipad|ipod/i.test(agent)) return;

  // Aucune détection d'architecture : les cibles publiées sont x86-64 pour le
  // bureau et une archive unique pour Android. Deviner `arm64` pour proposer un
  // binaire qui n'existe pas ne rendrait service à personne.
  var hinted = navigator.userAgentData && navigator.userAgentData.platform;
  var haystack = String(hinted || agent).toLowerCase();
  var os = null;
  // Android **avant** Linux, et l'ordre est tout : un Android se présente comme
  // Linux, donc tester Linux d'abord enverrait chaque téléphone sur l'AppImage.
  if (haystack.indexOf('android') !== -1) os = 'android';
  else if (haystack.indexOf('win') === 0 || haystack.indexOf('windows') !== -1) os = 'windows';
  else if (haystack.indexOf('linux') !== -1 || haystack.indexOf('x11') !== -1) os = 'linux';
  else if (haystack.indexOf('mac') !== -1) os = 'macos';
  if (!os) return;

  // La carte peut être celle d'une plateforme pas encore publiée : la remonter
  // reste juste. « Voici votre système, et il n'est pas encore sorti » est une
  // réponse ; laisser chercher au bas de la page n'en est pas une.

  var card = container.querySelector('[data-platform="' + os + '"]');
  if (!card) return;

  card.classList.add('platform--mine');
  container.insertBefore(card, container.firstElementChild);

  var label = container.getAttribute('data-recommended');
  if (label) {
    var chip = document.createElement('p');
    chip.className = 'platform__recommended';
    chip.textContent = label;
    card.insertBefore(chip, card.firstElementChild);
  }
})();
