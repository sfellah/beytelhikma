/**
 * La bascule de langue de la racine, et rien d'autre.
 *
 * La page de racine liste déjà les trois langues : sans ce script, le visiteur
 * choisit lui-même. Le script ne fait que devancer un choix évident — il ne
 * doit jamais être la seule façon d'entrer dans le site.
 *
 * Un choix explicite fait depuis le sélecteur d'une page est retenu et
 * l'emporte sur la préférence du navigateur : quelqu'un qui lit l'arabe sur un
 * système anglais ne doit pas se faire renvoyer vers l'anglais à chaque visite.
 */
(function () {
  'use strict';

  var LOCALES = ['ar', 'fr', 'en'];
  var FALLBACK = 'ar';
  var KEY = 'beyt.site.locale';

  function stored() {
    try {
      var value = window.localStorage.getItem(KEY);
      return LOCALES.indexOf(value) === -1 ? null : value;
    } catch (error) {
      // Stockage refusé (navigation privée stricte) : on suit le navigateur.
      return null;
    }
  }

  function preferred() {
    var tags = navigator.languages || [navigator.language || ''];
    for (var index = 0; index < tags.length; index += 1) {
      var base = String(tags[index]).toLowerCase().split('-')[0];
      if (LOCALES.indexOf(base) !== -1) return base;
    }
    return FALLBACK;
  }

  var base = window.location.pathname.replace(/index\.html$/, '');
  if (base.slice(-1) !== '/') base += '/';

  window.location.replace(base + (stored() || preferred()) + '/');
})();
