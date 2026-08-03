/**
 * Les quinze méthodes de catalogue que le shim laissait en `not-ported`.
 *
 * `src/repository.capacitor.js` porte la tranche verticale — accueil, fiche,
 * lecteur — parce que c'est elle qui répondait à la question du spike : le
 * rendu tient-il sur SQLite natif. La réponse est oui, et FTS5 répond. Ce
 * module ouvre la suite : auteurs, siècles, exploration à facettes, cursus,
 * recherche transversale, et l'écran d'informations.
 *
 * **Une fabrique, pas un module autonome.** Aucun `import` : le rendu n'a pas
 * de bundler, `cap sync` ne copie que `www/`, et ce fichier vit dans deux
 * arbres — `src/repo/`, où `verify.mjs` peut le charger pour compter sa
 * surface, et `www/js/`, où il s'exécute. Un chemin relatif ne peut pas être
 * juste dans les deux. Tout ce qui touche le pont, les bases ou les
 * projections arrive donc par `ctx`, que le shim tient déjà.
 *
 * **Le SQL vient de `src/main/book-repository.js` et de
 * `src/main/catalog-query.js`, repris tel quel.** Il ne change pas de moteur en
 * changeant de client, et le réécrire ferait diverger deux implémentations que
 * rien ne compare. Les seuls écarts sont signalés un par un, et chacun est un
 * écart *mesuré*, pas un goût :
 *
 *   - la recherche passe par FTS5 là où Electron passe par un index mémoire ou
 *     un `LIKE`, faute de FTS5 dans son build sql.js ;
 *   - `#withDownloadStatus` lit `user.sqlite` **et** le manifeste, parce qu'un
 *     livre poussé par `adb` n'a aucune ligne dans `downloaded_books`.
 */

export function creerMethodesCatalogue(ctx) {
  const {
    RepositoryError,
    garde,
    catalogue,
    livre,
    livreInstalle,
    all,
    first,
    allUser,
    sonderFts,
    SUMMARY_SELECT,
    bookSummary,
    author,
    snippetAround,
    assertEditionId,
    normalizeArabic,
    manifeste,
    pont,
  } = ctx;

  // ------------------------------------------------------------- les mesures

  /**
   * Un chronomètre par mesure, comme dans le shim. La sonde est facultative —
   * `probe.js` peut ne pas être chargé — d'où l'appel défensif.
   */
  function chrono() {
    const depart = performance.now();
    return (label, detail) => {
      globalThis.__probe?.record(label, performance.now() - depart, detail ?? '');
    };
  }

  // ------------------------------------------------- ce qui est installé ici

  /**
   * L'édition poussée par `adb`, si son fichier est bien là.
   *
   * Elle n'a **aucune ligne** dans `downloaded_books` : personne ne l'a
   * téléchargée, elle a été déposée. S'en tenir à `user.sqlite` ferait dire à
   * `/explore` que rien n'est installé, et à `searchLibrary` qu'il n'y a rien à
   * balayer — sur l'appareil qui porte précisément le seul livre du spike.
   */
  let pousseePromise = null;

  function editionPoussee() {
    pousseePromise ??= (async () => {
      const lu = await manifeste().catch(() => null);
      const editionId = lu?.editionId ?? null;
      if (!editionId) return null;
      return (await livreInstalle(editionId)) ? editionId : null;
    })();
    return pousseePromise;
  }

  /**
   * Les identifiants installés, réunis des deux sources. Pas de cache : une
   * ligne peut apparaître entre deux écrans, et la lecture est courte.
   */
  async function idsInstalles() {
    const ids = new Set();
    try {
      const lignes = await allUser(
        "SELECT edition_id FROM downloaded_books WHERE download_status = 'installed'",
      );
      for (const ligne of lignes) ids.add(ligne.edition_id);
    } catch {
      // `user.sqlite` de l'exemple peut n'avoir aucune table : ce n'est pas une
      // panne, c'est une bibliothèque vide.
    }
    const pousse = await editionPoussee();
    if (pousse) ids.add(pousse);
    return ids;
  }

  /**
   * Ce que `#withDownloadStatus` fait dans `book-repository.js` : poser le
   * statut d'installation sur une page de résumés. Les cartes de livre lisent
   * `downloadStatus` ; le laisser indéfini les montrerait toutes identiques.
   */
  function marquerInstalles(resumes, installes) {
    for (const resume of resumes) {
      resume.downloadStatus = installes.has(resume.editionId) ? 'installed' : null;
    }
    return resumes;
  }

  // ------------------------------------------------------------ verdicts FTS

  /**
   * FTS5 répond ici — c'est le résultat du spike, mesuré sur appareil : le
   * greffon embarque SQLCipher 4.10.0, et `catalog_fts` comme `pages_fts`
   * répondent à `MATCH`. On le vérifie quand même avant chaque usage : le
   * verdict est mis en cache par `sonderFts`, l'appel est donc gratuit après le
   * premier, et un jour de malchance — greffon remplacé, fichier plus vieux que
   * le schéma — doit dégrader la recherche, pas éteindre l'écran.
   */
  async function ftsCatalogue(chemin) {
    const verdict = await sonderFts(chemin, 'catalog_fts', 'edition_id').catch(() => null);
    return verdict?.ok === true;
  }

  async function ftsLivre(chemin) {
    const verdict = await sonderFts(chemin, 'pages_fts', 'rowid').catch(() => null);
    return verdict?.ok === true;
  }

  /**
   * Le terme, cité en phrase et suffixé d'une étoile.
   *
   * Les guillemets sont doublés : citer neutralise toute la syntaxe FTS5 — un
   * terme contenant `OR`, `NEAR`, `*` ou `^` est cherché littéralement et ne
   * peut pas devenir une expression de requête.
   *
   * L'étoile n'est pas cosmétique. Mesuré sur `sh-7745`, pour « لفظ » :
   * 7 pages en phrase exacte, 17 en préfixe, 48 en `LIKE`. FTS5 indexe des
   * jetons, `LIKE` cherche des sous-chaînes ; le préfixe est ce qui s'en
   * rapproche le plus sans quitter l'index. L'écart qui reste — les
   * occurrences en milieu de mot — est réel et **change les résultats**, pas
   * seulement leur vitesse.
   */
  const phrasePrefixe = (needle) => `"${needle.replace(/"/g, '""')}"*`;

  /** `%` et `_` sont des jokers LIKE : sans échappement, tout remonterait. */
  const motifLike = (needle) => `%${needle.replace(/[\\%_]/g, '\\$&')}%`;

  const echapperRegExp = (texte) => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * Le motif qui situe le terme dans `body_plain`, qui n'est **pas** normalisé.
   *
   * Il vient de `shared/arabic.js` par le contexte quand l'hôte le passe : le
   * recopier ici forkerait `arabicSearchPattern`, exactement la faute que le
   * shim documente pour `normalizeArabic`. À défaut, un motif littéral sur le
   * terme normalisé — il retrouve moins souvent la position, et l'extrait
   * retombe alors sur les premiers caractères de la page. Dégradé, jamais faux :
   * les résultats viennent de SQL, le motif ne décide que du cadrage.
   */
  const motifSurligne = (terme) =>
    ctx.arabicSearchPattern?.(terme) ?? new RegExp(echapperRegExp(normalizeArabic(terme)), 'g');

  // --------------------------------------------------- index mémoire des noms

  /**
   * Ce que `#names()` fait dans `book-repository.js`, découpé en trois index
   * chargés **séparément et à la demande**.
   *
   * Electron les construit tous les trois d'un coup : sur le bureau, trois
   * lectures d'une base déjà en mémoire. Ici chaque ligne traverse le pont
   * natif en JSON, et c'est ce passage qui coûte — 721 ms pour la première
   * requête de l'accueil, contre 131 ms pour ouvrir 28,8 Mo. Charger les
   * 8 568 titres pour compléter un nom d'éditeur serait payer le pire des trois
   * pour rien.
   *
   * Les titres, justement, ne se chargent plus que si FTS5 est refusé : c'est
   * `catalog_fts` qui les remplace, et lui n'a rien à traverser.
   */
  const index = { auteurs: null, editeurs: null, titres: null };

  function indexAuteurs() {
    index.auteurs ??= (async () => {
      const db = await catalogue();
      const fin = chrono();
      const lignes = await all(
        db,
        `SELECT a.author_id, COALESCE(a.short_name_ar, a.full_name_ar) AS label,
                a.full_name_ar, COUNT(DISTINCT e.edition_id) AS n
           FROM authors a
           JOIN edition_authors ea ON ea.author_id = a.author_id
           JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
          GROUP BY a.author_id`,
      );
      fin('index:auteurs', `${lignes.length} auteurs`);
      return lignes.map((ligne) => ({
        value: ligne.author_id,
        label: ligne.label,
        count: ligne.n,
        // `authors.full_name_ar` n'a pas de colonne normalisée au schéma : un
        // `LIKE` dessus manquerait toute variante de hamza.
        needle: normalizeArabic(`${ligne.full_name_ar} ${ligne.label}`),
      }));
    })();
    return index.auteurs;
  }

  function indexEditeurs() {
    index.editeurs ??= (async () => {
      const db = await catalogue();
      const fin = chrono();
      const lignes = await all(
        db,
        `SELECT publisher_ar AS label, COUNT(*) AS n FROM editions
          WHERE is_hidden = 0 AND publisher_ar IS NOT NULL AND publisher_ar <> ''
          GROUP BY publisher_ar`,
      );
      fin('index:editeurs', `${lignes.length} éditeurs`);
      return lignes.map((ligne) => ({
        value: ligne.label,
        label: ligne.label,
        count: ligne.n,
        needle: normalizeArabic(ligne.label),
      }));
    })();
    return index.editeurs;
  }

  function indexTitres() {
    index.titres ??= (async () => {
      const db = await catalogue();
      const fin = chrono();
      const lignes = await all(
        db,
        'SELECT edition_id, title_ar, subtitle_ar FROM editions WHERE is_hidden = 0',
      );
      fin('index:titres', `${lignes.length} titres`);
      return lignes.map((ligne) => ({
        editionId: ligne.edition_id,
        needle: normalizeArabic(`${ligne.title_ar} ${ligne.subtitle_ar ?? ''}`),
      }));
    })();
    return index.titres;
  }

  // ------------------------------------------- construction des requêtes (2)

  /*
   * Ce bloc est `src/main/catalog-query.js`, recopié.
   *
   * Il n'a aucune dépendance et ne touche aucune base — c'est du SQL et des
   * paramètres liés — mais il ne peut pas être importé : pas de bundler, pas de
   * spécificateur résoluble depuis les deux arbres. Le recopier est la même
   * décision que pour `SUMMARY_SELECT` dans le shim, et pour la même raison.
   *
   * Règle intangible, conservée : **aucune valeur ne rejoint le SQL par
   * interpolation**. Les seuls fragments littéraux sont des noms de colonnes
   * issus des listes blanches de ce bloc.
   *
   * Un seul ajout : la clause `fts`. Voir son commentaire.
   */

  /** Tris autorisés. Toute autre valeur retombe sur le titre. */
  const SORTS = {
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
      case 'fts': {
        // **Le seul ajout au module d'origine.** Electron résout le texte en
        // amont, contre son index mémoire, et passe la liste d'identifiants par
        // `ids` : `catalog_fts` lui est fermée, son build sql.js n'a pas FTS5.
        //
        // Ici la table répond. Pousser le `MATCH` dans le `WHERE` change trois
        // choses à la fois : un seul paramètre lié au lieu de plusieurs
        // milliers — que le pont natif sérialiserait un par un —, la clause
        // compose avec les facettes, le décompte et les compteurs de facettes
        // sans réécriture, et un terme large ne construit plus de liste géante
        // en mémoire pour la redonner aussitôt à SQLite.
        if (!query.fts) return null;
        return [
          `e.edition_id IN (SELECT edition_id FROM catalog_fts WHERE catalog_fts MATCH ?)`,
          [query.fts],
        ];
      }
      case 'ids': {
        // Le repli : résultat de la recherche texte résolue contre l'index
        // mémoire, quand FTS5 est refusé. Un tableau vide est significatif —
        // « aucun résultat », pas « pas de filtre ».
        if (!Array.isArray(values)) return null;
        if (!values.length) return ['1 = 0', []];
        return [`e.edition_id IN (${placeholders(values)})`, values];
      }
      default:
        return null;
    }
  }

  const ALL_KEYS = [
    'fts',
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
  function buildWhere(query, { installedIds = [] } = {}, except = null) {
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

  /**
   * Projection propre à `/explore`, **distincte** de `SUMMARY_SELECT` : elle
   * évite les jointures à répétition en passant par des sous-requêtes
   * corrélées. Les deux doivent porter `book_type_label` et `death_year_hijri`
   * — la forme et la patine des couvertures composées en dépendent, et sans eux
   * l'écran entier tombe sur ses valeurs de repli sans que rien ne le dise.
   */
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

  function buildList(query, options = {}) {
    const where = buildWhere(query, options);
    const order = SORTS[query.sort] ?? SORTS.title;
    const limit = Math.min(Math.max(Number(query.limit) || 40, 1), MAX_LIMIT);
    const offset = Math.max(Number(query.offset) || 0, 0);
    return {
      sql: `SELECT ${SUMMARY_COLUMNS}${FROM}${where.sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      params: [...where.params, limit, offset],
    };
  }

  function buildCount(query, options = {}) {
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
  function buildFacetQuery(query, facetKey, options = {}) {
    const value = FACET_VALUE[facetKey];
    if (!value) throw new RepositoryError(`facette inconnue : ${facetKey}`, 'query-failed');
    const where = buildWhere(query, options, facetKey);
    return {
      sql: `SELECT ${value} AS value, COUNT(*) AS n${FROM}${where.sql}
          GROUP BY value HAVING value IS NOT NULL ORDER BY n DESC`,
      params: where.params,
    };
  }

  /**
   * Traduit le texte d'une requête en clause. Deux voies, une seule retenue par
   * appel, et la vue doit pouvoir dire laquelle : les deux ne rendent pas les
   * mêmes résultats. Mesuré sur le catalogue publié, pour « نحو » : 7 éditions
   * par FTS5, 94 par l'index mémoire — qui cherche la sous-chaîne, donc trouve
   * aussi les mots qui la contiennent.
   *
   * Le champ `text` sort de la requête dans les deux cas : ce qui part vers
   * SQLite est soit une expression FTS5 citée, soit une liste d'identifiants.
   *
   * `fts` est **toujours** réécrit, y compris quand il n'y a rien à chercher :
   * c'est une clause que seule cette fonction a le droit de poser, et une
   * requête venue du fragment d'URL n'a pas à choisir l'expression `MATCH`.
   */
  async function resoudreTexte(query, chemin) {
    const sansTexte = { ...query, fts: null };
    if (!query.text?.trim()) return { query: sansTexte, moteur: null };
    const needle = normalizeArabic(query.text);
    if (!needle) return { query: sansTexte, moteur: null };

    if (await ftsCatalogue(chemin)) {
      // Les colonnes citées sont celles que le pipeline a normalisées ;
      // `title_ar`, indexée mais brute, est volontairement hors du filtre — la
      // chercher avec un terme normalisé donnerait un rappel de hasard.
      // L'union titre-ou-auteur est native ici : c'est le même `MATCH`, pas
      // deux ensembles à réunir après coup.
      return {
        query: {
          ...query,
          text: null,
          fts: `{title_normalized author_names} : ${phrasePrefixe(needle)}`,
        },
        moteur: 'fts5',
      };
    }

    const [titres, auteurs] = await Promise.all([indexTitres(), indexAuteurs()]);
    const ids = new Set(
      titres.filter((entree) => entree.needle.includes(needle)).map((entree) => entree.editionId),
    );
    const trouves = auteurs
      .filter((entree) => entree.needle.includes(needle))
      .map((entree) => entree.value);
    if (trouves.length) {
      const lignes = await all(
        chemin,
        `SELECT edition_id FROM edition_authors
          WHERE author_id IN (${placeholders(trouves)})`,
        trouves,
      );
      for (const ligne of lignes) ids.add(ligne.edition_id);
    }
    return { query: { ...query, text: null, ids: [...ids] }, moteur: 'index-mémoire' };
  }

  // ------------------------------------------------------------- les auteurs

  /**
   * Repli d'alif pour l'ordre alphabétique. `authors.full_name_ar` n'a pas de
   * colonne normalisée au schéma, et `ORDER BY` trie sur les points de code :
   * « أحمد » se rangerait avant « ابن » alors que l'usage les confond.
   */
  const arabicOrder = (column) =>
    `REPLACE(REPLACE(REPLACE(${column}, 'أ', 'ا'), 'إ', 'ا'), 'آ', 'ا')`;

  /** Tris proposés sur les auteurs. Clé inconnue : on retombe sur `count`. */
  const AUTHOR_SORTS = {
    count: 'book_count DESC, a.full_name_ar',
    name: `${arabicOrder('COALESCE(a.short_name_ar, a.full_name_ar)')} ASC`,
    // Les auteurs sans date de décès ferment la marche : les dater est faux.
    death: 'a.death_year_hijri IS NULL, a.death_year_hijri ASC, a.full_name_ar',
  };

  /**
   * Identifiants des auteurs dont le nom répond à [text], ou `null` quand il
   * n'y a rien à filtrer.
   *
   * FTS5 ne sert pas ici, et ce n'est pas un oubli : `catalog_fts` est indexée
   * **par édition**. Un `MATCH` sur `author_names` rendrait les éditions dont
   * l'un des auteurs répond, donc aussi leurs coauteurs, qui ne répondent pas.
   * L'index mémoire est le seul qui réponde à la question posée — et il ne
   * charge que 3 183 lignes, une fois par session.
   */
  async function auteursRepondant(text) {
    const needle = normalizeArabic(text ?? '');
    if (!needle) return null;
    const auteurs = await indexAuteurs();
    return auteurs
      .filter((entree) => entree.needle.includes(needle))
      .map((entree) => entree.value);
  }

  /**
   * Auteurs du catalogue, paginés, avec le nombre d'éditions rattachées.
   *
   * Le corpus en compte 3 183 : les ramener tous pour n'en montrer qu'un écran
   * chargerait le pont et, pire, laisserait l'interface annoncer un total
   * tronqué. `total` porte donc sur la sélection entière, et vient de SQL.
   */
  const getAuthors = ({ offset = 0, limit = 60, sort = 'count', text = null } = {}) =>
    garde('lecture des auteurs', async () => {
      const db = await catalogue();
      const repondant = await auteursRepondant(text);
      // Un tableau vide est significatif : « aucun auteur », pas « pas de filtre ».
      if (repondant?.length === 0) return { rows: [], total: 0 };

      const where = repondant ? `AND a.author_id IN (${placeholders(repondant)})` : '';
      const params = repondant ?? [];

      const total =
        (
          await first(
            db,
            `SELECT COUNT(*) AS n FROM (
             SELECT a.author_id
             FROM authors a
             JOIN edition_authors ea ON ea.author_id = a.author_id
             JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
             WHERE 1 = 1 ${where}
             GROUP BY a.author_id
           )`,
            params,
          )
        )?.n ?? 0;

      const fin = chrono();
      const rows = (
        await all(
          db,
          `SELECT a.*, COUNT(DISTINCT e.edition_id) AS book_count
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
         WHERE 1 = 1 ${where}
         GROUP BY a.author_id
         HAVING book_count > 0
         ORDER BY ${AUTHOR_SORTS[sort] ?? AUTHOR_SORTS.count}
         LIMIT ? OFFSET ?`,
          [...params, limit, offset],
        )
      ).map(author);
      fin('auteurs:page', `${rows.length} sur ${total}, tri ${sort}`);

      return { rows, total };
    });

  /**
   * Ce que l'en-tête des auteurs annonce. Compté en SQL, sur tout le fonds : le
   * déduire d'une page de résultats donnerait un chiffre faux dès que la liste
   * dépasse un écran — c'est ce défaut-là qui faisait afficher « ٢٠٠ مؤلفًا ».
   */
  const getAuthorStats = () =>
    garde('lecture du décompte des auteurs', async () => {
      const db = await catalogue();
      const row =
        (await first(
          db,
          `SELECT COUNT(DISTINCT a.author_id)  AS authors,
                  COUNT(DISTINCT e.edition_id) AS books,
                  MIN(CASE WHEN a.death_year_hijri > 0
                           THEN (a.death_year_hijri - 1) / 100 + 1 END) AS first_century,
                  MAX(CASE WHEN a.death_year_hijri > 0
                           THEN (a.death_year_hijri - 1) / 100 + 1 END) AS last_century
           FROM authors a
           JOIN edition_authors ea ON ea.author_id = a.author_id
           JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0`,
        )) ?? {};
      return {
        authorCount: row.authors ?? 0,
        bookCount: row.books ?? 0,
        firstCentury: row.first_century ?? null,
        lastCentury: row.last_century ?? null,
      };
    });

  // -------------------------------------------------------- listes de livres

  /**
   * Les portées qui méritent un écran à elles seules. Une seule requête
   * paramétrée pour les quatre : elles ne diffèrent que par leur filtre et par
   * l'intitulé qui les nomme.
   */
  const BOOK_SCOPES = {
    author: {
      where: 'e.edition_id IN (SELECT edition_id FROM edition_authors WHERE author_id = ?)',
      params: (id) => [id],
      label:
        'SELECT COALESCE(short_name_ar, full_name_ar) AS label FROM authors WHERE author_id = ?',
    },
    category: {
      where: 'e.category_id = ?',
      params: (id) => [Number(id)],
      label: 'SELECT label_ar AS label FROM categories WHERE category_id = ?',
    },
    era: {
      where: `e.edition_id IN (
      SELECT ea.edition_id
      FROM edition_authors ea
      JOIN authors a ON a.author_id = ea.author_id
      WHERE a.death_year_hijri IS NOT NULL
        AND (a.death_year_hijri - 1) / 100 + 1 = ?
    )`,
      params: (id) => [Number(id)],
      label: null,
    },
    // 2 404 éditions sur 8 568 — 28 % — n'ont aucun auteur daté. Sans cette
    // portée, elles ne sont atteignables depuis aucune vue temporelle : la
    // frise des siècles les passerait sous silence au lieu de les ranger au
    // bout de son axe.
    undated: {
      where: `e.edition_id NOT IN (
      SELECT ea.edition_id
      FROM edition_authors ea
      JOIN authors a ON a.author_id = ea.author_id
      WHERE a.death_year_hijri IS NOT NULL AND a.death_year_hijri > 0
    )`,
      params: () => [],
      label: null,
    },
  };

  /**
   * Une liste de livres qui mérite un écran : ceux d'un auteur, d'une
   * discipline, d'un siècle, ou ceux qu'on ne sait pas dater. `total` est
   * compté à part — sans lui, l'écran ne pourrait qu'annoncer ce qu'il a reçu,
   * c'est-à-dire mentir dès la page deux.
   */
  const getBooksIn = ({ scope = 'author', id, offset = 0, limit = 24 } = {}) =>
    garde("lecture d'une liste de livres", async () => {
      const target = BOOK_SCOPES[scope];
      if (!target) throw new RepositoryError(`portée de liste inconnue : ${scope}`, 'query-failed');

      const db = await catalogue();
      const params = target.params(id);

      const total =
        (
          await first(
            db,
            `SELECT COUNT(*) AS n FROM editions e
            WHERE e.is_hidden = 0 AND ${target.where}`,
            params,
          )
        )?.n ?? 0;

      const rows = marquerInstalles(
        (
          await all(
            db,
            `${SUMMARY_SELECT} AND ${target.where}
           GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ? OFFSET ?`,
            [...params, limit, offset],
          )
        ).map(bookSummary),
        await idsInstalles(),
      );

      const label = target.label ? ((await first(db, target.label, [id]))?.label ?? null) : null;
      return { rows, total, label };
    });

  /**
   * Siècles hégiriens dérivés de la date de décès des auteurs : c'est le
   * classement usuel du patrimoine arabe, et la seule donnée temporelle fiable
   * du catalogue — les éditions n'ont pas de date de composition.
   *
   * Ne rend que les siècles **peuplés**. C'est la vue qui comble son axe : un
   * siècle vide doit se voir comme vide, et une liste qui colle les siècles les
   * uns aux autres prétendrait à une continuité que le catalogue n'a pas.
   * Combler ici retirerait ce choix à la vue et le rendrait invisible.
   */
  const getEras = () =>
    garde('lecture des siècles', async () => {
      const db = await catalogue();
      return (
        await all(
          db,
          `SELECT (a.death_year_hijri - 1) / 100 + 1        AS century,
                COUNT(DISTINCT e.edition_id)              AS book_count
         FROM authors a
         JOIN edition_authors ea ON ea.author_id = a.author_id
         JOIN editions e         ON e.edition_id = ea.edition_id AND e.is_hidden = 0
         WHERE a.death_year_hijri IS NOT NULL AND a.death_year_hijri > 0
         GROUP BY century
         ORDER BY century`,
        )
      ).map((row) => ({
        century: row.century,
        bookCount: row.book_count ?? 0,
      }));
    });

  /**
   * Ce que la frise ne peut pas dater — 2 404 éditions sur 8 568. Compté par
   * SQL, comme tout décompte affiché : une section qui se donne pour une vue
   * d'ensemble ne peut pas taire 28 % du corpus.
   */
  const getUndatedCount = () =>
    garde('lecture des éditions non datées', async () => {
      const db = await catalogue();
      return (
        (
          await first(
            db,
            `SELECT COUNT(*) AS n FROM editions e
            WHERE e.is_hidden = 0 AND ${BOOK_SCOPES.undated.where}`,
          )
        )?.n ?? 0
      );
    });

  const getBooksByCentury = (century, { limit = 60 } = {}) =>
    garde('lecture du siècle', async () => {
      const db = await catalogue();
      return marquerInstalles(
        (
          await all(
            db,
            `${SUMMARY_SELECT} AND e.edition_id IN (
             SELECT ea.edition_id
             FROM edition_authors ea
             JOIN authors a ON a.author_id = ea.author_id
             WHERE a.death_year_hijri IS NOT NULL
               AND (a.death_year_hijri - 1) / 100 + 1 = ?
           )
           GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ?`,
            [Number(century), limit],
          )
        ).map(bookSummary),
        await idsInstalles(),
      );
    });

  const getBooksByAuthor = (authorId, { limit = 10 } = {}) =>
    garde("lecture des livres de l'auteur", async () => {
      const db = await catalogue();
      return marquerInstalles(
        (
          await all(
            db,
            `${SUMMARY_SELECT} AND e.edition_id IN (
             SELECT edition_id FROM edition_authors WHERE author_id = ?
           )
           GROUP BY e.edition_id ORDER BY e.title_ar LIMIT ?`,
            [authorId, limit],
          )
        ).map(bookSummary),
        await idsInstalles(),
      );
    });

  // ------------------------------------------------------------ exploration

  const exploreBooks = (query = {}) =>
    garde('exploration du catalogue', async () => {
      const db = await catalogue();
      const installes = await idsInstalles();
      const options = { installedIds: [...installes] };
      const { query: resolved, moteur } = await resoudreTexte(query, db);

      const list = buildList(resolved, options);
      const count = buildCount(resolved, options);
      const fin = chrono();
      const books = marquerInstalles(
        (await all(db, list.sql, list.params)).map(bookSummary),
        installes,
      );
      const totals = (await first(db, count.sql, count.params)) ?? { n: 0, bytes: 0 };
      fin('explore:page', `${moteur ?? 'sans texte'} — ${books.length} sur ${totals.n}`);
      // `moteur` voyage avec le résultat : une mesure qui ne dit pas si elle a
      // interrogé l'index ou balayé la mémoire ne mesure rien.
      return { books, total: totals.n, bytes: totals.bytes, moteur };
    });

  const getFacets = (query = {}) =>
    garde('lecture des facettes', async () => {
      const db = await catalogue();
      const installes = await idsInstalles();
      const options = { installedIds: [...installes] };
      const { query: resolved } = await resoudreTexte(query, db);

      const labelsById = new Map(
        (await all(db, 'SELECT category_id, label_ar FROM categories')).map((row) => [
          row.category_id,
          row.label_ar,
        ]),
      );
      const facet = async (key, label) => {
        const built = buildFacetQuery(resolved, key, options);
        return (await all(db, built.sql, built.params)).map((row) => ({
          value: row.value,
          label: label(row.value),
          count: row.n,
        }));
      };

      // Le statut se compte à part : ses deux valeurs ne sortent pas d'un GROUP BY.
      const withoutStatus = { ...resolved, status: null };
      const countFor = async (status) => {
        const built = buildCount({ ...withoutStatus, status }, options);
        return (await first(db, built.sql, built.params))?.n ?? 0;
      };

      return {
        categories: await facet('categories', (id) => labelsById.get(id) ?? String(id)),
        types: await facet('types', (value) => value),
        centuries: await facet('centuries', (value) => `القرن ${value}`),
        publishers: (await facet('publishers', (value) => value)).slice(0, 30),
        status: [
          { value: 'installed', label: 'مُنزَّل', count: await countFor('installed') },
          { value: 'missing', label: 'غير مُنزَّل', count: await countFor('missing') },
        ],
      };
    });

  /**
   * Autocomplétion d'une facette. Deux clés seulement l'appellent —
   * `facet-panel.js` : `authors` et `publishers`, celles dont les valeurs sont
   * trop nombreuses pour une liste de cases.
   */
  const SUGGESTIONS = { authors: indexAuteurs, publishers: indexEditeurs };

  const suggestValues = (facetKey, term) =>
    garde('suggestion de valeurs', async () => {
      const charger = SUGGESTIONS[facetKey];
      if (!charger) {
        throw new RepositoryError(`facette sans suggestions : ${facetKey}`, 'query-failed');
      }
      const needle = normalizeArabic(term ?? '');
      if (needle.length < 2) return [];
      return (await charger())
        .filter((entree) => entree.needle.includes(needle))
        .sort((a, b) => b.count - a.count)
        .slice(0, 20)
        .map(({ value, label, count }) => ({ value, label, count }));
    });

  /**
   * Ce que pèserait la sélection. Les livres déjà installés en sortent : la
   * boîte de confirmation annonce ce qu'il reste à télécharger, pas ce qui est
   * coché.
   */
  const getSelectionWeight = (editionIds = []) =>
    garde('pesée de la sélection', async () => {
      if (!editionIds.length) return { count: 0, bytes: 0 };
      const installes = await idsInstalles();
      const pending = editionIds.filter((id) => !installes.has(id));
      if (!pending.length) return { count: 0, bytes: 0 };
      const db = await catalogue();
      const row = await first(
        db,
        `SELECT COUNT(*) AS n, COALESCE(SUM(compressed_size), 0) AS bytes
           FROM book_releases
          WHERE is_active = 1 AND edition_id IN (${placeholders(pending)})`,
        pending,
      );
      return { count: row?.n ?? 0, bytes: row?.bytes ?? 0 };
    });

  // ----------------------------------------------------------------- cursus

  /**
   * La liste des cursus — identifiants et ordre des étapes — vit dans
   * `src/shared/curricula.js`, et rien d'autre ne la porte. Leurs **noms**, eux,
   * sont dans les catalogues de chaînes (`curriculum.<id>.name`) et le filtrage
   * par nom se fait côté vue : le processus principal ne les a jamais eus, et
   * ce module ne les a pas davantage. Ce qui sort d'ici est un état, pas un
   * libellé.
   *
   * Recopier soixante identifiants ici les forkerait au premier ajustement
   * d'ordre. On préfère donc, dans l'ordre : ce que l'hôte passe, puis un
   * chargement différé — le même procédé que le shim emploie pour
   * `shared/arabic.js`, et pour la même raison. Plusieurs chemins sont tentés :
   * la profondeur de ce fichier dans `www/` n'est pas encore arrêtée, et un
   * mauvais chemin doit coûter un essai, pas l'écran.
   */
  const CHEMINS_CURSUS = [
    '/shared/curricula.js',
    '../shared/curricula.js',
    '../../shared/curricula.js',
  ];

  let cursusPromise = null;

  function listeCursus() {
    if (cursusPromise) return cursusPromise;
    const promesse = (async () => {
      if (Array.isArray(ctx.CURRICULA)) return ctx.CURRICULA;
      const echecs = [];
      for (const chemin of CHEMINS_CURSUS) {
        try {
          const module = await import(new URL(chemin, import.meta.url).href);
          if (Array.isArray(module.CURRICULA)) return module.CURRICULA;
          echecs.push(`${chemin} : sans CURRICULA`);
        } catch (erreur) {
          echecs.push(`${chemin} : ${String(erreur?.message ?? erreur)}`);
        }
      }
      throw new RepositoryError(
        `liste des cursus introuvable (${echecs.join(' ; ')})`,
        'db-missing',
      );
    })();
    // Un échec ne se met pas en cache : la vue suivante doit retenter. La
    // comparaison est nécessaire — sans elle, un échec tardif effacerait la
    // promesse qu'un appel plus récent vient d'installer.
    promesse.catch(() => {
      if (cursusPromise === promesse) cursusPromise = null;
    });
    cursusPromise = promesse;
    return promesse;
  }

  /**
   * Les livres de tous les cursus, résolus contre le catalogue, avec leur
   * progression. Une seule passe : les sept cursus tiennent en moins de
   * cinquante identifiants, les interroger un par un ferait sept fois le tour
   * des deux bases pour rien.
   */
  async function indexCursus() {
    const cursus = await listeCursus();
    const wanted = [...new Set(cursus.flatMap((entree) => entree.steps))];
    const db = await catalogue();
    const books = new Map(
      (
        await all(
          db,
          `${SUMMARY_SELECT} AND e.edition_id IN (${placeholders(wanted)}) GROUP BY e.edition_id`,
          wanted,
        )
      )
        .map(bookSummary)
        .map((book) => [book.editionId, book]),
    );

    // La progression vit dans `user.sqlite`, qui peut n'avoir aucune table :
    // un cursus sans avancement reste montrable, un cursus qui lève ne l'est pas.
    const progress = new Map();
    try {
      const lignes = await allUser(
        `SELECT edition_id, download_status, progress_percent
           FROM downloaded_books WHERE edition_id IN (${placeholders(wanted)})`,
        wanted,
      );
      for (const ligne of lignes) {
        progress.set(ligne.edition_id, {
          status: ligne.download_status ?? null,
          percent: ligne.progress_percent ?? 0,
        });
      }
    } catch {
      // Bibliothèque vide : toutes les étapes seront à zéro, ce qui est vrai.
    }

    const installes = await idsInstalles();
    for (const [editionId, book] of books) {
      book.downloadStatus = installes.has(editionId)
        ? 'installed'
        : (progress.get(editionId)?.status ?? null);
    }
    return { cursus, books, progress };
  }

  /**
   * Une étape terminée est un livre lu jusqu'au bout. `saveProgress` écrit
   * `progress_percent` sur la même ligne que le téléchargement : il n'y a rien
   * de plus à tenir, et rien qui puisse diverger.
   */
  function etatCursus(curriculum, { books, progress }) {
    const steps = curriculum.steps
      .filter((editionId) => books.has(editionId))
      .map((editionId, position) => ({
        position: position + 1,
        book: books.get(editionId),
        percent: progress.get(editionId)?.percent ?? 0,
      }));
    const done = steps.filter((step) => step.percent >= 1).length;
    const started = steps.filter((step) => step.percent > 0 && step.percent < 1).length;
    return {
      id: curriculum.id,
      category: curriculum.category,
      steps,
      // `resolved` survit au retrait de `steps` : sans lui, la carte d'un cursus
      // n'aurait aucun dénominateur à afficher.
      resolved: steps.length,
      // Le compte déclaré, pas celui des étapes retenues : un cursus amputé par
      // un import partiel doit le dire au lieu de se donner pour complet.
      declared: curriculum.steps.length,
      missing: curriculum.steps.length - steps.length,
      installed: steps.filter((step) => step.book.downloadStatus === 'installed').length,
      done,
      started,
      percent: steps.length ? done / steps.length : 0,
    };
  }

  /**
   * Les cursus **avec toutes leurs étapes** : la carte les dessine en rayon,
   * une tranche par livre. En renvoyer trois obligerait la vue à mentir sur
   * l'épaisseur du rayon.
   */
  const getCurricula = () =>
    garde('lecture des cursus', async () => {
      const index = await indexCursus();
      return (
        index.cursus
          .map((curriculum) => etatCursus(curriculum, index))
          // Un cursus dont aucune étape n'est au catalogue n'est pas montrable.
          .filter((etat) => etat.steps.length > 0)
      );
    });

  const getCurriculum = (curriculumId) =>
    garde("lecture d'un cursus", async () => {
      const index = await indexCursus();
      const curriculum = index.cursus.find((entree) => entree.id === curriculumId);
      if (!curriculum) {
        throw new RepositoryError(`cursus inconnu : ${curriculumId}`, 'query-failed');
      }
      return etatCursus(curriculum, index);
    });

  // ------------------------------------------------- recherche transversale

  /** Titres du catalogue pour un lot d'éditions ; les absentes sont ignorées. */
  async function titresPour(editionIds) {
    const ids = [...new Set(editionIds.filter(Boolean))];
    if (!ids.length) return new Map();
    const db = await catalogue();
    return new Map(
      (
        await all(
          db,
          `SELECT edition_id, title_ar FROM editions
          WHERE edition_id IN (${placeholders(ids)})`,
          ids,
        )
      ).map((row) => [row.edition_id, row.title_ar]),
    );
  }

  /**
   * Compte et occurrences dans un livre ouvert, par FTS5 si le fichier répond,
   * par `LIKE` sinon. Rend aussi le moteur employé : l'écart entre les deux se
   * voit à l'œil, il ne doit pas se deviner.
   *
   * Le `MATCH` est **restreint à `body_search`**, et ce n'est pas de la
   * prudence de forme. `pages_fts` indexe aussi `footnotes_search` : sans le
   * filtre de colonne, 5 pages sur 84 remontaient pour « القرآن » sans porter
   * le terme dans leur corps — l'extrait tombait alors sur les cent vingt
   * premiers caractères de la page, sans rien de surligné. Avec le filtre :
   * zéro sur 79.
   */
  async function occurrencesDans(chemin, needle, perBook) {
    const pattern = motifLike(needle);

    if (await ftsLivre(chemin)) {
      const expression = `{body_search} : ${phrasePrefixe(needle)}`;
      try {
        const compte =
          (
            await first(chemin, 'SELECT COUNT(*) AS n FROM pages_fts WHERE pages_fts MATCH ?', [
              expression,
            ])
          )?.n ?? 0;
        if (!compte) return { compte: 0, hits: [], moteur: 'fts5' };
        // `pages_fts` est contentless (`content=''`) : ses colonnes ne se
        // relisent pas, seul `rowid` sort — et le pipeline y écrit `page_id`.
        const hits = await all(
          chemin,
          `SELECT p.page_id, p.sequence_num, p.printed_page_num, p.body_plain
             FROM pages_fts
             JOIN pages p ON p.page_id = pages_fts.rowid
            WHERE pages_fts MATCH ?
            ORDER BY p.sequence_num LIMIT ?`,
          [expression, perBook],
        );
        return { compte, hits, moteur: 'fts5' };
      } catch (erreur) {
        // Verdict positif et requête refusée : c'est la couche du greffon, pas
        // le moteur. On le dit et on balaie.
        return {
          ...(await parLike(chemin, pattern, perBook)),
          moteur: `like (fts5 refusé : ${String(erreur?.message ?? erreur)})`,
        };
      }
    }
    return { ...(await parLike(chemin, pattern, perBook)), moteur: 'like' };
  }

  async function parLike(chemin, pattern, perBook) {
    const compte =
      (
        await first(chemin, `SELECT COUNT(*) AS n FROM pages WHERE body_search LIKE ? ESCAPE '\\'`, [
          pattern,
        ])
      )?.n ?? 0;
    if (!compte) return { compte: 0, hits: [] };
    const hits = await all(
      chemin,
      `SELECT page_id, sequence_num, printed_page_num, body_plain
         FROM pages WHERE body_search LIKE ? ESCAPE '\\'
        ORDER BY sequence_num LIMIT ?`,
      [pattern, perBook],
    );
    return { compte, hits };
  }

  /**
   * Recherche le terme dans **tous les livres installés**, un par un.
   *
   * Le contrat d'Electron — ouvrir, lire, refermer ce qu'on a ouvert — tient
   * ici par construction : `ctx.livre()` ne garde **qu'une** connexion, et
   * ouvrir le livre suivant referme le précédent. Le balayage ne peut donc pas
   * faire enfler le processus. Il a un prix, qu'il faut connaître : il chasse
   * aussi le livre en cours de lecture, que le lecteur rouvrira — 50 ms
   * mesurées.
   *
   * [maxBooks] borne le balayage ; `installed` et `skipped` sont renvoyés pour
   * que l'écran dise ce qu'il n'a **pas** parcouru plutôt que de le taire.
   */
  const searchLibrary = (term, { limit = 60, perBook = 5, maxBooks = 60 } = {}) =>
    garde('recherche dans la bibliothèque', async () => {
      const needle = normalizeArabic(term ?? '');
      if (needle.length < 2) {
        return {
          results: [],
          total: 0,
          scanned: 0,
          installed: 0,
          skipped: 0,
          term: needle,
          moteur: null,
        };
      }

      const installes = [...(await idsInstalles())];
      const balayes = installes.slice(0, maxBooks);
      const titres = await titresPour(balayes);
      const marqueur = motifSurligne(needle);

      const fin = chrono();
      const results = [];
      const moteurs = new Set();
      let total = 0;

      for (const editionId of balayes) {
        let chemin;
        try {
          // L'identifiant vient de `user.sqlite` ou du manifeste, pas de
          // l'appelant — mais il désigne un nom de fichier, et la règle ne se
          // relâche pas selon la provenance.
          assertEditionId(editionId);
          chemin = await livre(editionId);
        } catch {
          continue; // fichier disparu ou identifiant douteux : il ne compte pas
        }

        const { compte, hits, moteur } = await occurrencesDans(chemin, needle, perBook);
        moteurs.add(moteur);
        if (!compte) continue;
        total += compte;
        results.push({
          editionId,
          title: titres.get(editionId) ?? editionId,
          matchCount: compte,
          pages: hits.map((row) => ({
            pageId: row.page_id,
            sequenceNum: row.sequence_num,
            printedPageNum: row.printed_page_num ?? null,
            snippet: snippetAround(row.body_plain, marqueur),
          })),
        });
        if (results.length >= limit) break;
      }

      results.sort((a, b) => b.matchCount - a.matchCount);
      const moteur = [...moteurs].join(' · ') || null;
      fin('recherche:bibliotheque', `${moteur ?? 'rien'} — ${total} page(s), ${balayes.length} livre(s)`);

      return {
        results,
        total,
        scanned: balayes.length,
        installed: installes.length,
        skipped: Math.max(0, installes.length - balayes.length),
        term: needle,
        moteur,
      };
    });

  // ------------------------------------------------------------ informations

  /**
   * Ce qu'on réclame quand quelque chose ne va pas.
   *
   * Tout ce qui sort d'ici part **tel quel** dans un rapport de bug : chemins,
   * versions, empreintes. Aucune de ces valeurs ne se convertit en chiffres
   * arabes-indiens — écrite « ٢ », une version de schéma ne se recolle nulle
   * part. La vue le sait (`String(about.schemaVersion)`), et ce module ne
   * formate rien.
   *
   * Deux versions de schéma coexistent et ne disent pas la même chose : celle
   * du catalogue, qui décide de ce qui est lisible, et celle de `user.sqlite`,
   * que le spike ne migre pas. Les deux sont nommées séparément plutôt que
   * confondues sous un seul chiffre qu'un rapport interpréterait de travers.
   */
  /**
   * L'identité de l'APK, telle que le système la connaît.
   *
   * Elle vient du greffon `@capacitor/app`, déjà embarqué pour le geste retour :
   * `versionName` et `versionCode` du `build.gradle`, et non le `package.json`
   * du dépôt — c'est le premier qui est installé sur l'appareil, et les deux
   * peuvent diverger. Absent (vérification hors appareil, ou pont pas encore
   * posé), on rend `null` : la vue tait ce qu'elle n'a pas.
   */
  async function identite() {
    try {
      const info = await pont?.()?.App?.getInfo?.();
      if (!info?.version) return null;
      // Le numéro de build se rapporte avec la version : deux APK peuvent
      // porter le même « 0.3.1 » et n'être pas le même binaire.
      return info.build ? `${info.version} (${info.build})` : String(info.version);
    } catch {
      return null;
    }
  }

  /**
   * Le moteur, à la place du « Electron • Chromium » du bureau : la version
   * d'Android et celle de la WebView. C'est la seconde qui explique la plupart
   * des différences de rendu d'un appareil à l'autre — elle se met à jour par
   * le Play Store, indépendamment du système.
   *
   * Aucun greffon pour ça : `@capacitor/device` serait une dépendance native de
   * plus, `cap sync` à refaire et un quatrième bouchon dans `verify.mjs`, pour
   * deux nombres que la chaîne d'agent porte déjà.
   */
  function moteur() {
    const agent = globalThis.navigator?.userAgent ?? '';
    const android = /Android ([\d.]+)/.exec(agent)?.[1];
    const webview = /Chrome\/([\d.]+)/.exec(agent)?.[1];
    return (
      [android && `Android ${android}`, webview && `WebView ${webview}`]
        .filter(Boolean)
        .join(' • ') || null
    );
  }

  const getAbout = () =>
    garde("lecture des informations d'application", async () => {
      const db = await catalogue();
      const lu = await manifeste().catch(() => null);
      const info = (await first(db, 'SELECT * FROM catalog_info LIMIT 1')) ?? {};

      let userSchemaVersion = null;
      try {
        userSchemaVersion =
          (await allUser('SELECT schema_version FROM user_info LIMIT 1'))[0]?.schema_version ?? null;
      } catch {
        // Pas de `user_info` : le spike n'a pas de base utilisateur migrée.
      }

      return {
        // Les trois mêmes premières lignes que sous Electron : quelle version,
        // sur quoi, dans quel moteur. Un rapport de bug se lit pareil des deux
        // côtés, et la vue est la même.
        appVersion: await identite(),
        platform: 'android',
        runtime: moteur(),
        // La source réelle des fichiers, telle qu'`adb` les a posés.
        librarySource: lu?.devicePaths?.catalog ?? null,
        // Le dossier qui les contient : `catalog.sqlite` retiré du chemin.
        storageRoot: db.replace(/\/[^/]*$/, ''),
        schemaVersion: userSchemaVersion ?? info.schema_version ?? null,
        editionCount: (await first(db, 'SELECT COUNT(*) AS n FROM editions WHERE is_hidden = 0'))?.n ?? 0,
        categoryCount: (await first(db, 'SELECT COUNT(*) AS n FROM categories'))?.n ?? 0,
        // Les faits qui n'ont pas d'équivalent sous Electron, en clair.
        catalogVersion: info.catalog_version ?? null,
        catalogSchemaVersion: info.schema_version ?? null,
        userSchemaVersion,
        catalogPath: db,
        catalogSha256: lu?.catalogSha256 ?? null,
        pushedEditionId: (await editionPoussee()) ?? null,
      };
    });

  return {
    getAuthors,
    getAuthorStats,
    getBooksIn,
    getEras,
    getUndatedCount,
    getBooksByCentury,
    getBooksByAuthor,
    exploreBooks,
    getFacets,
    suggestValues,
    getSelectionWeight,
    getCurricula,
    getCurriculum,
    searchLibrary,
    getAbout,
  };
}
