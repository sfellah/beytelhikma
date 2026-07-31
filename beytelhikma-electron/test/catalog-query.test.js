import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCount, buildFacetQuery, buildList, buildWhere } from '../src/main/catalog-query.js';

const none = { installedIds: [] };

test('une requête vide ne pose aucune condition', () => {
  const { sql, params } = buildWhere({}, none);
  assert.equal(sql, '1 = 1');
  assert.deepEqual(params, []);
});

test('les valeurs d’une facette sont en OU, les facettes en ET', () => {
  const { sql, params } = buildWhere({ categories: [12, 15], types: ['كتاب'] }, none);
  assert.match(sql, /e\.category_id IN \(\?,\?\)/);
  assert.match(sql, /e\.book_type_label IN \(\?\)/);
  assert.equal((sql.match(/ AND /g) ?? []).length, 1);
  assert.deepEqual(params, [12, 15, 'كتاب']);
});

test('aucune valeur n’est interpolée dans le SQL', () => {
  const hostile = "'; DROP TABLE editions; --";
  const { sql, params } = buildWhere({ types: [hostile], publishers: [hostile] }, none);
  assert.equal(sql.includes('DROP'), false);
  assert.deepEqual(params, [hostile, hostile]);
});

test('la plage d’années accepte une borne seule', () => {
  assert.deepEqual(buildWhere({ years: { from: 1990 } }, none).params, [1990]);
  assert.deepEqual(buildWhere({ years: { to: 2010 } }, none).params, [2010]);
  assert.deepEqual(buildWhere({ years: { from: 1990, to: 2010 } }, none).params, [1990, 2010]);
});

test('le statut se filtre par liste d’identifiants installés', () => {
  const installed = { installedIds: ['ed-a', 'ed-b'] };
  const yes = buildWhere({ status: 'installed' }, installed);
  assert.match(yes.sql, /e\.edition_id IN \(\?,\?\)/);
  assert.deepEqual(yes.params, ['ed-a', 'ed-b']);

  const no = buildWhere({ status: 'missing' }, installed);
  assert.match(no.sql, /e\.edition_id NOT IN \(\?,\?\)/);

  // Rien d'installé : « installés » ne renvoie rien, « manquants » renvoie tout.
  assert.equal(buildWhere({ status: 'installed' }, none).sql, '(1 = 0)');
  assert.equal(buildWhere({ status: 'missing' }, none).sql, '(1 = 1)');
});

test('le siècle se traduit en intervalle sur la date de décès', () => {
  const { sql, params } = buildWhere({ centuries: [7] }, none);
  assert.match(sql, /death_year_hijri/);
  assert.deepEqual(params, [7]);
});

test('un tri inconnu retombe sur le titre', () => {
  assert.match(buildList({ sort: 'rm -rf' }, none).sql, /ORDER BY e\.title_ar/);
  assert.match(buildList({ sort: 'pages' }, none).sql, /ORDER BY r\.page_count/);
});

test('la pagination est bornée', () => {
  const { params } = buildList({ limit: 10_000, offset: 40 }, none);
  assert.deepEqual(params.slice(-2), [200, 40], 'limite plafonnée à 200');
});

test('le compte ne trie ni ne pagine', () => {
  const { sql } = buildCount({ sort: 'pages', limit: 40 }, none);
  assert.equal(sql.includes('ORDER BY'), false);
  assert.equal(sql.includes('LIMIT'), false);
});

test('une facette est comptée sans son propre filtre', () => {
  const query = { categories: [12], types: ['كتاب'] };
  const own = buildFacetQuery(query, 'categories', none);
  assert.equal(own.sql.includes('category_id IN'), false, 'son filtre est retiré');
  assert.match(own.sql, /book_type_label IN/, 'les autres restent');
  assert.deepEqual(own.params, ['كتاب']);
});

test('une facette inconnue est refusée', () => {
  assert.throws(() => buildFacetQuery({}, 'rm -rf', none), /facette inconnue/);
});
