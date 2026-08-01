/**
 * L'échappement et les quelques aides de rendu. Rien d'autre.
 *
 * `escapeHtml` échappe **aussi le guillemet droit et l'apostrophe**. C'est le
 * défaut exact relevé dans `tools/shamela/text.py` : un `escape()` qui laisse
 * passer `"` sort du texte sûr tant qu'il reste entre balises, et devient une
 * injection d'attribut dès qu'on l'interpole dans un `alt=` ou un `href=`. Ici
 * tout ce qui vient d'un CHANGELOG ou de l'API GitHub passe par cette fonction,
 * y compris dans des attributs.
 */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

/**
 * Une URL admise dans un `href`. Tout ce qui n'est pas `https:`, un chemin
 * relatif ou une ancre devient `#` : le contrat de données vient de l'API
 * GitHub, mais un fichier `releases.api.json` bricolé à la main ne doit pas
 * pouvoir poser un `javascript:` dans la page.
 */
export function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (/^https:\/\//i.test(raw) || /^[./#]/.test(raw)) return escapeHtml(raw);
  return '#';
}

/** `{ class: 'a', hidden: false, id: null }` → ` class="a"`. */
export function attrs(map) {
  return Object.entries(map)
    .filter(([, value]) => value !== null && value !== undefined && value !== false && value !== '')
    .map(([key, value]) => (value === true ? ` ${key}` : ` ${key}="${escapeHtml(value)}"`))
    .join('');
}

/**
 * Une icône du sprite, qui est **inséré dans la page** par le gabarit et non
 * chargé comme fichier. Material Symbols venait d'un CDN Google dans les
 * maquettes : une requête vers un tiers à chaque visite, pour douze glyphes. Un
 * sprite externe référencé en `<use href="fichier.svg#id">` aurait suffi, mais
 * Safari ne l'a jamais suivi ; en ligne, il est sûr partout.
 */
export function icon(name, { className = 'icon' } = {}) {
  return `<svg class="${escapeHtml(className)}" aria-hidden="true" focusable="false"><use href="#i-${escapeHtml(name)}"></use></svg>`;
}

/** Retire les lignes vides que produisent les `${cond ? … : ''}` dans les gabarits. */
export function compact(parts) {
  return parts.filter(Boolean).join('\n');
}
