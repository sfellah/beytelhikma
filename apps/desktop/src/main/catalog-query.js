/**
 * Construction des requêtes d'exploration du catalogue. Ce module ne touche
 * aucune base : il ne fabrique que du SQL et des paramètres liés, ce qui le
 * rend testable sans fixture.
 *
 * Règle intangible : **aucune valeur ne rejoint le SQL par interpolation**. Les
 * seuls fragments littéraux sont des noms de colonnes issus des listes blanches
 * de ce fichier.
 */

import { POPULAR_EDITION_IDS } from '../shared/popular.js';

/** Tris autorisés. Toute autre valeur retombe sur le titre. */
export const SORTS = {
  title: 'e.title_ar',
  recent: 'r.published_at DESC, e.title_ar',
  pages: 'r.page_count DESC, e.title_ar',
  size: 'r.compressed_size DESC, e.title_ar',
};

/** Une page de résultats ne dépasse jamais cette taille. */
const MAX_LIMIT = 200;

const FROM = `
  FROM editions e
  LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
  WHERE e.is_hidden = 0 AND `;

const placeholders = (values) => values.map(() => '?').join(',');

/** Conditions d'une facette, ou `null` si elle n'est pas filtrée. */
function condition(key, query, installedIds) {
  const values = query[key];
  switch (key) {
    case 'categories':
      return values?.length ? [`e.category_id IN (${placeholders(values)})`, values] : null;
    case 'types':
      return values?.length ? [`e.book_type_label IN (${placeholders(values)})`, values] : null;
    case 'publishers':
      return values?.length ? [`e.publisher_ar IN (${placeholders(values)})`, values] : null;
    case 'authors':
      return values?.length
        ? [
            `e.edition_id IN (SELECT edition_id FROM edition_authors
                               WHERE author_id IN (${placeholders(values)}))`,
            values,
          ]
        : null;
    case 'centuries':
      return values?.length
        ? [
            `e.edition_id IN (
               SELECT ea.edition_id FROM edition_authors ea
               JOIN authors a ON a.author_id = ea.author_id
               WHERE a.death_year_hijri IS NOT NULL AND a.death_year_hijri > 0
                 AND (a.death_year_hijri - 1) / 100 + 1 IN (${placeholders(values)}))`,
            values,
          ]
        : null;
    case 'years': {
      const { from, to } = query.years ?? {};
      const parts = [];
      const params = [];
      if (from != null) {
        parts.push('e.publication_year >= ?');
        params.push(from);
      }
      if (to != null) {
        parts.push('e.publication_year <= ?');
        params.push(to);
      }
      return parts.length ? [parts.join(' AND '), params] : null;
    }
    case 'status': {
      if (query.status !== 'installed' && query.status !== 'missing') return null;
      // Sans aucun livre installé, les deux sens sont des constantes : une
      // clause `IN ()` vide est une erreur de syntaxe en SQLite.
      if (!installedIds.length) {
        return [query.status === 'installed' ? '1 = 0' : '1 = 1', []];
      }
      const operator = query.status === 'installed' ? 'IN' : 'NOT IN';
      return [`e.edition_id ${operator} (${placeholders(installedIds)})`, [...installedIds]];
    }
    case 'ids': {
      // Résultat de la recherche texte, résolue en amont contre l'index mémoire
      // des titres et des auteurs. `catalog_fts` n'est pas lisible ici : le
      // build sql.js embarqué ne contient pas le module FTS5.
      if (!Array.isArray(values)) return null;
      if (!values.length) return ['1 = 0', []];
      return [`e.edition_id IN (${placeholders(values)})`, values];
    }
    case 'popular':
      // Une **case à cocher**, pas une facette : elle n'a pas de valeurs à
      // compter. Elle est donc absente de `FACET_VALUE`, et `buildFacetQuery`
      // ne la retire jamais — la retirer ferait annoncer aux facettes des
      // livres que la liste exclut.
      //
      // La liste vient de `shared/popular.js` et n'est pas recopiée ici : les
      // vingt-trois identifiants partent en paramètres liés, comme tout le
      // reste de ce fichier.
      return query.popular
        ? [
            `e.edition_id IN (${placeholders(POPULAR_EDITION_IDS)})`,
            [...POPULAR_EDITION_IDS],
          ]
        : null;
    default:
      return null;
  }
}

const ALL_KEYS = [
  // La plus sélective d'abord : vingt-trois lignes sur 8 568.
  'popular',
  'ids',
  'categories',
  'types',
  'publishers',
  'authors',
  'centuries',
  'years',
  'status',
];

/** Contenu du `WHERE`, sans le mot-clé. [except] retire une facette. */
export function buildWhere(query, { installedIds = [] } = {}, except = null) {
  const parts = [];
  const params = [];
  for (const key of ALL_KEYS) {
    if (key === except) continue;
    const built = condition(key, query, installedIds);
    if (!built) continue;
    parts.push(`(${built[0]})`);
    params.push(...built[1]);
  }
  return { sql: parts.length ? parts.join(' AND ') : '1 = 1', params };
}

const SUMMARY_COLUMNS = `
  e.edition_id, e.work_id, e.title_ar, e.subtitle_ar, e.category_id,
  e.book_type_label, e.volume_count, e.language, e.cover_url,
  (SELECT label_ar FROM categories c WHERE c.category_id = e.category_id)  AS category_label,
  (SELECT COALESCE(a.short_name_ar, a.full_name_ar)
     FROM edition_authors ea JOIN authors a ON a.author_id = ea.author_id
    WHERE ea.edition_id = e.edition_id AND ea.role = 'author'
    ORDER BY ea.position LIMIT 1)                                          AS author_name,
  (SELECT a.death_year_hijri
     FROM edition_authors ea JOIN authors a ON a.author_id = ea.author_id
    WHERE ea.edition_id = e.edition_id AND ea.role = 'author'
    ORDER BY ea.position LIMIT 1)                                          AS author_death_year,
  r.page_count, r.published_at, r.compressed_size`;

export function buildList(query, options = {}) {
  const where = buildWhere(query, options);
  const order = SORTS[query.sort] ?? SORTS.title;
  const limit = Math.min(Math.max(Number(query.limit) || 40, 1), MAX_LIMIT);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return {
    sql: `SELECT ${SUMMARY_COLUMNS}${FROM}${where.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    params: [...where.params, limit, offset],
  };
}

export function buildCount(query, options = {}) {
  const where = buildWhere(query, options);
  return {
    sql: `SELECT COUNT(*) AS n, COALESCE(SUM(r.compressed_size), 0) AS bytes${FROM}${where.sql}`,
    params: where.params,
  };
}

/** Expression donnant la valeur d'une facette, par facette. */
const FACET_VALUE = {
  categories: 'e.category_id',
  types: 'e.book_type_label',
  publishers: 'e.publisher_ar',
  centuries: `(SELECT (a.death_year_hijri - 1) / 100 + 1
                 FROM edition_authors ea JOIN authors a ON a.author_id = ea.author_id
                WHERE ea.edition_id = e.edition_id
                  AND a.death_year_hijri IS NOT NULL AND a.death_year_hijri > 0
                ORDER BY ea.position LIMIT 1)`,
};

/** Compte par valeur d'une facette, son propre filtre retiré. */
export function buildFacetQuery(query, facetKey, options = {}) {
  const value = FACET_VALUE[facetKey];
  if (!value) throw new Error(`facette inconnue : ${facetKey}`);
  const where = buildWhere(query, options, facetKey);
  return {
    sql: `SELECT ${value} AS value, COUNT(*) AS n${FROM}${where.sql}
          GROUP BY value HAVING value IS NOT NULL ORDER BY n DESC`,
    params: where.params,
  };
}
