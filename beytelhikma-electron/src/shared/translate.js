/**
 * L'interpolation d'une chaîne traduite, seule.
 *
 * Elle vit ici, sans DOM, pour être testable : `renderer/js/i18n.js` porte le
 * catalogue courant et la locale, ce module ne porte que la règle.
 *
 * Les nombres sont convertis **par** `translate`, jamais par l'appelant :
 * c'est ce qui garantit qu'aucune vue ne peut oublier la conversion. Une
 * chaîne, elle, passe intacte — c'est ce qui protège les chemins, les URL et
 * les sha256, qu'on copie pour rapporter un problème et qui n'ont rien à faire
 * en chiffres arabes.
 */
import { formatNumber } from './digits.js';

export function translate(catalog, key, params = {}, locale) {
  const template = catalog?.[key];
  // Clé manquante : on rend la clé. Elle se voit à l'écran, se cherche au
  // grep, et ne fait tomber aucune vue.
  if (typeof template !== 'string') return key;

  return template.replace(/\{(\w+)\}/g, (whole, name) => {
    if (!(name in params)) return whole;
    const value = params[name];
    return typeof value === 'number' ? formatNumber(value, locale) : String(value);
  });
}
