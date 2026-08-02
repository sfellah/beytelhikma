/**
 * Téléchargement des livres et mise à jour du catalogue, dans la WebView.
 *
 * Portage de `src/main/download-manager.js` et `src/main/catalog-updater.js`.
 * Les garanties du projet ne bougent pas — elles ne dépendent d'aucun runtime :
 *
 *   1. reprise par en-tête `Range` sur un `.part` conservé entre deux essais ;
 *   2. SHA-256 vérifié **avant** que le fichier définitif n'existe ;
 *   3. le `rename` est le **dernier geste** — une coupure à n'importe quel point
 *      laisse l'ancien fichier intact et lisible ;
 *   4. file **séquentielle** : un seul téléchargement actif ;
 *   5. erreurs typées, messages en arabe.
 *
 * Ce qui change, c'est la plomberie. Node donnait des flux (`pipeline`,
 * `createHash`, `zlib`) qui traversaient les octets sans jamais les tenir en
 * entier. Ici il n'y a ni flux d'écriture ni hachage incrémental :
 * `@capacitor/filesystem` écrit du **base64**, et `crypto.subtle.digest` ne
 * traite qu'un tampon complet. Les deux choix qui en découlent — écriture par
 * tranches, hachage sur le tampon décompressé avant écriture — sont commentés
 * là où ils se prennent.
 *
 * ⚠ CSP. `www/index.html` porte `default-src 'none'`, qui couvre `connect-src` :
 * **aucun `fetch` sortant n'est autorisé aujourd'hui**. Ce module en fait deux
 * (le pointeur de catalogue, puis l'objet). Il manque, dans le `<meta>` :
 *
 *     connect-src https://beytelhima-library.s3.eu-west-1.amazonaws.com;
 *
 * Une seule directive, un seul hôte — celui de `DEFAULT_BASE_URL`. Un
 * `distribution.base_url` réglé ailleurs devra y être nommé aussi ; `https:`
 * tout court marcherait mais ouvrirait la page à n'importe quel serveur, ce qui
 * défait la moitié de `assertBaseUrl`. `index.html` est régénéré par
 * `prepare-www.mjs` : la règle se pose là-bas, pas ici.
 *
 * Aucun `import` statique : le rendu se sert sans bundler, et ce fichier est
 * appelé par le shim qui lui passe tout ce dont il a besoin.
 */

// --------------------------------------------------------------- constantes

/**
 * Messages destinés à l'utilisateur, repris mot pour mot de `DOWNLOAD_MESSAGES`
 * de `download-manager.js`. Les recopier est ici la bonne réponse : le module
 * d'origine est un module Node (`node:fs`, `node:zlib`) qu'aucune WebView ne
 * charge, et ces cinq phrases sont le contrat visible de l'échec.
 */
const DOWNLOAD_MESSAGES = {
  network: 'تعذّر الاتصال بالخادم',
  notFound: 'الملف غير متوفر على الخادم',
  checksum: 'الملف المُنزَّل تالف',
  diskFull: 'لا توجد مساحة كافية',
  aborted: 'أُلغي التنزيل',
};

/**
 * Taille d'une tranche d'écriture : **384 Kio**.
 *
 * `Filesystem.writeFile` et `appendFile` prennent du base64, pas des octets :
 * chaque tranche traverse le pont sous forme de chaîne, et le natif la décode
 * avant de l'ajouter au fichier. Écrire un livre d'un seul appel demanderait de
 * tenir en mémoire les octets **et** leur transcription base64 (4/3 de la
 * taille), soit près du double du fichier — exactement ce qu'on cherche à
 * éviter.
 *
 * 384 Kio parce que :
 *
 * - c'est un multiple de 3, donc chaque tranche s'encode sans remplissage `=`.
 *   Le natif décode chaque appel séparément, le remplissage serait inoffensif ;
 *   mais une tranche alignée reste la forme qui ne peut pas mal tourner si un
 *   jour quelqu'un concatène le base64 au lieu des octets ;
 * - la chaîne transmise fait alors exactement 512 Kio, ce qui reste un message
 *   confortable pour le pont Android ;
 * - un livre de 40 Mo coûte une centaine d'allers-retours, pas des milliers.
 *   Chaque `appendFile` ouvre et referme le fichier côté natif : la tranche
 *   trop petite se paie en syscalls, la trop grosse en mémoire.
 */
const TRANCHE = 384 * 1024;

/** Écriture d'état au plus une fois par 500 ms, comme le modèle. */
const PERIODE_ECRITURE_MS = 500;

/** Clé du pointeur, seul objet du bucket qui change sous une clé fixe. */
const CLE_POINTEUR = 'catalog/latest.json';

/** Version de schéma de catalogue que ce client sait lire. */
const SCHEMA_CATALOGUE_SUPPORTE = 2;

const DELAI_POINTEUR_MS = 8000;

/**
 * Un SHA-256 en hexadécimal, et rien d'autre. L'empreinte est **exigée** d'un
 * pointeur, pas seulement comparée quand elle est là : c'est le catalogue qui
 * devient ensuite la source de vérité de toute l'application.
 */
const EMPREINTE_VALIDE = /^[0-9a-f]{64}$/i;

/**
 * `distribution.js` se charge à la demande, par URL absolue.
 *
 * Le recopier serait la faute que le projet a déjà payée trois fois. La règle
 * « la présence de `://` marque un absolu », le refus de `http` hors boucle
 * locale, la façon dont une base et une clé se collent : tout cela vit dans
 * `src/shared/distribution.js` **et nulle part ailleurs**, et une seconde
 * implémentation divergerait en silence — l'application irait chercher les
 * livres au mauvais endroit sans qu'aucun test n'échoue.
 *
 * L'URL est absolue (`/shared/…`) et non relative parce que la place finale de
 * ce fichier sous `www/js/` n'est pas fixée, tandis que `www/shared/` l'est :
 * `prepare-www.mjs` y dépose `src/shared/` entier, à la racine du serveur que
 * Capacitor présente. Chargement différé, comme `arabic.js` dans le shim : hors
 * de la WebView (par exemple sous `verify.mjs`), le module n'est jamais demandé
 * tant qu'on ne télécharge rien.
 */
let distributionPromise = null;

function distribution() {
  distributionPromise ??= import(new URL('/shared/distribution.js', import.meta.url).href).catch(
    (erreur) => {
      // Un échec ne se met pas en cache : la tentative suivante doit retenter.
      distributionPromise = null;
      throw erreur;
    },
  );
  return distributionPromise;
}

/**
 * Tables de `user.sqlite` que ce module écrit, au DDL de `USER_SCHEMA`
 * (`src/main/app-database.js`). Additif et rejoué à chaque démarrage : si le
 * shim porte un jour la base utilisateur, ces deux instructions deviendront des
 * non-opérations sans qu'il y ait rien à retirer ici.
 */
const SCHEMA_UTILISATEUR = `
  CREATE TABLE IF NOT EXISTS downloaded_books (
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
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

/** Tris proposés par la table de gestion. Toute autre clé retombe sur le titre. */
const TRIS = {
  title: 'e.title_ar',
  recent: 'r.published_at DESC, e.title_ar',
  pages: 'r.page_count DESC, e.title_ar',
  size: 'r.compressed_size DESC, e.title_ar',
};

/** Une page de la table de gestion ne dépasse jamais cette taille. */
const LIMITE_MAX = 200;

/**
 * Projection de la table de gestion. Elle porte `book_type_label` et
 * `death_year_hijri` : ce sont deux des trois canaux de la couverture composée
 * (`src/shared/book-cover.js`), et une projection qui les oublie fait tomber
 * l'écran entier sur les replis.
 */
const COLONNES_RESUME = `
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
  r.page_count, r.published_at, r.compressed_size, r.uncompressed_size`;

const DEPUIS = `
  FROM editions e
  LEFT JOIN book_releases r ON r.edition_id = e.edition_id AND r.is_active = 1
  WHERE e.is_hidden = 0 AND `;

// ------------------------------------------------------------- base64 et hexa

/**
 * Octets vers base64. `btoa(String.fromCharCode(...octets))` étale le tableau
 * en arguments : au-delà de quelques dizaines de milliers d'éléments, le moteur
 * refuse l'appel. On avance donc par blocs de 32 Kio, qui est un compromis
 * connu et sans surprise.
 */
function versBase64(octets) {
  const BLOC = 0x8000;
  let binaire = '';
  for (let i = 0; i < octets.length; i += BLOC) {
    binaire += String.fromCharCode.apply(null, octets.subarray(i, i + BLOC));
  }
  return btoa(binaire);
}

/** Base64 vers octets. */
function depuisBase64(texte) {
  const binaire = atob(texte);
  const octets = new Uint8Array(binaire.length);
  for (let i = 0; i < binaire.length; i += 1) octets[i] = binaire.charCodeAt(i);
  return octets;
}

/** `readFile` rend du base64 sur l'appareil, un `Blob` sur le web. */
async function enOctets(donnees) {
  if (typeof donnees === 'string') return depuisBase64(donnees);
  if (donnees?.arrayBuffer) return new Uint8Array(await donnees.arrayBuffer());
  return new Uint8Array(0);
}

function versHexa(tampon) {
  return [...new Uint8Array(tampon)].map((octet) => octet.toString(16).padStart(2, '0')).join('');
}

/**
 * SHA-256 d'un tampon complet.
 *
 * `crypto.subtle.digest` ne traite **pas** un flux : il n'y a pas d'équivalent
 * de `createHash().update()`. Le tampon doit donc exister d'un seul tenant au
 * moment du hachage — c'est la contrainte qui gouverne tout `deballerEtVerifier`
 * ci-dessous. `subtle` exige par ailleurs un contexte sécurisé : Capacitor sert
 * la page depuis `https://localhost`, la condition est remplie.
 */
async function sha256Hexa(octets) {
  return versHexa(await crypto.subtle.digest('SHA-256', octets));
}

// --------------------------------------------- décision de mise à jour (pure)

function estEntierPositif(valeur) {
  return Number.isInteger(valeur) && valeur > 0;
}

/**
 * Décide s'il y a lieu de proposer une mise à jour du catalogue.
 *
 * Fonction pure, portée telle quelle depuis `catalog-updater.js` : c'est elle
 * qu'on teste, pas le réseau. **Cinq branches sur six sont silencieuses** — une
 * application hors ligne a déjà tout ce qu'il lui faut pour explorer, et lui
 * afficher une alerte serait du bruit. Toute branche silencieuse rend
 * `pointer: null`, pour qu'aucun appelant ne puisse installer ce qu'on vient de
 * refuser.
 */
export function decideUpdate({ pointer, localVersion, declinedVersion }) {
  if (!pointer || typeof pointer !== 'object') {
    return { action: 'none', reason: 'noPointer', pointer: null };
  }
  if (!estEntierPositif(pointer.catalog_version) || !pointer.object_key) {
    return { action: 'none', reason: 'malformed', pointer: null };
  }
  // Sans empreinte, rien à vérifier à l'installation : on ne le propose donc
  // même pas. Le refus est silencieux comme les autres — l'utilisateur n'a
  // aucune action à entreprendre, c'est la publication qui est fautive.
  if (!EMPREINTE_VALIDE.test(String(pointer.sha256 ?? ''))) {
    return { action: 'none', reason: 'malformed', pointer: null };
  }
  if (
    !estEntierPositif(pointer.schema_version) ||
    pointer.schema_version > SCHEMA_CATALOGUE_SUPPORTE
  ) {
    // L'application est trop ancienne pour ce catalogue. Le dire n'aiderait
    // pas : elle ne peut rien en faire.
    return { action: 'none', reason: 'schemaTooNew', pointer: null };
  }
  if (pointer.catalog_version <= (localVersion ?? 0)) {
    return { action: 'none', reason: 'upToDate', pointer: null };
  }
  if (pointer.catalog_version === declinedVersion) {
    return { action: 'none', reason: 'declined', pointer: null };
  }
  return { action: 'offer', reason: 'newer', pointer };
}

// ------------------------------------------------------------------ fabrique

/**
 * Rend les quinze méthodes de téléchargement, fermées sur [ctx].
 *
 * [ctx] porte les erreurs, les accès aux trois bases, le système de fichiers,
 * la validation d'identifiant, `decompressZstd` et `emettreChangement`.
 */
export function creerMethodesTelechargements(ctx) {
  const {
    RepositoryError,
    garde,
    chrono,
    catalogue,
    all,
    first,
    allUser,
    executerUtilisateur,
    executerBrut,
    racineAppareil,
    filesystem,
    sqlite,
    assertEditionId,
    decompressZstd,
    emettreChangement,
  } = ctx;

  /**
   * Échec de téléchargement : un code stable et une phrase arabe.
   *
   * Elle **descend** de `RepositoryError` pour que `garde` la laisse traverser
   * intacte — sinon elle serait ré-emballée en `query-failed` générique et la
   * phrase arabe disparaîtrait. `message` est réécrit après `super` parce que
   * `errorView` et `toast` affichent `error.message` tel quel : ce doit être la
   * phrase, pas le « Échec : … » que `RepositoryError` compose.
   */
  class DownloadError extends RepositoryError {
    constructor(code, cause) {
      const phrase = DOWNLOAD_MESSAGES[code] ?? code;
      super(phrase, code, cause);
      this.name = 'DownloadError';
      this.message = phrase;
    }
  }

  // ------------------------------------------------------------- le disque

  const fs = () => filesystem();

  const cheminPart = (racine, id) => `${racine}/downloads/${id}.zst.part`;
  const cheminTemp = (racine, id) => `${racine}/downloads/${id}.sqlite.tmp`;
  const cheminInstalle = (racine, id) => `${racine}/books/${id}.sqlite`;
  const cheminCatalogue = (racine) => `${racine}/catalog.sqlite`;

  /**
   * Les chemins sont **absolus** et `directory` est omis : le greffon accepte
   * alors un chemin complet (`getFileObject` fait `File(uri.path)` quand aucun
   * répertoire n'est nommé). C'est la seule forme qui coïncide avec celle que
   * le greffon SQLite exige, et deux conventions de chemin dans le même module
   * seraient une source d'erreur permanente.
   */
  let dossiersPromise = null;

  function assureDossiers(racine) {
    dossiersPromise ??= (async () => {
      for (const dossier of [`${racine}/books`, `${racine}/downloads`]) {
        try {
          await fs().mkdir({ path: dossier, recursive: true });
        } catch {
          // Déjà présent — le cas courant, et le seul qu'on attende ici.
        }
      }
    })();
    return dossiersPromise;
  }

  /** Taille d'un fichier, ou 0 s'il n'existe pas. */
  async function taille(chemin) {
    try {
      return Number((await fs().stat({ path: chemin }))?.size) || 0;
    } catch {
      return 0;
    }
  }

  /** Suppression tolérante : l'absence n'est pas un échec. */
  async function supprimer(chemin) {
    try {
      await fs().deleteFile({ path: chemin });
    } catch {
      // Déjà absent, ou jamais créé.
    }
  }

  /**
   * Test non levant, pour filtrer un **listage de dossier**.
   *
   * `assertEditionId` lève, et c'est ce qu'on veut d'un identifiant venu du
   * rendu. Mais `books/` peut porter autre chose qu'un livre — un reste d'import
   * interrompu, un fichier déposé à la main — et un `deleteAllBooks` qui lèverait
   * sur la première anomalie laisserait tout le reste en place.
   */
  const estEditionId = (valeur) => {
    try {
      assertEditionId(valeur);
      return true;
    } catch {
      return false;
    }
  };

  /** `{ nom -> taille }` d'un dossier. Un seul appel, pas un `stat` par ligne. */
  async function tailles(dossier) {
    try {
      const { files } = await fs().readdir({ path: dossier });
      return new Map(
        (files ?? [])
          .filter((entree) => entree.type !== 'directory')
          .map((entree) => [entree.name, Number(entree.size) || 0]),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * Écrit une tranche. La première **crée ou tronque** (`writeFile`), les
   * suivantes ajoutent (`appendFile`). `recursive` n'existe que sur `writeFile`,
   * d'où `assureDossiers` en amont pour que l'ajout ne tombe jamais sur un
   * dossier absent.
   */
  async function ecrireTranche(chemin, octets, premiere) {
    const data = versBase64(octets);
    try {
      if (premiere) await fs().writeFile({ path: chemin, data, recursive: true });
      else await fs().appendFile({ path: chemin, data });
    } catch (erreur) {
      throw new DownloadError(estDisquePlein(erreur) ? 'diskFull' : 'network', erreur);
    }
  }

  /** Écrit un tampon complet, par tranches. */
  async function ecrireParTranches(chemin, octets) {
    for (let ecrit = 0; ecrit < octets.length; ecrit += TRANCHE) {
      await ecrireTranche(chemin, octets.subarray(ecrit, ecrit + TRANCHE), ecrit === 0);
    }
    // Un tampon vide n'entre pas dans la boucle : le fichier doit exister quand
    // même, sinon le `rename` qui suit échouerait sur un chemin absent.
    if (!octets.length) await ecrireTranche(chemin, octets, true);
  }

  /**
   * Lit un fichier entier, par tranches.
   *
   * `readFile` accepte `offset` et `length` depuis la version 8.1 du greffon :
   * on relit donc par morceaux et on recopie dans un tampon alloué une fois.
   * Sans cela, la chaîne base64 du fichier entier — 4/3 de sa taille — se serait
   * ajoutée au tampon binaire, au pire moment.
   *
   * Un greffon plus ancien ignorerait `offset` : la relecture rendrait des
   * octets faux, et c'est le SHA-256 qui l'attraperait. Il n'existe pas de
   * chemin où une lecture douteuse s'installe.
   */
  async function lireOctets(chemin) {
    const total = await taille(chemin);
    if (!total) return new Uint8Array(0);
    const sortie = new Uint8Array(total);
    let lus = 0;
    while (lus < total) {
      const { data } = await fs().readFile({
        path: chemin,
        offset: lus,
        length: Math.min(TRANCHE, total - lus),
      });
      const morceau = await enOctets(data);
      if (!morceau.length) break;
      const place = Math.min(morceau.length, total - lus);
      sortie.set(morceau.subarray(0, place), lus);
      lus += place;
    }
    return lus === total ? sortie : sortie.subarray(0, lus);
  }

  /** Le greffon rend des codes `OS-PLUG-FILE-XXXX` ; l'espace se lit au message. */
  function estDisquePlein(erreur) {
    return /space|ENOSPC|quota/i.test(String(erreur?.message ?? erreur));
  }

  // ------------------------------------------------ `user.sqlite` : l'état

  let schemaPromise = null;

  function assureSchema() {
    schemaPromise ??= executerBrut(SCHEMA_UTILISATEUR);
    return schemaPromise;
  }

  /**
   * Écrit l'état d'un livre. Même instruction que `#persistDownload` de
   * `book-repository.js` : `total_bytes` ne redescend pas à zéro sur un jalon de
   * progression, et `downloaded_at` ne se pose qu'à l'installation.
   */
  async function persister(editionId, patch) {
    await assureSchema();
    await executerUtilisateur(
      `INSERT INTO downloaded_books
         (edition_id, release_id, local_path, download_status,
          downloaded_bytes, total_bytes, downloaded_at, progress_percent)
       VALUES (?,?,?,?,?,?,?,0)
       ON CONFLICT(edition_id) DO UPDATE SET
         release_id       = COALESCE(excluded.release_id, downloaded_books.release_id),
         local_path       = COALESCE(excluded.local_path, downloaded_books.local_path),
         download_status  = excluded.download_status,
         downloaded_bytes = excluded.downloaded_bytes,
         total_bytes      = CASE WHEN excluded.total_bytes > 0
                                 THEN excluded.total_bytes
                                 ELSE downloaded_books.total_bytes END,
         downloaded_at    = COALESCE(excluded.downloaded_at, downloaded_books.downloaded_at)`,
      [
        editionId,
        patch.releaseId ?? null,
        patch.localPath ?? null,
        patch.status,
        patch.receivedBytes ?? 0,
        patch.totalBytes ?? 0,
        patch.status === 'installed' ? new Date().toISOString() : null,
      ],
    );
  }

  /** Identifiants installés selon `user.sqlite`, pour le filtre de statut. */
  async function identifiantsInstalles() {
    await assureSchema();
    return (
      await allUser("SELECT edition_id FROM downloaded_books WHERE download_status = 'installed'")
    ).map((ligne) => ligne.edition_id);
  }

  // ------------------------------------------------------------- réglages

  /**
   * Les réglages de distribution vivent dans `app_settings`, pas dans la carte
   * en mémoire du shim : `distribution.base_url` décide d'où viennent le
   * catalogue **et** tous les livres, et un refus de version doit survivre à la
   * fermeture, sans quoi la même bannière reviendrait à chaque lancement.
   */
  async function reglage(cle) {
    await assureSchema();
    const lignes = await allUser('SELECT value FROM app_settings WHERE key = ? LIMIT 1', [cle]);
    return lignes[0]?.value ?? null;
  }

  async function poserReglage(cle, valeur) {
    await assureSchema();
    await executerUtilisateur(
      'INSERT INTO app_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [cle, String(valeur ?? '')],
    );
  }

  /** Mémorisée pour ne pas relire `user.sqlite` à chaque tranche téléchargée. */
  let baseUrlCache;

  async function baseUrl() {
    if (baseUrlCache === undefined) baseUrlCache = await reglage('distribution.base_url');
    return baseUrlCache || null;
  }

  async function resoudre(cle) {
    const { resolveObject } = await distribution();
    return resolveObject(await baseUrl(), cle);
  }

  // ------------------------------------------------------------ la release

  async function releaseActive(editionId) {
    const db = await catalogue();
    const ligne = await first(
      db,
      `SELECT release_id, object_key, sha256, compressed_size, uncompressed_size
         FROM book_releases WHERE edition_id = ? AND is_active = 1 LIMIT 1`,
      [editionId],
    );
    if (!ligne) return null;
    return {
      releaseId: ligne.release_id,
      objectKey: ligne.object_key,
      sha256: ligne.sha256,
      compressedSize: ligne.compressed_size ?? 0,
      uncompressedSize: ligne.uncompressed_size ?? 0,
    };
  }

  // -------------------------------------------------------- le téléchargement

  /**
   * Une annulation remonte tantôt en `AbortError`, tantôt en erreur de flux
   * quelconque selon l'endroit où le signal a frappé : le signal fait foi.
   */
  const estAbandon = (erreur, signal) =>
    signal?.aborted === true || erreur?.name === 'AbortError';

  /** Supprime le `.part` devenu inutile puis fabrique l'erreur correspondante. */
  async function abandonner(part, code, cause) {
    await supprimer(part);
    return new DownloadError(code, cause);
  }

  /**
   * Télécharge les octets compressés dans [part], en reprenant s'il existe déjà.
   *
   * `fetch` traverse le pont natif comme n'importe quelle requête de la WebView.
   * La requête est **inter-origine** — la page est servie depuis
   * `https://localhost` — mais le bucket expose `Range` en en-tête admis et
   * `Content-Range` / `Accept-Ranges` en en-têtes lisibles (`CORS_RULES` de
   * `tools/publish_minio.py`) : la reprise fonctionne depuis un navigateur.
   */
  async function telechargerVersPart({ url, part, compressedSize, signal, surAvancement }) {
    let debut = await taille(part);

    let reponse;
    try {
      reponse = await fetch(url, {
        signal,
        headers: debut > 0 ? { Range: `bytes=${debut}-` } : {},
      });
    } catch (erreur) {
      if (estAbandon(erreur, signal)) throw await abandonner(part, 'aborted', erreur);
      throw new DownloadError('network', erreur);
    }

    if (reponse.status === 404) throw await abandonner(part, 'notFound');
    if (!reponse.ok && reponse.status !== 206) {
      throw new DownloadError('network', new Error(`HTTP ${reponse.status}`));
    }

    // Le serveur ignore `Range` : il renvoie tout, le `.part` accumulé est
    // obsolète et doit disparaître avant qu'on n'y ajoute quoi que ce soit.
    const reprise = reponse.status === 206;
    if (!reprise) {
      debut = 0;
      await supprimer(part);
    }

    const restant = Number(reponse.headers.get('content-length')) || 0;
    const total = debut + restant || compressedSize || 0;
    let recus = debut;

    const lecteur = reponse.body.getReader();
    const tampon = new Uint8Array(TRANCHE);
    let rempli = 0;
    let premiere = !reprise;

    const vider = async () => {
      if (!rempli) return;
      await ecrireTranche(part, tampon.subarray(0, rempli), premiere);
      premiere = false;
      rempli = 0;
    };

    try {
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        recus += value.length;
        surAvancement?.(recus, total);
        // Les blocs du réseau n'ont aucune raison de faire une tranche : on les
        // recoud dans un tampon de taille fixe, qui seul décide des écritures.
        let pris = 0;
        while (pris < value.length) {
          const place = Math.min(TRANCHE - rempli, value.length - pris);
          tampon.set(value.subarray(pris, pris + place), rempli);
          rempli += place;
          pris += place;
          if (rempli === TRANCHE) await vider();
        }
      }
      await vider();
    } catch (erreur) {
      if (erreur instanceof DownloadError) throw erreur;
      if (estAbandon(erreur, signal)) throw await abandonner(part, 'aborted', erreur);
      // Coupure réseau : le `.part` est conservé, la reprise repartira de sa
      // taille. C'est tout l'intérêt de l'écrire au fil de l'eau.
      throw new DownloadError('network', erreur);
    }
  }

  /**
   * Décompresse le `.part`, vérifie l'empreinte, installe.
   *
   * L'ordre est ici plus strict que dans Node, et c'est la contrainte qui l'a
   * imposé : `decompressZstd` réclame le tampon compressé **entier** et
   * `crypto.subtle.digest` le tampon clair **entier**. Puisqu'il faut de toute
   * façon tenir le livre décompressé en mémoire d'un seul tenant, autant le
   * hacher **avant** d'écrire quoi que ce soit — un livre corrompu ne touche
   * alors même pas le `.tmp`, et l'on s'épargne la relecture du fichier écrit.
   *
   * Le prix est dit franchement : le pic mémoire est la somme du compressé et
   * du décompressé, soit une cinquantaine de mégaoctets pour les plus gros
   * livres du corpus. Le `.part` est relu du disque plutôt que gardé en mémoire
   * pendant le téléchargement, parce que le garder n'abaisserait le pic d'aucun
   * octet et rendrait la reprise entre deux sessions impossible.
   */
  async function deballerEtVerifier({ release, part, temp, cible }) {
    const finLecture = chrono();
    let compresse = await lireOctets(part);
    finLecture('telechargement:relecture', `${compresse.length} octet(s)`);

    let clair;
    try {
      const finZstd = chrono();
      // Attendu : le shim charge `fzstd` à la demande, `decompressZstd` rend
      // donc une promesse. `await` sur une valeur nue serait de toute façon
      // sans effet — l'écrire ne coûte rien et couvre les deux formes.
      clair = await decompressZstd(compresse);
      finZstd('telechargement:decompression', `${clair.length} octet(s)`);
    } catch (erreur) {
      // Un `.part` indécompressable est irrécupérable : le garder ferait
      // reprendre indéfiniment un cache mort.
      await supprimer(part);
      throw new DownloadError('checksum', erreur);
    } finally {
      compresse = null; // le tampon compressé n'a plus lieu d'occuper la place
    }

    const finHachage = chrono();
    const empreinte = await sha256Hexa(clair);
    finHachage('telechargement:hachage', empreinte.slice(0, 12));

    if (empreinte !== String(release.sha256 ?? '').toLowerCase()) {
      await supprimer(part); // cache corrompu : reprendre ne sert à rien
      throw new DownloadError('checksum');
    }

    const finEcriture = chrono();
    try {
      await ecrireParTranches(temp, clair);
    } catch (erreur) {
      await supprimer(temp);
      throw erreur instanceof DownloadError ? erreur : new DownloadError('diskFull', erreur);
    }
    finEcriture('telechargement:ecriture', `${clair.length} octet(s)`);

    // Le dernier geste, et lui seul rend le livre visible. Une coupure avant
    // laisse l'ancien fichier — ou l'absence de fichier — exactement en l'état.
    try {
      await fs().rename({ from: temp, to: cible });
    } catch (erreur) {
      await supprimer(temp);
      throw new DownloadError('diskFull', erreur);
    }
    await supprimer(part);
    return cible;
  }

  /** Télécharge la release, la décompresse, vérifie son SHA-256 et l'installe. */
  async function installerRelease({ release, editionId, signal, surAvancement }) {
    const racine = await racineAppareil();
    await assureDossiers(racine);

    const cible = await resoudre(release.objectKey);
    if (cible.kind !== 'http') {
      // `asset://` et `local://` désignent une bibliothèque source posée à côté
      // de l'application : sur l'appareil il n'y en a pas, et aucun livre ne
      // peut venir d'ailleurs que du bucket.
      throw new DownloadError('notFound');
    }

    const part = cheminPart(racine, editionId);
    const temp = cheminTemp(racine, editionId);

    const finReception = chrono();
    await telechargerVersPart({
      url: cible.url,
      part,
      compressedSize: release.compressedSize,
      signal,
      surAvancement,
    });
    finReception('telechargement:reception', editionId);

    return deballerEtVerifier({
      release,
      part,
      temp,
      cible: cheminInstalle(racine, editionId),
    });
  }

  // ------------------------------------------------------------- la file

  /**
   * File **séquentielle** : un seul téléchargement actif, les autres en
   * attente. Portée depuis `DownloadQueue` sans son `EventEmitter` — le canal
   * poussé du shim est `emettreChangement`, que `onDownloadsChanged` rediffuse.
   */
  const travaux = new Map();
  const controleurs = new Map();
  let tourne = false;

  const OCCUPE = new Set(['queued', 'downloading', 'verifying']);

  const instantane = () => [...travaux.values()].map((travail) => ({ ...travail }));

  const emettre = () => emettreChangement(instantane());

  const occupe = (editionId) => OCCUPE.has(travaux.get(editionId)?.status);

  function mettreEnFile(editionId) {
    // La file fabrique trois chemins depuis cet identifiant (`.part`, `.tmp`,
    // fichier installé) : il est validé à l'entrée, pas à chaque usage.
    assertEditionId(editionId);
    const existant = travaux.get(editionId);
    if (existant && existant.status !== 'failed') return { ...existant };

    travaux.set(editionId, {
      editionId,
      status: 'queued',
      receivedBytes: 0,
      totalBytes: 0,
      percent: 0,
      error: null,
    });
    persister(editionId, { status: 'queued', receivedBytes: 0 }).catch((erreur) =>
      console.warn('[beytelhikma] mise en file non écrite :', erreur),
    );
    emettre();
    // La pompe n'est pas attendue : `downloadBook` rend la main dès la mise en
    // file, comme le modèle. Elle n'a aucune raison de rejeter — `executer`
    // enferme tout —, mais un rejet non traité serait ici invisible.
    pomper().catch((erreur) => console.warn('[beytelhikma] file interrompue :', erreur));
    return { ...travaux.get(editionId) };
  }

  function suivant() {
    for (const travail of travaux.values()) if (travail.status === 'queued') return travail;
    return null;
  }

  async function pomper() {
    if (tourne) return;
    tourne = true;
    try {
      let travail;
      while ((travail = suivant())) await executer(travail);
    } finally {
      tourne = false;
    }
  }

  async function executer(travail) {
    const { editionId } = travail;
    const controleur = new AbortController();
    controleurs.set(editionId, controleur);
    travail.status = 'downloading';
    emettre();

    // Écriture au plus une fois par 500 ms : chaque `run` traverse le pont
    // natif, une mise à jour par bloc reçu mettrait l'application à genoux.
    let derniereEcriture = 0;

    try {
      const release = await releaseActive(editionId);
      if (!release) throw new DownloadError('notFound');
      await persister(editionId, {
        status: 'downloading',
        releaseId: release.releaseId,
        totalBytes: release.uncompressedSize ?? 0,
      });

      await installerRelease({
        release,
        editionId,
        signal: controleur.signal,
        surAvancement: (recus, total) => {
          const courant = travaux.get(editionId);
          if (!courant) return;
          courant.receivedBytes = recus;
          courant.totalBytes = total;
          courant.percent = total > 0 ? recus / total : 0;
          const maintenant = Date.now();
          if (maintenant - derniereEcriture < PERIODE_ECRITURE_MS) return;
          derniereEcriture = maintenant;
          // Sans `catch`, une écriture qui échoue devient un rejet non traité :
          // le téléchargement continuerait pendant qu'on signale une promesse
          // morte. Perdre un jalon n'est pas grave — la reprise repart du
          // `.part`.
          Promise.resolve(
            persister(editionId, { status: 'downloading', receivedBytes: recus }),
          ).catch((erreur) => console.warn('[beytelhikma] progression non écrite :', erreur));
          emettre();
        },
      });

      const verification = travaux.get(editionId);
      if (verification) {
        verification.status = 'verifying';
        emettre();
      }

      await persister(editionId, {
        status: 'installed',
        receivedBytes: release.uncompressedSize ?? 0,
        totalBytes: release.uncompressedSize ?? 0,
        localPath: `books/${editionId}.sqlite`,
        releaseId: release.releaseId,
      });
      travaux.delete(editionId);
    } catch (erreur) {
      // `cancelDownload` a déjà retiré le travail et écrit son état : ne rien
      // écraser.
      if (travaux.has(editionId)) {
        const echoue = travaux.get(editionId);
        echoue.status = 'failed';
        echoue.error = erreur?.message ?? String(erreur);
        await persister(editionId, { status: 'failed' }).catch(() => {});
      }
    } finally {
      controleurs.delete(editionId);
      emettre();
    }
  }

  // ------------------------------------------------------- fermer une base

  /**
   * Fermer une connexion avant de toucher son fichier.
   *
   * Sur Android, renommer par-dessus un fichier ouvert **réussit** et la
   * connexion continue de lire l'ancien inode : le catalogue serait remplacé
   * sans que l'application ne le voie, jusqu'au prochain démarrage. C'est le
   * pire des deux mondes — ni erreur, ni effet.
   *
   * `closeNCConnection` ferme le fichier et retire la connexion du dictionnaire
   * natif. Il reste que le shim mémorise ses ouvertures (`cataloguePromise`,
   * l'ensemble `ouvertes`) et croirait la base encore ouverte : seul lui peut
   * oublier ce cache, d'où les deux crochets facultatifs. Sans eux, la mise à
   * jour est écrite correctement mais ne se lit qu'au redémarrage.
   */
  async function fermerBase(chemin, crochet) {
    if (typeof crochet === 'function') {
      await crochet();
      return;
    }
    try {
      await sqlite().closeNCConnection({ databasePath: chemin });
    } catch {
      // Jamais ouverte, ou déjà fermée : les deux conviennent.
    }
  }

  // ------------------------------------------------------- mise à jour du catalogue

  /**
   * Lit le pointeur. Renvoie `null` pour **toute** anomalie — réseau, HTTP,
   * JSON. Aucune levée : l'appelant n'a rien à rattraper, et un `throw`
   * l'obligerait à un `try` dont la seule branche utile serait « ne rien faire ».
   */
  async function lirePointeur() {
    let url;
    try {
      ({ url } = await resoudre(CLE_POINTEUR));
    } catch {
      return null; // `distribution.js` injoignable : silence, comme le reste
    }

    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), DELAI_POINTEUR_MS);
    try {
      const reponse = await fetch(url, {
        signal: controleur.signal,
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!reponse.ok) return null;
      return JSON.parse(await reponse.text());
    } catch {
      return null; // hors ligne, DNS mort, JSON cassé : silence
    } finally {
      clearTimeout(minuteur);
    }
  }

  /**
   * Télécharge, vérifie et installe le catalogue désigné par [pointeur].
   *
   * Même ordre que pour un livre : on écrit de côté, on vérifie l'empreinte, et
   * le `rename` n'a lieu qu'après. Le catalogue tient en mémoire — huit
   * mégaoctets compressés, vingt-neuf en clair — donc pas de `.part` ici : il
   * n'y a rien à reprendre qui vaille un fichier intermédiaire de plus.
   */
  async function installerCatalogue(pointeur) {
    const cible = await resoudre(pointeur.object_key);
    if (cible.kind !== 'http') {
      throw new RepositoryError(
        `clé de catalogue non téléchargeable : ${pointeur.object_key}`,
        'query-failed',
      );
    }
    // Avant la requête : rien ne sert de tirer quarante mégaoctets qu'on
    // refusera. Le refus est prononcé deux fois, ici et dans `decideUpdate`.
    if (!EMPREINTE_VALIDE.test(String(pointeur.sha256 ?? ''))) {
      throw new RepositoryError('pointeur sans empreinte : catalogue refusé', 'query-failed');
    }

    const racine = await racineAppareil();
    await assureDossiers(racine);
    const destination = cheminCatalogue(racine);
    const depose = `${destination}.new`;

    const reponse = await fetch(cible.url, { cache: 'no-store' });
    if (!reponse.ok) {
      throw new RepositoryError(`catalogue introuvable (HTTP ${reponse.status})`, 'query-failed');
    }

    let clair;
    try {
      clair = await decompressZstd(new Uint8Array(await reponse.arrayBuffer()));
    } catch (erreur) {
      throw new RepositoryError('catalogue illisible : décompression refusée', 'query-failed', erreur);
    }

    // L'empreinte porte sur le catalogue **décompressé** : c'est lui que
    // `publish_minio.py` a haché, et c'est lui qu'on va ouvrir.
    const empreinte = await sha256Hexa(clair);
    if (empreinte !== String(pointeur.sha256).toLowerCase()) {
      throw new RepositoryError(
        `empreinte du catalogue invalide : ${empreinte} au lieu de ${pointeur.sha256}`,
        'query-failed',
      );
    }

    try {
      await ecrireParTranches(depose, clair);
      await fermerBase(destination, ctx.fermerCatalogue);
      await fs().rename({ from: depose, to: destination }); // atomique : le dernier geste
    } catch (erreur) {
      await supprimer(depose);
      throw erreur instanceof RepositoryError
        ? erreur
        : new RepositoryError("installation du catalogue", 'query-failed', erreur);
    }
    return destination;
  }

  // ----------------------------------------------------- la table de gestion

  /**
   * `WHERE` de la table de gestion et ses paramètres.
   *
   * Le filtre texte passe par un `LIKE` sur le titre et l'éditeur, **non
   * normalisés** : l'index mémoire de `book-repository.js` n'existe pas ici, et
   * `catalog_fts` reste la question ouverte du spike. C'est un filtre de confort
   * sur une table qu'on a sous les yeux, pas la recherche générale.
   */
  function conditions({ text, status }, installes) {
    const parties = ['1 = 1'];
    const params = [];

    const motif = String(text ?? '').trim();
    if (motif) {
      // `%` et `_` sont des jokers LIKE : sans échappement, un terme les
      // contenant ramènerait le catalogue entier.
      const aiguille = `%${motif.replace(/[\\%_]/g, '\\$&')}%`;
      parties.push(
        "(e.title_ar LIKE ? ESCAPE '\\' OR IFNULL(e.publisher_ar,'') LIKE ? ESCAPE '\\')",
      );
      params.push(aiguille, aiguille);
    }

    if (status === 'installed' || status === 'missing') {
      // Sans aucun livre installé, les deux sens sont des constantes : une
      // clause `IN ()` vide est une erreur de syntaxe en SQLite.
      if (!installes.length) {
        parties.push(status === 'installed' ? '1 = 0' : '1 = 1');
      } else {
        // Autant de paramètres liés que de livres installés. SQLite en accepte
        // plusieurs milliers ; passé cette borne, il faudra une table
        // temporaire — le modèle Electron a exactement la même limite.
        const trous = installes.map(() => '?').join(',');
        parties.push(`e.edition_id ${status === 'installed' ? 'IN' : 'NOT IN'} (${trous})`);
        params.push(...installes);
      }
    }

    return { sql: parties.join(' AND '), params };
  }

  // -------------------------------------------------------------- surface

  /**
   * Trois méthodes sont nommées avant l'objet rendu parce que d'autres méthodes
   * les appellent — `deleteBooks` et `deleteAllBooks` suppriment livre par
   * livre, `installCatalogUpdate` reprend la décision plutôt que de la recevoir.
   * Passer par `this` serait la faute : ces membres sont des fonctions fléchées,
   * `this` y vaut ce qu'il vaut au module, c'est-à-dire rien.
   */

  /**
   * Supprime le fichier du livre. [keepProgress] décide du sort de l'état
   * utilisateur : conservé (le livre repasse en `removed`) ou effacé avec la
   * ligne et les appartenances.
   */
  const deleteBook = (editionId, { keepProgress = true } = {}) =>
    garde('suppression du livre', async () => {
      if (occupe(editionId)) {
        throw new RepositoryError(
          'téléchargement en cours : annuler avant de supprimer',
          'query-failed',
        );
      }

      // Trois suppressions suivent, sur des chemins construits avec cet
      // identifiant : il est validé avant, jamais après.
      assertEditionId(editionId);
      const racine = await racineAppareil();
      const installe = cheminInstalle(racine, editionId);
      await fermerBase(installe, ctx.fermerLivre && (() => ctx.fermerLivre(editionId)));
      await supprimer(installe);
      await supprimer(cheminPart(racine, editionId));
      await supprimer(cheminTemp(racine, editionId));

      await assureSchema();
      if (keepProgress) {
        await executerUtilisateur(
          `UPDATE downloaded_books
              SET download_status = 'removed', downloaded_bytes = 0, local_path = NULL
            WHERE edition_id = ?`,
          [editionId],
        );
        return;
      }
      // Les annotations suivent la progression : effacer l'une sans l'autre
      // laisserait des notes pointant un livre qu'on ne sait plus nommer.
      for (const table of [
        'downloaded_books',
        'collection_books',
        'notes',
        'highlights',
        'bookmarks',
      ]) {
        await executerUtilisateur(`DELETE FROM ${table} WHERE edition_id = ?`, [editionId]).catch(
          () => {
            // Les tables d'annotation n'existent pas encore dans le spike.
          },
        );
      }
    });

  /**
   * Vérifie s'il existe un catalogue plus récent. Ne lève jamais pour cause de
   * réseau : `lirePointeur` rend `null` et `decideUpdate` en tire une décision
   * silencieuse.
   *
   * `ignoreDeclined` fait le même office qu'en Electron : un refus tait une
   * proposition, pas la question que pose l'écran des réglages. Le rendu est le
   * même des deux côtés — s'il passe l'option ici sans qu'on la lise, l'écran
   * annoncerait « à jour » sur une version explicitement refusée.
   */
  const checkCatalogUpdate = ({ ignoreDeclined = false } = {}) =>
    garde('vérification du catalogue', async () => {
      const pointeur = await lirePointeur();
      const db = await catalogue();
      const info = await first(db, 'SELECT catalog_version FROM catalog_info LIMIT 1');
      const refusee = Number(await reglage('distribution.declined_catalog_version')) || null;

      return decideUpdate({
        pointer: pointeur,
        localVersion: info?.catalog_version ?? 0,
        declinedVersion: ignoreDeclined ? null : refusee,
      });
    });

  /** Supprime un lot : la table de gestion agit sur une sélection. */
  const deleteBooks = (editionIds = [], { keepProgress = true } = {}) =>
    garde('suppression des livres', async () => {
      let efface = 0;
      for (const editionId of editionIds) {
        if (occupe(editionId)) continue;
        await deleteBook(editionId, { keepProgress });
        efface += 1;
      }
      return efface;
    });

  return {
    downloadBook: (editionId) =>
      garde('mise en file du téléchargement', async () => mettreEnFile(editionId)),

    cancelDownload: (editionId) =>
      garde("annulation du téléchargement", async () => {
        const travail = travaux.get(editionId);
        if (!travail) return;
        controleurs.get(editionId)?.abort();
        travaux.delete(editionId);
        assertEditionId(editionId);
        const racine = await racineAppareil();
        await supprimer(cheminPart(racine, editionId));
        await persister(editionId, { status: 'removed', receivedBytes: 0 });
        emettre();
      }),

    retryDownload: (editionId) =>
      garde('réessai du téléchargement', async () => {
        travaux.delete(editionId);
        return mettreEnFile(editionId);
      }),

    deleteBook,

    /**
     * File en cours, chaque travail portant le titre du livre : l'écran de
     * suivi ne doit pas montrer d'`edition_id` brut.
     */
    getDownloads: () =>
      garde('lecture des téléchargements', async () => {
        const jobs = instantane();
        if (!jobs.length) return jobs;
        const db = await catalogue();
        const identifiants = jobs.map((travail) => travail.editionId);
        const titres = new Map(
          (
            await all(
              db,
              `SELECT edition_id, title_ar FROM editions
                WHERE edition_id IN (${identifiants.map(() => '?').join(',')})`,
              identifiants,
            )
          ).map((ligne) => [ligne.edition_id, ligne.title_ar]),
        );
        return jobs.map((travail) => ({
          ...travail,
          title: titres.get(travail.editionId) ?? travail.editionId,
        }));
      }),

    clearFailedDownloads: () =>
      garde('nettoyage des téléchargements échoués', async () => {
        for (const [editionId, travail] of travaux) {
          if (travail.status === 'failed') travaux.delete(editionId);
        }
        emettre();
      }),

    /**
     * Le compte et la taille de ce qui est réellement sur l'appareil. Un seul
     * `readdir` : un `stat` par livre ferait huit mille allers-retours pour un
     * chiffre affiché en haut d'écran.
     */
    getStorageUsage: () =>
      garde("lecture de l'espace occupé", async () => {
        const racine = await racineAppareil();
        const parNom = await tailles(`${racine}/books`);
        let bytes = 0;
        let bookCount = 0;
        for (const [nom, octets] of parNom) {
          if (!nom.endsWith('.sqlite')) continue;
          if (!estEditionId(nom.slice(0, -'.sqlite'.length))) continue;
          bookCount += 1;
          bytes += octets;
        }
        return { bookCount, bytes };
      }),

    downloadSelection: (editionIds = []) =>
      garde('mise en file de la sélection', async () => {
        const installes = new Set(await identifiantsInstalles());
        let queued = 0;
        for (const editionId of editionIds) {
          if (installes.has(editionId)) continue;
          mettreEnFile(editionId);
          queued += 1;
        }
        return queued;
      }),

    /** Efface tous les fichiers de livres, en conservant les progressions. */
    deleteAllBooks: () =>
      garde('suppression de tous les livres', async () => {
        const racine = await racineAppareil();
        const noms = [...(await tailles(`${racine}/books`)).keys()]
          .filter((nom) => nom.endsWith('.sqlite'))
          .map((nom) => nom.slice(0, -'.sqlite'.length))
          .filter(estEditionId);
        let efface = 0;
        for (const editionId of noms) {
          if (occupe(editionId)) continue;
          await deleteBook(editionId, { keepProgress: true });
          efface += 1;
        }
        return efface;
      }),

    deleteBooks,

    /**
     * Table de gestion : une page du catalogue enrichie de ce que la file et le
     * disque savent.
     *
     * `total` vient de SQL, jamais de `rows.length` : le corpus fait 8 589
     * livres et la pagination n'a de sens que si le compte est vrai.
     */
    getManagedBooks: (query = {}) =>
      garde('lecture des livres gérés', async () => {
        const db = await catalogue();
        const limite = Math.min(Math.max(Number(query.limit) || 25, 1), LIMITE_MAX);
        const depart = Math.max(Number(query.offset) || 0, 0);
        const ordre = TRIS[query.sort] ?? TRIS.title;

        const installes = await identifiantsInstalles();
        const ou = conditions(query, installes);

        const lignes = await all(
          db,
          `SELECT ${COLONNES_RESUME}${DEPUIS}${ou.sql} ORDER BY ${ordre} LIMIT ? OFFSET ?`,
          [...ou.params, limite, depart],
        );
        const totaux =
          (await first(
            db,
            `SELECT COUNT(*) AS n, COALESCE(SUM(r.compressed_size), 0) AS bytes${DEPUIS}${ou.sql}`,
            ou.params,
          )) ?? {};

        const racine = await racineAppareil();
        const surDisque = await tailles(`${racine}/books`);
        const parIdentifiant = new Map(
          lignes.length
            ? (
                await allUser(
                  `SELECT edition_id, download_status, downloaded_at, last_opened_at,
                          progress_percent
                     FROM downloaded_books
                    WHERE edition_id IN (${lignes.map(() => '?').join(',')})`,
                  lignes.map((ligne) => ligne.edition_id),
                )
              ).map((ligne) => [ligne.edition_id, ligne])
            : [],
        );

        return {
          total: totaux.n ?? 0,
          bytes: totaux.bytes ?? 0,
          rows: lignes.map((ligne) => {
            const etat = parIdentifiant.get(ligne.edition_id) ?? {};
            const travail = travaux.get(ligne.edition_id) ?? null;
            return {
              editionId: ligne.edition_id,
              workId: ligne.work_id,
              title: ligne.title_ar,
              subtitle: ligne.subtitle_ar ?? null,
              categoryId: ligne.category_id ?? null,
              categoryLabel: ligne.category_label ?? null,
              bookType: ligne.book_type_label ?? null,
              authorName: ligne.author_name ?? null,
              authorDeathYear: ligne.author_death_year ?? null,
              volumeCount: ligne.volume_count ?? 1,
              language: ligne.language ?? 'ar',
              coverUrl: ligne.cover_url ?? null,
              publishedAt: ligne.published_at ?? null,
              // La file l'emporte sur la base : elle décrit l'instant présent.
              downloadStatus: travail?.status ?? etat.download_status ?? null,
              percent: travail?.percent ?? 0,
              error: travail?.error ?? null,
              compressedSize: ligne.compressed_size ?? 0,
              uncompressedSize: ligne.uncompressed_size ?? 0,
              localBytes: surDisque.get(`${ligne.edition_id}.sqlite`) ?? 0,
              pageCount: ligne.page_count ?? null,
              downloadedAt: etat.downloaded_at ?? null,
              lastOpenedAt: etat.last_opened_at ?? null,
              progressPercent: etat.progress_percent ?? 0,
            };
          }),
        };
      }),

    /**
     * Applique `distribution.base_url`, sans redémarrage.
     *
     * Le catalogue ne porte que des clés relatives : changer cette valeur suffit
     * à servir la même bibliothèque depuis un autre bucket, sans rien
     * retélécharger de ce qui est déjà installé. La validation n'est pas
     * cosmétique — ce réglage décide d'où viennent le catalogue **et** tous les
     * livres.
     */
    setDownloadBaseUrl: (url) =>
      garde("réglage de l'adresse du serveur", async () => {
        const { assertBaseUrl } = await distribution();
        const valeur = assertBaseUrl(url);
        await poserReglage('distribution.base_url', valeur);
        baseUrlCache = valeur || null;
      }),

    checkCatalogUpdate,

    /**
     * Installe le catalogue proposé.
     *
     * La décision est reprise ici plutôt que reçue du rendu : un pointeur qui a
     * bougé entre l'affichage de la bannière et le clic ne doit pas faire
     * installer ce qu'on n'a pas proposé.
     */
    installCatalogUpdate: () =>
      garde('mise à jour du catalogue', async () => {
        // Le clic *est* l'acceptation : un refus antérieur ne peut pas faire
        // échouer l'installation qu'on vient de demander.
        const verdict = await checkCatalogUpdate({ ignoreDeclined: true });
        if (verdict.action !== 'offer') return { catalogVersion: null };
        const fin = chrono();
        await installerCatalogue(verdict.pointer);
        fin('catalogue:mise-a-jour', `version ${verdict.pointer.catalog_version}`);
        return { catalogVersion: verdict.pointer.catalog_version };
      }),

    /** Note un refus. Refuser la version N ne fait pas taire la N+1. */
    declineCatalogUpdate: (version) =>
      garde('report de la mise à jour du catalogue', async () => {
        await poserReglage('distribution.declined_catalog_version', String(version ?? ''));
      }),
  };
}
