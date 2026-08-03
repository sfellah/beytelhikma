/**
 * `user.sqlite` sous Capacitor : les vingt et une méthodes qui écrivent.
 *
 * Le shim (`src/repository.capacitor.js`) tenait ses réglages dans une `Map` et
 * rendait la forme vide pour la progression, les collections et les
 * annotations : `user.sqlite` était explicitement hors périmètre du premier
 * spike. Ce module le met dedans, et il est le **seul** à connaître le schéma de
 * cette base.
 *
 * Trois règles ont guidé l'écriture :
 *
 *  1. **Le SQL vient de `src/main/book-repository.js`, repris tel quel.** C'est
 *     du SQL : il ne change pas de moteur en changeant de client. Ce qui change,
 *     c'est la façon de l'envoyer — `await`, et des paramètres liés côté natif.
 *  2. **La forme de retour est un contrat.** Les vues d'Electron tournent ici
 *     sans une ligne modifiée : rendre `[]` là où `{ rows, total }` est attendu
 *     ne produit pas une erreur, mais un écran cassé sans message utile.
 *  3. **Tout décompte affiché vient de SQL ou d'un ensemble complet, jamais de
 *     `rows.length`.** Une page de vingt-quatre livres ne dit pas combien il y
 *     en a.
 *
 * Aucun `import` : le rendu n'a pas de bundler, et ce fichier vit dans deux
 * arbres (`src/repo/` pour la vérification hors appareil, `www/js/repo/` pour
 * l'exécution). Il reçoit donc tout ce qu'il lui faut par `ctx`.
 */
export function creerMethodesUtilisateur(ctx) {
  const {
    RepositoryError,
    garde,
    catalogue,
    all,
    allUser,
    firstUser,
    executerUtilisateur,
    executerBrut,
    SUMMARY_SELECT,
    bookSummary,
    assertEditionId,
    normalizeArabic,
  } = ctx;

  // ------------------------------------------------------------------ schéma

  /**
   * Version de schéma de `user.sqlite`, celle de `app-database.js`. Elle n'est
   * pas décorative : c'est le `PRAGMA user_version` que **tout autre client**
   * lirait pour décider s'il doit créer les tables. Deux clients qui
   * partageraient une racine de bibliothèque doivent lire la même valeur.
   */
  const VERSION_SCHEMA = 3;

  /**
   * Les paliers, indexés par la version qu'ils produisent — la disposition de
   * `USER_MIGRATIONS` dans `app-database.js`, à un détail près : le palier 1 y
   * est implicite (une base fraîche reçoit `USER_SCHEMA` d'un bloc). Ici tout
   * est `IF NOT EXISTS`, donc une base fraîche rejoue simplement les trois
   * paliers et arrive au même endroit. Un chemin au lieu de deux, et rien à
   * tenir en double.
   *
   * Le DDL est celui de `docs/DATAMODEL.md` §4. Deux noms de tables méritent d'être
   * dits en toutes lettres, parce qu'on les cherche ailleurs : la progression
   * de lecture n'a **pas** de table à elle — elle vit dans quatre colonnes de
   * `downloaded_books` (`current_page_id`, `current_sequence_num`,
   * `progress_percent`, `last_opened_at`) — et l'appartenance à une collection
   * s'appelle `collection_books`. C'est ce que le SQL de `book-repository.js`
   * interroge ; inventer `reading_progress` ou `collection_items` reviendrait à
   * réécrire ce SQL, donc à perdre la garantie qu'il est le même des deux côtés.
   */
  const PALIER_1 = [
    `CREATE TABLE IF NOT EXISTS downloaded_books (
       edition_id           TEXT PRIMARY KEY,
       release_id           TEXT,
       local_path           TEXT,
       download_status      TEXT NOT NULL DEFAULT 'installed',
       downloaded_bytes     INTEGER NOT NULL DEFAULT 0,
       total_bytes          INTEGER NOT NULL DEFAULT 0,
       downloaded_at        TEXT,
       last_opened_at       TEXT,
       current_page_id      INTEGER,
       current_sequence_num INTEGER,
       progress_percent     REAL NOT NULL DEFAULT 0
     )`,
    `CREATE TABLE IF NOT EXISTS collections (
       collection_id TEXT PRIMARY KEY,
       name          TEXT NOT NULL,
       description   TEXT,
       sort_order    INTEGER NOT NULL DEFAULT 0,
       created_at    TEXT NOT NULL,
       updated_at    TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS collection_books (
       collection_id TEXT NOT NULL,
       edition_id    TEXT NOT NULL,
       sort_order    INTEGER NOT NULL DEFAULT 0,
       added_at      TEXT NOT NULL,
       PRIMARY KEY (collection_id, edition_id)
     )`,
    `CREATE TABLE IF NOT EXISTS app_settings (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,
    // Propre à cette implémentation, et redondante avec `user_version` : c'est
    // `getAbout` qui la lit, pour dire dans un rapport de bug quelle version de
    // schéma tourne. On la pose ici pour que le jour où `getAbout` sera portée,
    // elle ne trouve pas une base à moitié conforme.
    `CREATE TABLE IF NOT EXISTS user_info (schema_version INTEGER NOT NULL)`,
  ];

  /**
   * Annotations. Trois tables plutôt qu'une : une note peut exister sans
   * surlignage (note de page), un surlignage sans note, et une note peut
   * commenter un surlignage — `notes.highlight_id` porte ce lien.
   *
   * `selected_text`, `prefix_text` et `suffix_text` ne sont pas du confort :
   * les décalages seuls ne survivraient pas à une réédition du livre, et
   * `annotations.js` réancre sur le passage et son contexte quand ils ont
   * bougé.
   */
  const PALIER_2 = [
    `CREATE TABLE IF NOT EXISTS bookmarks (
       bookmark_id TEXT PRIMARY KEY,
       edition_id  TEXT NOT NULL,
       page_id     INTEGER NOT NULL,
       text_offset INTEGER,
       label       TEXT,
       created_at  TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS highlights (
       highlight_id  TEXT PRIMARY KEY,
       edition_id    TEXT NOT NULL,
       page_id       INTEGER NOT NULL,
       start_offset  INTEGER NOT NULL DEFAULT 0,
       end_offset    INTEGER NOT NULL DEFAULT 0,
       selected_text TEXT NOT NULL,
       prefix_text   TEXT,
       suffix_text   TEXT,
       color         TEXT NOT NULL,
       created_at    TEXT NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS notes (
       note_id      TEXT PRIMARY KEY,
       edition_id   TEXT NOT NULL,
       page_id      INTEGER,
       highlight_id TEXT,
       content      TEXT NOT NULL,
       created_at   TEXT NOT NULL,
       updated_at   TEXT NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_bookmarks_edition  ON bookmarks (edition_id, page_id)`,
    `CREATE INDEX IF NOT EXISTS idx_highlights_edition ON highlights (edition_id, page_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_edition      ON notes (edition_id, page_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_highlight    ON notes (highlight_id)`,
  ];

  /** Polices ajoutées depuis Google Fonts ; `faces` est du JSON. */
  const PALIER_3 = [
    `CREATE TABLE IF NOT EXISTS user_fonts (
       key          TEXT PRIMARY KEY,
       family       TEXT NOT NULL,
       scripts      TEXT NOT NULL,
       source_url   TEXT NOT NULL,
       installed_at TEXT NOT NULL,
       faces        TEXT NOT NULL
     )`,
  ];

  const PALIERS = { 1: PALIER_1, 2: PALIER_2, 3: PALIER_3 };

  /**
   * Assemble un lot pour `execute`.
   *
   * Le séparateur n'est pas `;` mais `;` **suivi d'un saut de ligne** :
   * `UtilsSQLite.getStatementsArray` fait `statements.split(";\n")`, puis
   * recolle chaque instruction multiligne en une seule ligne. D'où ce `join`
   * explicite plutôt qu'un `.map(s => s + ';').join('\n')` qui, lui, marcherait
   * par accident.
   */
  const lot = (instructions) => instructions.map((sql) => sql.trim()).join(';\n');

  /**
   * Version en base. `PRAGMA user_version` traverse `query` comme une lecture
   * ordinaire, mais c'est un chemin que la couche JavaScript du greffon peut
   * refuser — et un refus ne doit pas empêcher la base d'exister. On lit donc 0
   * en cas d'échec : tout le DDL est `IF NOT EXISTS`, le pire est de le rejouer
   * à chaque démarrage.
   */
  async function versionEnBase() {
    try {
      const ligne = await firstUser('PRAGMA user_version');
      // Le nom de colonne d'un PRAGMA dépend du moteur : on prend la première
      // valeur si `user_version` n'est pas là, plutôt que de conclure à zéro.
      const brut = ligne?.user_version ?? Object.values(ligne ?? {})[0];
      return Number(brut) || 0;
    } catch {
      return 0;
    }
  }

  let schemaPromise = null;

  /**
   * Crée et migre la base, une fois par session.
   *
   * Appelée avant **toute** lecture comme avant toute écriture, et non « à la
   * première écriture » : `getSettings` est le premier appel de l'application,
   * bien avant qu'on ait rien écrit, et un `SELECT` sur une table absente est
   * une erreur qui emporterait le démarrage.
   *
   * `PRAGMA user_version` est posé **en dernier** : une migration coupée au
   * milieu laisse la version ancienne, donc se rejoue entièrement au démarrage
   * suivant. C'est ce qui rend l'ordre des paliers sans importance et dispense
   * d'une transaction ici — chaque instruction est additive et idempotente.
   */
  function schema() {
    if (schemaPromise) return schemaPromise;
    const promesse = (async () => {
      const version = await versionEnBase();
      if (version >= VERSION_SCHEMA) return VERSION_SCHEMA;

      for (let palier = version + 1; palier <= VERSION_SCHEMA; palier += 1) {
        const instructions = PALIERS[palier] ?? [];
        if (instructions.length) await executerBrut(lot(instructions));
      }
      await executerBrut(
        lot([
          `PRAGMA user_version = ${VERSION_SCHEMA}`,
          'DELETE FROM user_info',
          `INSERT INTO user_info (schema_version) VALUES (${VERSION_SCHEMA})`,
        ]),
      );
      return VERSION_SCHEMA;
    })();
    // Un échec ne se met pas en cache : la base peut n'être pas encore ouverte
    // au premier appel, et la promesse rejetée resterait servie jusqu'au
    // redémarrage.
    promesse.catch(() => {
      if (schemaPromise === promesse) schemaPromise = null;
    });
    schemaPromise = promesse;
    return promesse;
  }

  // ------------------------------------------------------ accès à user.sqlite

  async function lireTout(sql, params = []) {
    await schema();
    return allUser(sql, params);
  }

  async function lireUn(sql, params = []) {
    await schema();
    return firstUser(sql, params);
  }

  async function ecrire(sql, params = []) {
    await schema();
    return executerUtilisateur(sql, params);
  }

  /**
   * Groupe plusieurs écritures en une seule transaction.
   *
   * `run` du greffon accepte bien `transaction: true`, mais il ouvre et referme
   * la transaction autour de **son unique** instruction (`Database.runSQL` :
   * `beginTransaction()` … `commitTransaction()`). Deux appels donnent donc deux
   * transactions, jamais une : ça ne groupe rien. Pire, la seconde échouerait
   * sur « Already in transaction » si la première était restée ouverte — c'est
   * précisément pourquoi `ctx.executerUtilisateur` passe `transaction: false`.
   *
   * L'autre voie serait un lot fixe passé à `executerBrut`, mais celui-ci ne
   * prend pas de paramètres : le contenu d'une note ou le nom d'une collection
   * devraient être concaténés dans le SQL. Ce n'est pas une option.
   *
   * Reste le `BEGIN` / `COMMIT` explicite autour d'écritures paramétrées. Sur
   * Android, `execSQL("BEGIN")` est intercepté par `SQLiteSession` et ouvre une
   * vraie transaction de session, que les `run` suivants rejoignent.
   *
   * Si le greffon refusait ce chemin, les trois méthodes qui l'empruntent
   * échoueraient **bruyamment** au lieu d'écrire à moitié. C'est voulu : dans un
   * spike, un refus est une mesure, pas une panne à masquer.
   */
  async function enBloc(run) {
    await schema();
    await executerBrut('BEGIN');
    try {
      const resultat = await run();
      await executerBrut('COMMIT');
      return resultat;
    } catch (erreur) {
      try {
        await executerBrut('ROLLBACK');
      } catch {
        // Rien à ajouter : c'est l'erreur d'origine qui explique la panne.
      }
      throw erreur;
    }
  }

  /**
   * Identifiant d'annotation ou de collection.
   *
   * `crypto.randomUUID` exige un contexte sûr ; Capacitor sert la page en
   * `https://localhost`, il est donc là. Le repli couvre le cas d'un
   * `androidScheme: "http"`, où son absence ferait échouer *toute* création
   * d'annotation — un défaut coûteux pour quatre lignes de garde.
   */
  function identifiant() {
    if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
    const octets = crypto.getRandomValues(new Uint8Array(16));
    octets[6] = (octets[6] & 0x0f) | 0x40;
    octets[8] = (octets[8] & 0x3f) | 0x80;
    const hex = [...octets].map((o) => o.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const maintenant = () => new Date().toISOString();

  // ------------------------------------------------- projections (verbatim)

  /** Couleur retenue quand l'interface n'en propose pas (jaune de la maquette). */
  const HIGHLIGHT_DEFAULT_COLOR = '#f2c744';

  const highlight = (row) =>
    row == null
      ? null
      : {
          highlightId: row.highlight_id,
          editionId: row.edition_id,
          pageId: row.page_id,
          startOffset: row.start_offset ?? 0,
          endOffset: row.end_offset ?? 0,
          selectedText: row.selected_text,
          prefixText: row.prefix_text ?? null,
          suffixText: row.suffix_text ?? null,
          color: row.color ?? HIGHLIGHT_DEFAULT_COLOR,
          createdAt: row.created_at,
        };

  const note = (row) =>
    row == null
      ? null
      : {
          noteId: row.note_id,
          editionId: row.edition_id,
          pageId: row.page_id ?? null,
          highlightId: row.highlight_id ?? null,
          content: row.content,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };

  const bookmark = (row) =>
    row == null
      ? null
      : {
          bookmarkId: row.bookmark_id,
          editionId: row.edition_id,
          pageId: row.page_id,
          textOffset: row.text_offset ?? null,
          label: row.label ?? null,
          createdAt: row.created_at,
        };

  /**
   * `null` quand rien n'a été lu : le lecteur ouvre alors page un. Une ligne de
   * `downloaded_books` existe dès l'installation, elle ne vaut pas progression.
   */
  const progress = (row) =>
    row.current_page_id == null
      ? null
      : {
          editionId: row.edition_id,
          pageId: row.current_page_id,
          sequenceNum: row.current_sequence_num ?? 1,
          percent: row.progress_percent ?? 0,
          updatedAt: row.last_opened_at ?? null,
        };

  /** Filtres de la bibliothèque, appliqués sur la progression enregistrée. */
  const LIBRARY_FILTERS = {
    all: () => true,
    reading: (row) => (row.progress_percent ?? 0) > 0 && (row.progress_percent ?? 0) < 1,
    done: (row) => (row.progress_percent ?? 0) >= 1,
  };

  // --------------------------------------------------------- ponts catalogue

  /** Ordre alphabétique du catalogue, en identifiants seuls, gardé pour la session. */
  let ordreCache = null;

  /**
   * Le titre vit dans `catalog.sqlite`, l'installation dans `user.sqlite` :
   * deux fichiers, deux connexions, aucun `ORDER BY` ne peut les traverser. On
   * lit donc l'ordre une fois du côté catalogue et on y pioche ce qui est
   * installé — plutôt qu'un `IN (?,?,…)` de plusieurs milliers de paramètres,
   * que SQLite refuserait.
   */
  async function ordreDesTitres() {
    if (ordreCache) return ordreCache;
    const db = await catalogue();
    ordreCache = (
      await all(db, 'SELECT edition_id FROM editions WHERE is_hidden = 0 ORDER BY title_ar')
    ).map((row) => row.edition_id);
    return ordreCache;
  }

  /**
   * Joint une page de lignes installées au catalogue. Deux requêtes pour toute
   * la page, jamais une par livre : c'est la jointure qui coûtait, pas le
   * décompte.
   */
  async function joindreAuCatalogue(lignesInstallees) {
    const db = await catalogue();
    const ids = lignesInstallees.map((row) => row.edition_id);
    const placeholders = ids.map(() => '?').join(',');

    const parId = new Map(
      (
        await all(
          db,
          `${SUMMARY_SELECT} AND e.edition_id IN (${placeholders}) GROUP BY e.edition_id`,
          ids,
        )
      ).map((row) => [row.edition_id, bookSummary(row)]),
    );

    // La release active du catalogue, pour la comparer à celle installée. Une
    // mise à jour de catalogue peut avoir promu une nouvelle édition d'un livre
    // déjà là : on le **signale**, on ne le remplace jamais de force — les
    // ancres de surlignage sont posées sur le texte rendu, et une réédition les
    // déplace.
    const activeParId = new Map(
      (
        await all(
          db,
          `SELECT edition_id, release_id FROM book_releases
            WHERE is_active = 1 AND edition_id IN (${placeholders})`,
          ids,
        )
      ).map((row) => [row.edition_id, row.release_id]),
    );

    const entrees = [];
    for (const row of lignesInstallees) {
      const book = parId.get(row.edition_id);
      if (!book) continue;
      const active = activeParId.get(row.edition_id) ?? null;
      entrees.push({
        book,
        status: row.download_status ?? 'installed',
        progress: progress(row),
        lastOpenedAt: row.last_opened_at ?? null,
        percent: row.progress_percent ?? 0,
        // Faux quand l'une des deux valeurs manque : ne rien savoir n'est pas
        // une raison de proposer un retéléchargement.
        hasNewerRelease: Boolean(row.release_id && active && row.release_id !== active),
      });
    }
    return entrees;
  }

  /** Identifiants des livres installés, pour les décomptes de collection. */
  async function identifiantsInstalles() {
    return (
      await lireTout("SELECT edition_id FROM downloaded_books WHERE download_status = 'installed'")
    ).map((row) => row.edition_id);
  }

  /**
   * Pose `downloadStatus` sur une page de résumés, en une requête.
   *
   * Sans file de téléchargement dans cet exemple, il n'y a pas d'état « en
   * cours » à superposer : la table est la seule vérité. Une carte dont le
   * statut resterait indéfini s'afficherait comme toutes les autres.
   */
  async function marquerStatuts(resumes) {
    if (!resumes.length) return resumes;
    const ids = resumes.map((book) => book.editionId);
    const parId = new Map(
      (
        await lireTout(
          `SELECT edition_id, download_status FROM downloaded_books
            WHERE edition_id IN (${ids.map(() => '?').join(',')})`,
          ids,
        )
      ).map((row) => [row.edition_id, row.download_status]),
    );
    for (const book of resumes) book.downloadStatus = parId.get(book.editionId) ?? null;
    return resumes;
  }

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
            WHERE edition_id IN (${ids.map(() => '?').join(',')})`,
          ids,
        )
      ).map((row) => [row.edition_id, row.title_ar]),
    );
  }

  // ------------------------------------------------------------- réglages

  /**
   * Ce que l'application vaut sur une base vierge.
   *
   * `book-repository.js` ne rend que ce qui est en base et laisse chaque vue
   * replier de son côté ; la `Map` du shim, elle, posait ces valeurs. Les
   * garder évite qu'un premier lancement sous Capacitor se comporte autrement
   * qu'un premier lancement du spike précédent — et n'importe quelle valeur en
   * base les recouvre.
   *
   * `reader.mode` en est **volontairement absent**, pour la raison des clés de
   * police : `resolveReadingMode` replie sur `DEFAULT_READING_MODE`, et une
   * valeur posée ici la recouvrirait — c'est une seconde déclaration du défaut,
   * dans un fichier que `shared/reading-modes.js` ne peut pas atteindre (les
   * fabriques n'ont aucun `import`). Elle disait `page` quand le module partagé
   * disait `scroll` : le bureau ouvrait dans le fil, l'APK sur la feuille, et
   * le défaut partagé n'était jamais lu.
   */
  const DEFAUTS = {
    'app.locale': 'ar',
    'app.theme': 'paper',
    'reader.fontSize': '22',
  };

  const getSettings = () =>
    garde('lecture des réglages', async () => ({
      ...DEFAUTS,
      ...Object.fromEntries(
        (await lireTout('SELECT key, value FROM app_settings')).map((row) => [row.key, row.value]),
      ),
    }));

  const saveSetting = (key, value) =>
    garde("enregistrement d'un réglage", async () => {
      await ecrire('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [
        String(key),
        String(value),
      ]);
    });

  // ----------------------------------------------------------- progression

  const getProgress = (editionId) =>
    garde('lecture de la progression', async () => {
      const row = await lireUn(
        `SELECT * FROM downloaded_books
          WHERE edition_id = ? AND current_page_id IS NOT NULL LIMIT 1`,
        [editionId],
      );
      return row ? progress(row) : null;
    });

  /**
   * Appelée à chaque tournage de page, après un délai.
   *
   * L'identifiant est validé ici et pas seulement à l'ouverture : ce qu'on
   * **écrit** dans `downloaded_books` ressortira par `getLibrary` et servira à
   * ouvrir `books/<edition_id>.sqlite`. Le refuser à l'entrée dispense de s'en
   * méfier partout ensuite.
   */
  const saveProgress = ({ editionId, pageId, sequenceNum, percent, updatedAt }) =>
    garde('enregistrement de la progression', async () => {
      assertEditionId(editionId);
      await ecrire(
        `INSERT INTO downloaded_books
           (edition_id, download_status, current_page_id,
            current_sequence_num, progress_percent, last_opened_at)
         VALUES (?, 'installed', ?, ?, ?, ?)
         ON CONFLICT(edition_id) DO UPDATE SET
           current_page_id      = excluded.current_page_id,
           current_sequence_num = excluded.current_sequence_num,
           progress_percent     = excluded.progress_percent,
           last_opened_at       = excluded.last_opened_at`,
        [editionId, pageId, sequenceNum ?? 1, percent ?? 0, updatedAt ?? maintenant()],
      );
    });

  const getContinueReading = () =>
    garde('lecture de la reprise', async () => {
      const lignes = await lireTout(
        `SELECT * FROM downloaded_books
          WHERE last_opened_at IS NOT NULL AND download_status = 'installed'
          ORDER BY last_opened_at DESC LIMIT 1`,
      );
      if (!lignes.length) return null;
      return (await joindreAuCatalogue(lignes))[0] ?? null;
    });

  /**
   * Bibliothèque paginée : `{ rows, total, counts, orphans }`.
   *
   * Le filtre et le tri portent sur `user.sqlite`, qui ne contient qu'une ligne
   * courte par livre installé ; seule la page demandée est jointe au catalogue.
   *
   * Une ligne qui désigne une édition que le catalogue courant ne connaît plus
   * ne compte pas : sans titre ni auteur, il n'y a rien à dessiner, et
   * l'annoncer dans `total` promettrait des pages que la jointure ne saurait pas
   * remplir. Son fichier reste sur l'appareil — une mise à jour de catalogue ne
   * supprime jamais un livre —, on dit seulement combien il y en a.
   */
  const getLibrary = ({ offset = 0, limit = 24, filter = 'all', sort = 'recent' } = {}) =>
    garde('lecture de la bibliothèque', async () => {
      const ordre = await ordreDesTitres();
      const connues = new Set(ordre);

      const toutes = await lireTout(
        `SELECT * FROM downloaded_books
          WHERE download_status = 'installed'
          ORDER BY last_opened_at DESC, downloaded_at DESC`,
      );
      const installees = toutes.filter((row) => connues.has(row.edition_id));
      const orphans = toutes.length - installees.length;

      const counts = {
        all: installees.length,
        reading: installees.filter(LIBRARY_FILTERS.reading).length,
        done: installees.filter(LIBRARY_FILTERS.done).length,
      };

      let retenues = installees.filter(LIBRARY_FILTERS[filter] ?? LIBRARY_FILTERS.all);
      if (sort === 'title') {
        const parId = new Map(retenues.map((row) => [row.edition_id, row]));
        retenues = ordre.map((id) => parId.get(id)).filter(Boolean);
      }

      const rows = retenues.length
        ? await joindreAuCatalogue(retenues.slice(offset, offset + limit))
        : [];
      return { rows, total: retenues.length, counts, orphans };
    });

  // ------------------------------------------------------------ collections

  /**
   * Collections personnelles. Elles ne contiennent que des références :
   * supprimer une collection n'efface jamais un livre, et une collection peut
   * porter des livres non installés — c'est autant une liste d'envies qu'un
   * rangement.
   *
   * Rend un **tableau**, pas `{ rows, total }` : `collectionsStrip` les affiche
   * toutes, et une collection de plus ne fait pas une page de plus.
   */
  const getCollections = () =>
    garde('lecture des collections', async () => {
      const installes = new Set(await identifiantsInstalles());
      const rows = await lireTout('SELECT * FROM collections ORDER BY sort_order, created_at');
      const liens = await lireTout('SELECT collection_id, edition_id FROM collection_books');

      return rows.map((row) => {
        const membres = liens.filter((lien) => lien.collection_id === row.collection_id);
        return {
          id: row.collection_id,
          name: row.name,
          description: row.description ?? null,
          bookCount: membres.length,
          installedCount: membres.filter((lien) => installes.has(lien.edition_id)).length,
          createdAt: row.created_at,
        };
      });
    });

  /**
   * Un nom vide n'est pas une panne de base : le distinguer d'un
   * `query-failed` évite de proposer un « réessayer » qui échouera pareil.
   */
  const nomOuErreur = (name, quoi) => {
    const label = String(name ?? '').trim();
    if (!label) throw new RepositoryError(quoi, 'invalid-input');
    return label;
  };

  const createCollection = (name) =>
    garde("création d'une collection", async () => {
      const label = nomOuErreur(name, 'nom de collection vide');
      const id = identifiant();
      const now = maintenant();
      await ecrire(
        `INSERT INTO collections (collection_id, name, description, sort_order, created_at, updated_at)
         VALUES (?,?,NULL,
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collections), ?, ?)`,
        [id, label, now, now],
      );
      return id;
    });

  const renameCollection = (collectionId, name) =>
    garde("renommage d'une collection", async () => {
      const label = nomOuErreur(name, 'nom de collection vide');
      await ecrire('UPDATE collections SET name = ?, updated_at = ? WHERE collection_id = ?', [
        label,
        maintenant(),
        collectionId,
      ]);
    });

  /** Les liens partent, les livres restent installés. */
  const deleteCollection = (collectionId) =>
    garde("suppression d'une collection", async () =>
      enBloc(async () => {
        await ecrire('DELETE FROM collection_books WHERE collection_id = ?', [collectionId]);
        await ecrire('DELETE FROM collections WHERE collection_id = ?', [collectionId]);
      }),
    );

  /**
   * Rend le nombre de livres **réellement** ajoutés : `changes` vaut 0 quand
   * l'insertion est ignorée, c'est-à-dire quand le livre était déjà là. Compter
   * les identifiants reçus ferait dire « 12 ajoutés » sur douze doublons.
   */
  const addToCollection = (collectionId, editionIds = []) =>
    garde('ajout à une collection', async () => {
      if (!editionIds.length) return 0;
      for (const editionId of editionIds) assertEditionId(editionId);
      const now = maintenant();
      return enBloc(async () => {
        let ajoutes = 0;
        for (const editionId of editionIds) {
          const { changes } = await ecrire(
            `INSERT OR IGNORE INTO collection_books (collection_id, edition_id, sort_order, added_at)
             VALUES (?,?,
                     (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM collection_books
                       WHERE collection_id = ?), ?)`,
            [collectionId, editionId, collectionId, now],
          );
          if (changes > 0) ajoutes += 1;
        }
        return ajoutes;
      });
    });

  const removeFromCollection = (collectionId, editionId) =>
    garde("retrait d'une collection", async () => {
      await ecrire('DELETE FROM collection_books WHERE collection_id = ? AND edition_id = ?', [
        collectionId,
        editionId,
      ]);
    });

  /**
   * Lesquels de ces livres sont déjà dans la collection. La question est
   * **bornée par ce qu'on montre** : le mode d'édition puise dans tout le
   * catalogue, et rendre la liste entière des membres ferait traverser le pont
   * natif des milliers d'identifiants pour n'en éclairer qu'une vingtaine.
   */
  const getCollectionMembership = (collectionId, editionIds = []) =>
    garde("lecture de l'appartenance à une collection", async () => {
      if (!Array.isArray(editionIds) || !editionIds.length) return [];
      const rows = await lireTout(
        `SELECT edition_id FROM collection_books
          WHERE collection_id = ? AND edition_id IN (${editionIds.map(() => '?').join(',')})`,
        [collectionId, ...editionIds],
      );
      return rows.map((row) => row.edition_id);
    });

  /**
   * Contenu d'une collection, paginé : `{ rows, total, missing }`.
   *
   * `missing` porte sur **l'ensemble**, pas sur la page : c'est lui qui
   * alimente « tout télécharger », qui proposerait sinon moins de livres qu'il
   * n'y en a à prendre.
   */
  const getCollectionBooks = (collectionId, { offset = 0, limit = 24 } = {}) =>
    garde("lecture d'une collection", async () => {
      const ids = (
        await lireTout(
          'SELECT edition_id FROM collection_books WHERE collection_id = ? ORDER BY sort_order',
          [collectionId],
        )
      ).map((row) => row.edition_id);
      if (!ids.length) return { rows: [], total: 0, missing: [] };

      const installes = new Set(await identifiantsInstalles());
      const missing = ids.filter((id) => !installes.has(id));

      const tranche = ids.slice(offset, offset + limit);
      const db = await catalogue();
      const livres = await marquerStatuts(
        (
          await all(
            db,
            `${SUMMARY_SELECT} AND e.edition_id IN (${tranche.map(() => '?').join(',')})
             GROUP BY e.edition_id`,
            tranche,
          )
        ).map(bookSummary),
      );

      // L'ordre de la collection prime sur celui du catalogue ; une édition
      // absente du catalogue courant est simplement ignorée.
      const parId = new Map(livres.map((book) => [book.editionId, book]));
      return { rows: tranche.map((id) => parId.get(id)).filter(Boolean), total: ids.length, missing };
    });

  // ------------------------------------------------------------ annotations

  /**
   * Toutes les annotations d'un livre, en un aller-retour : le lecteur les
   * réapplique page par page sans requêter à chaque tournage.
   */
  const getBookAnnotations = (editionId) =>
    garde('lecture des annotations', async () => ({
      highlights: (
        await lireTout('SELECT * FROM highlights WHERE edition_id = ? ORDER BY page_id, start_offset', [
          editionId,
        ])
      ).map(highlight),
      notes: (
        await lireTout('SELECT * FROM notes WHERE edition_id = ? ORDER BY created_at DESC', [
          editionId,
        ])
      ).map(note),
      bookmarks: (
        await lireTout('SELECT * FROM bookmarks WHERE edition_id = ? ORDER BY page_id', [editionId])
      ).map(bookmark),
    }));

  /**
   * Rend le surlignage **relu en base**, pas l'objet d'entrée : le lecteur
   * remplace l'entrée de même identifiant par ce qu'il reçoit, et une couleur
   * repliée sur son défaut doit lui revenir telle qu'elle a été écrite.
   */
  const saveHighlight = (input) =>
    garde("enregistrement d'un surlignage", async () => {
      const text = String(input.selectedText ?? '').trim();
      if (!text) throw new RepositoryError('surlignage sans texte', 'invalid-input');
      assertEditionId(input.editionId);
      const id = input.highlightId ?? identifiant();
      await ecrire(
        `INSERT INTO highlights
           (highlight_id, edition_id, page_id, start_offset, end_offset,
            selected_text, prefix_text, suffix_text, color, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(highlight_id) DO UPDATE SET
           color        = excluded.color,
           start_offset = excluded.start_offset,
           end_offset   = excluded.end_offset`,
        [
          id,
          input.editionId,
          input.pageId,
          input.startOffset ?? 0,
          input.endOffset ?? 0,
          text,
          input.prefixText ?? null,
          input.suffixText ?? null,
          input.color ?? HIGHLIGHT_DEFAULT_COLOR,
          maintenant(),
        ],
      );
      return highlight(await lireUn('SELECT * FROM highlights WHERE highlight_id = ?', [id]));
    });

  /**
   * Le surlignage part avec les notes qui ne commentaient que lui — deux
   * écritures qui n'ont de sens qu'ensemble : une note orpheline s'afficherait
   * dans « ملاحظاتي » en citant un passage qui n'existe plus.
   */
  const deleteHighlight = (highlightId) =>
    garde("suppression d'un surlignage", async () =>
      enBloc(async () => {
        await ecrire('DELETE FROM notes WHERE highlight_id = ?', [highlightId]);
        await ecrire('DELETE FROM highlights WHERE highlight_id = ?', [highlightId]);
      }),
    );

  const saveNote = (input) =>
    garde("enregistrement d'une note", async () => {
      const content = String(input.content ?? '').trim();
      if (!content) throw new RepositoryError('note vide', 'invalid-input');
      assertEditionId(input.editionId);
      const id = input.noteId ?? identifiant();
      const now = maintenant();
      await ecrire(
        `INSERT INTO notes
           (note_id, edition_id, page_id, highlight_id, content, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(note_id) DO UPDATE SET
           content      = excluded.content,
           page_id      = COALESCE(excluded.page_id, notes.page_id),
           highlight_id = COALESCE(excluded.highlight_id, notes.highlight_id),
           updated_at   = excluded.updated_at`,
        [id, input.editionId, input.pageId ?? null, input.highlightId ?? null, content, now, now],
      );
      return note(await lireUn('SELECT * FROM notes WHERE note_id = ?', [id]));
    });

  const deleteNote = (noteId) =>
    garde("suppression d'une note", async () => {
      await ecrire('DELETE FROM notes WHERE note_id = ?', [noteId]);
    });

  /**
   * Pose ou retire la marque-page de la page : le lecteur n'a qu'un bouton.
   * Rend `{ added, bookmark }` — la vue s'en sert pour ajouter ou retirer
   * l'entrée de sa liste sans tout redemander.
   */
  const toggleBookmark = ({ editionId, pageId, label = null, textOffset = null }) =>
    garde("bascule d'une marque-page", async () => {
      assertEditionId(editionId);
      const existant = await lireUn(
        'SELECT bookmark_id FROM bookmarks WHERE edition_id = ? AND page_id = ?',
        [editionId, pageId],
      );
      if (existant) {
        await ecrire('DELETE FROM bookmarks WHERE bookmark_id = ?', [existant.bookmark_id]);
        return { added: false, bookmark: null };
      }
      const id = identifiant();
      await ecrire(
        `INSERT INTO bookmarks (bookmark_id, edition_id, page_id, text_offset, label, created_at)
         VALUES (?,?,?,?,?,?)`,
        [id, editionId, pageId, textOffset, label, maintenant()],
      );
      return {
        added: true,
        bookmark: bookmark(await lireUn('SELECT * FROM bookmarks WHERE bookmark_id = ?', [id])),
      };
    });

  const deleteBookmark = (bookmarkId) =>
    garde("suppression d'une marque-page", async () => {
      await ecrire('DELETE FROM bookmarks WHERE bookmark_id = ?', [bookmarkId]);
    });

  /**
   * Vue transversale des annotations, tous livres confondus, pour « ملاحظاتي ».
   *
   * Le filtre texte passe par `normalizeArabic` en mémoire et non par un
   * `LIKE` : les colonnes de `user.sqlite` ne sont pas normalisées, et un `LIKE`
   * ignorerait les variantes de hamza que l'utilisateur a lui-même tapées. Les
   * volumes sont de l'ordre du millier.
   *
   * `total` est celui de l'ensemble filtré, `counts` celui de chaque type
   * **sans** le filtre de type — sinon l'onglet qu'on ne regarde pas
   * annoncerait toujours zéro.
   */
  const getAnnotations = ({
    kind = 'all',
    text = null,
    editionId = null,
    offset = 0,
    limit = 30,
  } = {}) =>
    garde('lecture des annotations', async () => {
      const clause = editionId ? ' WHERE edition_id = ?' : '';
      const params = editionId ? [editionId] : [];

      const items = [];
      if (kind === 'all' || kind === 'note') {
        items.push(
          ...(await lireTout(`SELECT * FROM notes${clause}`, params)).map((row) => ({
            ...note(row),
            kind: 'note',
            sortKey: row.updated_at ?? row.created_at,
            searchText: `${row.content}`,
          })),
        );
      }
      if (kind === 'all' || kind === 'highlight') {
        items.push(
          ...(await lireTout(`SELECT * FROM highlights${clause}`, params)).map((row) => ({
            ...highlight(row),
            kind: 'highlight',
            sortKey: row.created_at,
            searchText: row.selected_text,
          })),
        );
      }
      if (kind === 'all' || kind === 'bookmark') {
        items.push(
          ...(await lireTout(`SELECT * FROM bookmarks${clause}`, params)).map((row) => ({
            ...bookmark(row),
            kind: 'bookmark',
            sortKey: row.created_at,
            searchText: row.label ?? '',
          })),
        );
      }

      const needle = normalizeArabic(text ?? '');
      const filtres = needle
        ? items.filter((item) => normalizeArabic(item.searchText).includes(needle))
        : items;
      filtres.sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));

      const visibles = filtres.slice(offset, offset + limit);
      const titres = await titresPour(visibles.map((item) => item.editionId));
      // Une note peut commenter un surlignage : on rapproche les deux ici
      // plutôt qu'en SQL, la page est déjà en mémoire.
      const surlignagesParId = new Map(
        (await lireTout('SELECT * FROM highlights')).map((row) => [
          row.highlight_id,
          highlight(row),
        ]),
      );

      const compteDe = async (table) =>
        (await lireUn(`SELECT COUNT(*) AS n FROM ${table}${clause}`, params))?.n ?? 0;

      return {
        total: filtres.length,
        counts: {
          note: await compteDe('notes'),
          highlight: await compteDe('highlights'),
          bookmark: await compteDe('bookmarks'),
        },
        items: visibles.map(({ searchText, sortKey, ...item }) => ({
          ...item,
          bookTitle: titres.get(item.editionId) ?? item.editionId,
          highlight: item.highlightId ? surlignagesParId.get(item.highlightId) ?? null : null,
        })),
      };
    });

  return {
    /**
     * Exposée hors des 21 méthodes, et retirée par l'assembleur avant fusion —
     * `verify.mjs` exige une surface **exactement** égale à `METHODS`.
     *
     * Elle existe parce que les autres modules écrivent dans `user.sqlite` sans
     * passer par ici : `polices` y inscrit ses familles, `telechargements` y
     * tient l'état des installations. Sans ce point d'entrée, ils frapperaient
     * une base non migrée, et `installFont` échouerait **après** avoir déposé
     * ses fichiers, qui resteraient orphelins.
     *
     * Ce module, lui, ne s'en sert pas : ses propres accès sont déjà gardés, et
     * la migration écrit par `executerBrut` — la faire passer par un accès gardé
     * la ferait s'attendre elle-même.
     */
    __assurerSchema: schema,

    getSettings,
    saveSetting,
    getProgress,
    saveProgress,
    getContinueReading,
    getLibrary,
    getCollections,
    createCollection,
    renameCollection,
    deleteCollection,
    addToCollection,
    removeFromCollection,
    getCollectionBooks,
    getCollectionMembership,
    getBookAnnotations,
    getAnnotations,
    saveHighlight,
    deleteHighlight,
    saveNote,
    deleteNote,
    toggleBookmark,
    deleteBookmark,
  };
}
