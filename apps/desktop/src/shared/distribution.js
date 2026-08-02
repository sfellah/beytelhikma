/**
 * Résolution d'une clé d'objet du catalogue vers une cible téléchargeable.
 *
 * Le catalogue ne stocke plus d'URL absolue : il porte une **clé relative**
 * (`books/sh-8/1/book.sqlite.zst`) qu'on colle derrière l'URL de base
 * configurée. C'est ce qui rend un même catalogue servable depuis AWS, depuis
 * un MinIO local ou depuis un CDN sans le republier — l'origine et le style
 * d'adressage vivent dans le réglage, jamais dans les données.
 *
 * Une seule exception, et elle est explicite : **la présence de `://` marque un
 * absolu**. Elle garde les jeux hors ligne (`asset://`, `local://`) utilisables
 * et rend la migration douce — un catalogue publié à l'ancienne, avec des URL
 * complètes, continue de fonctionner.
 *
 * Module pur : ni réseau, ni disque, ni état. C'est le seul endroit du code qui
 * sait qu'une base et une clé se collent.
 */

/** Bucket de distribution par défaut, utilisé tant que rien n'est configuré. */
export const DEFAULT_BASE_URL = 'https://beytelhima-library.s3.eu-west-1.amazonaws.com';

/**
 * Un schéma d'URI, pas n'importe quel `:` — `book.sqlite.zst` contient des
 * points et `books/sh-8/1/…` des barres sans être absolus pour autant.
 */
const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i;

export function isAbsoluteKey(objectKey) {
  return SCHEME.test(String(objectKey ?? ''));
}

/**
 * Valide une URL de base proposée par l'utilisateur. Rend la chaîne à stocker —
 * vide pour « revenir au défaut » — ou lève.
 *
 * C'est le réglage qui décide d'où viennent le catalogue **et** tous les
 * livres : il mérite plus qu'un `trim()`. En clair, un intermédiaire choisit
 * ce que l'application installe ; et le champ des réglages n'est pas dans un
 * `<form>`, donc son `type="url"` ne valide rien.
 *
 * `http` reste admis vers la **boucle locale**, et là seulement : c'est le
 * MinIO de développement, qui n'a pas de certificat et ne traverse aucun
 * réseau. L'interdire tout à fait ne fermerait rien de plus et couperait la
 * chaîne de publication locale.
 *
 * Le SHA-256 du catalogue reste la vraie défense — celle-ci ferme la porte
 * avant, pour que la vérification n'ait jamais à servir.
 */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function assertBaseUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return ''; // vide : le défaut reprend la main

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`adresse illisible : ${raw}`);
  }
  const local = url.protocol === 'http:' && LOOPBACK.has(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    throw new Error(`https exigé hors boucle locale : ${raw}`);
  }
  return url.toString().replace(/\/+$/, '');
}

/**
 * Renvoie la cible d'une clé.
 *
 *   { kind: 'http',    url }  -> à télécharger
 *   { kind: 'library', url }  -> à copier depuis la bibliothèque source
 */
export function resolveObject(baseUrl, objectKey) {
  const key = String(objectKey ?? '');
  const scheme = SCHEME.exec(key);

  if (scheme) {
    const protocol = scheme[1].toLowerCase();
    const kind = protocol === 'http' || protocol === 'https' ? 'http' : 'library';
    return { kind, url: key };
  }

  const base = String(baseUrl ?? '').trim() || DEFAULT_BASE_URL;
  return {
    kind: 'http',
    url: `${base.replace(/\/+$/, '')}/${key.replace(/^\/+/, '')}`,
  };
}
