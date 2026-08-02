/**
 * Les polices ajoutées depuis Google Fonts, portées sous Capacitor.
 *
 * **Ce qui ne change pas.** Les six familles embarquées — Amiri, Noto Naskh
 * Arabic, IBM Plex Sans Arabic, Literata, EB Garamond, Source Serif 4 — vivent
 * dans `src/shared/fonts.js`, sont livrées avec le rendu et servies depuis
 * `'self'`. Rien ici ne les touche : ce module ne s'occupe que de ce que
 * l'utilisateur ajoute.
 *
 * **Ce qui change.** Sous Electron, les fichiers déposés sont servis par le
 * schéma `userfont:`, un protocole que le processus principal enregistre. Il
 * n'existe pas sous Capacitor. On passe donc par `Capacitor.convertFileSrc()`,
 * qui réécrit un chemin d'appareil en URL du serveur local
 * (`WEBVIEW_SERVER_URL + '/_capacitor_file_' + chemin`, cf. `native-bridge.js`
 * du greffon Android). Ce serveur-là **est** l'origine du document —
 * `https://localhost` par défaut, `Bridge.localUrl` — donc les fichiers déposés
 * sortent en *même origine* : `font-src 'self'` les couvre déjà, et il n'y a
 * aucun hôte à ajouter pour les servir.
 *
 * **Ce que le CSP doit gagner, et rien de plus** (le `<meta>` de `index.html`
 * est régénéré par `scripts/prepare-www.mjs`, il ne se modifie pas à la main) :
 *
 *     connect-src https://fonts.googleapis.com https://fonts.gstatic.com;
 *
 * Deux hôtes, deux rôles : la feuille pour l'un, les `woff2` pour l'autre. Sans
 * cette directive, `default-src 'none'` couvre `connect-src` et le `fetch`
 * n'atteint jamais Google. `font-src` reste `'self'` (voir ci-dessus),
 * `style-src` reste `'self'` — `user-fonts.js` pose ses règles dans une
 * `CSSStyleSheet` **construite**, qui ne relève pas de `style-src` — et
 * `script-src` ne bouge pas : une police ajoutée ne peut rien exécuter.
 *
 * **Les bornes sont celles de `src/main/font-installer.js`**, reprises une à
 * une. Elles existent parce qu'on télécharge un fichier chez un tiers pour le
 * poser sur le disque et le servir à la page : hôtes en liste close, `https`
 * seul, aucune redirection suivie, tailles plafonnées, `woff2` seul écrit, nom
 * de fichier construit, nom de famille réduit avant d'être cité. Aucune ne
 * saute au motif que c'est un spike.
 *
 * Le code de `font-installer.js` est **transcrit**, pas importé : ce module est
 * en `node:fs` / `node:https`, il ne peut pas être servi au navigateur, et les
 * fabriques de `src/repo/` n'ont aucun import (le rendu n'a pas de bundler).
 * C'est la seule duplication du fichier, et elle est de celles que le projet
 * paie cher — `parseSheet`, `slugify` et `quoteFamily` doivent rester le reflet
 * exact de leurs originales.
 */

// ------------------------------------------------------------------ bornes

/** Les deux seuls hôtes joignables, quelle que soit l'URL collée. */
const HOTE_FEUILLE = 'fonts.googleapis.com';
const HOTE_FICHIER = 'fonts.gstatic.com';

/** Plafonds : une URL fournie par l'utilisateur ne doit pas pouvoir remplir le disque. */
const PLAFONDS = {
  feuille: 256 * 1024,
  fichier: 2 * 1024 * 1024,
  famille: 8 * 1024 * 1024,
};

/** Au-delà, on abandonne : un tiers injoignable ne doit pas figer l'écran. */
const DELAI = 20_000;

/**
 * Un refus de bornes n'est pas une requête ratée : il est **prononcé**, et son
 * message dit laquelle des bornes a parlé. D'où un code à part — `garde()`
 * range tout le reste sous `query-failed`, ce qui effacerait la distinction
 * entre « la base a hoqueté » et « on a refusé de télécharger ça ».
 */
const CODE_REFUS = 'font-refused';

/** Sous-ensembles retenus, et l'écriture que chacun désigne. */
const SOUS_ENSEMBLES = { arabic: 'U+0600-06FF', latin: 'U+0000-00FF' };
const ECRITURE = { arabic: 'arab', latin: 'latn' };

/** Sous la racine de l'appareil, à côté de `catalog.sqlite` et de `books/`. */
const DOSSIER = 'fonts';

/** Les clés que `slugify` produit, et les seules qu'on accepte de relire. */
const CLE = /^user-[a-z0-9-]+$/;

/** Erreur interne aux fonctions pures : traduite en `RepositoryError` à la frontière. */
class PoliceRefusee extends Error {
  constructor(message) {
    super(message);
    this.name = 'PoliceRefusee';
  }
}

const refus = (message) => new PoliceRefusee(message);

// -------------------------------------------------- fonctions pures, transcrites

/**
 * Vérifie l'origine **avant** toute requête. Une liste d'hôtes qu'une
 * redirection contourne ne protège rien : c'est `redirect: 'error'` qui tient
 * l'autre bout, plus bas.
 */
function assertHote(brut, hote) {
  let url;
  try {
    url = new URL(String(brut));
  } catch {
    throw refus(`URL illisible : ${brut}`);
  }
  if (url.protocol !== 'https:') throw refus(`https seul : ${brut}`);
  if (url.hostname !== hote) throw refus(`hôte refusé : ${url.hostname}`);
  return url;
}

/** `Noto Kufi Arabic` -> `user-noto-kufi-arabic`. ASCII seul, par construction. */
function slugify(famille) {
  const slug = String(famille)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `user-${slug || 'font'}`;
}

/**
 * Lit les blocs `@font-face` d'une feuille Google. Ne retient que les
 * sous-ensembles utiles et les fichiers `woff2` : c'est le seul format écrit
 * sur disque.
 *
 * Le modèle Electron force un `User-Agent` de Chrome récent, sans quoi Google
 * renvoie du TTF. Ici la requête part de la WebView, dont l'agent *est* celui
 * de Chrome — et `fetch` refuse de toute façon qu'on écrive cet en-tête. Si le
 * serveur servait malgré tout du TTF, aucune face ne serait retenue et l'ajout
 * échouerait en toutes lettres : jamais une police à moitié posée.
 */
function lireFeuille(css) {
  const faces = [];
  let famille = null;

  for (const [, bloc] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const nom = bloc.match(/font-family:\s*'([^']+)'/)?.[1];
    const graisse = bloc.match(/font-weight:\s*(\d+)/)?.[1] ?? '400';
    const source = bloc.match(/src:\s*url\(([^)]+)\)([^;]*)/);
    const plage = bloc.match(/unicode-range:\s*([^;]+);/)?.[1]?.trim();
    if (!nom || !source || !plage) continue;

    const url = source[1].replace(/['"]/g, '').trim();
    if (!url.endsWith('.woff2')) continue;

    const sousEnsemble = Object.keys(SOUS_ENSEMBLES).find((clef) =>
      plage.includes(SOUS_ENSEMBLES[clef]),
    );
    if (!sousEnsemble) continue;

    famille ??= nom;
    if (nom !== famille) continue;
    faces.push({ weight: Number(graisse), subset: sousEnsemble, url, range: plage });
  }

  if (!famille || !faces.length) throw refus('aucune police lisible dans la feuille');

  const scripts = [...new Set(faces.map((face) => ECRITURE[face.subset]))];
  return { family: famille, faces, scripts };
}

/**
 * Le nom de famille vient d'un tiers : il est **réduit** avant d'être cité.
 *
 * Citer suffirait à l'empêcher de refermer la règle, mais laisserait entrer du
 * texte arbitraire — accolades, points-virgules, sauts de ligne — dans une
 * feuille de style. Un nom de police n'a besoin que de lettres, de chiffres,
 * d'espaces et de traits d'union ; tout le reste tombe.
 */
function citerFamille(famille) {
  const propre = String(famille)
    .replace(/[^\p{L}\p{N} \-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return `"${propre || 'Font'}"`;
}

/**
 * Réécrit les règles `@font-face` de l'application. La feuille de Google n'est
 * jamais servie : seules ses valeurs traversent, et elles ressortent citées.
 *
 * `face.file` a été **construit** à l'installation, mais il est ici relu depuis
 * `user.sqlite` : on le repasse au tamis, la base ayant pu être touchée entre
 * les deux.
 */
function cssPour(police, base) {
  return police.faces
    .map((face) =>
      [
        '@font-face {',
        `  font-family: ${citerFamille(police.family)};`,
        '  font-style: normal;',
        `  font-weight: ${Number(face.weight) || 400};`,
        '  font-display: swap;',
        `  src: url('${base}/${police.key}/${nomDeFichier(face.file)}') format('woff2');`,
        `  unicode-range: ${String(face.range).replace(/[^U+0-9A-Fa-f,\-\s]/g, '')};`,
        '}',
      ].join('\n'),
    )
    .join('\n\n');
}

const nomDeFichier = (nom) => String(nom).replace(/[^A-Za-z0-9._-]/g, '');

/**
 * Octets -> base64, par tranches. `Filesystem.writeFile` sans `encoding` écrit
 * du binaire et attend du base64 ; `String.fromCharCode(...deuxMillionsOctets)`
 * ferait déborder la pile d'arguments.
 */
function enBase64(octets) {
  const PAS = 0x8000;
  let binaire = '';
  for (let debut = 0; debut < octets.length; debut += PAS) {
    binaire += String.fromCharCode.apply(null, octets.subarray(debut, debut + PAS));
  }
  return btoa(binaire);
}

// ------------------------------------------------------------------ fabrique

export function creerMethodesPolices(ctx) {
  /**
   * Traduit un refus de bornes en erreur de dépôt, message intact. `garde()`
   * laisse passer une `RepositoryError` déjà typée : la conversion doit donc
   * avoir lieu **avant** lui, sinon le détail disparaît sous « query-failed ».
   */
  function sousGarde(quoi, executer) {
    return ctx.garde(quoi, async () => {
      try {
        return await executer();
      } catch (erreur) {
        if (erreur instanceof PoliceRefusee) {
          throw new ctx.RepositoryError(erreur.message, CODE_REFUS);
        }
        throw erreur;
      }
    });
  }

  /**
   * `convertFileSrc` est publié par le pont natif sur l'objet `Capacitor`
   * global, pas sur `Capacitor.Plugins`. Le second candidat n'est pas un repli
   * de confort : c'est le **même** objet, atteint autrement, pour le cas où le
   * `pont()` du shim rendrait la table des greffons.
   */
  function convertisseur() {
    const capacitor = ctx.pont();
    const convertir = capacitor?.convertFileSrc ?? globalThis.Capacitor?.convertFileSrc;
    if (typeof convertir !== 'function') {
      throw new ctx.RepositoryError(
        "Capacitor.convertFileSrc absent : rien ne peut servir les polices déposées",
        'db-missing',
      );
    }
    return (chemin) => convertir(chemin);
  }

  /**
   * Où les fichiers vivent, et sous quelle URL la page les voit.
   *
   * `racineAppareil()` est la seule porte : elle attend le pont, crée l'arbre
   * au nom de l'application et rend un chemin absolu. C'est important —
   * un dossier posé par `adb shell` appartient au shell, et l'application ne
   * peut plus le traverser ; ici l'application est le seul créateur, et
   * `recursive: true` fait le reste à l'écriture.
   */
  let basePromise = null;

  function base() {
    if (basePromise) return basePromise;
    const promesse = (async () => {
      const racine = await ctx.racineAppareil();
      const chemin = `${String(racine).replace(/\/+$/, '')}/${DOSSIER}`;
      const url = convertisseur()(`file://${chemin}`).replace(/\/+$/, '');
      // L'URL part dans un `url('…')` de feuille de style. Le chemin vient du
      // système, pas de nous : on refuse tout ce qui pourrait refermer la règle
      // plutôt que d'échapper au petit bonheur.
      if (!/^https?:\/\/[^\s'"()\\;]+$/.test(url)) {
        throw refus(`URL de service inattendue pour les polices : ${url}`);
      }
      return { chemin, url };
    })();
    // Une résolution ratée ne reste pas en cache : la suivante doit retenter.
    promesse.catch(() => {
      if (basePromise === promesse) basePromise = null;
    });
    basePromise = promesse;
    return promesse;
  }

  // ------------------------------------------------------------- le réseau

  /**
   * Récupère au plus [plafond] octets, et échoue dès le dépassement.
   *
   * `redirect: 'error'` est la transcription exacte du « pas de suivi de
   * redirection » du modèle : une 3xx vers un autre hôte contournerait la liste
   * close, et la refuser au niveau du moteur ne laisse aucune fenêtre où l'on
   * pourrait oublier de revérifier l'hôte. `credentials: 'omit'` et
   * `no-referrer` parce qu'un tiers n'a besoin de rien savoir de nous.
   */
  async function telecharger(url, plafond, quoi) {
    const cible = String(url);
    const controleur = new AbortController();
    const minuteur = setTimeout(() => controleur.abort(), DELAI);
    try {
      let reponse;
      try {
        reponse = await fetch(cible, {
          method: 'GET',
          redirect: 'error',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          cache: 'no-store',
          signal: controleur.signal,
        });
      } catch (erreur) {
        throw refus(
          controleur.signal.aborted
            ? `${quoi} : délai de ${DELAI} ms dépassé — ${cible}`
            : `${quoi} : ${String(erreur?.message ?? erreur)} — ${cible}`,
        );
      }
      if (!reponse.ok) throw refus(`${quoi} : réponse ${reponse.status} — ${cible}`);

      // `Content-Length` est un indice, pas une garantie : il évite d'ouvrir un
      // flux qu'on refusera, mais c'est le comptage qui décide.
      const annonce = Number(reponse.headers.get('content-length'));
      if (Number.isFinite(annonce) && annonce > plafond) {
        throw refus(`${quoi} : ${annonce} octets annoncés, plafond ${plafond}`);
      }
      return await lireBorne(reponse, plafond, quoi);
    } finally {
      clearTimeout(minuteur);
    }
  }

  /** Lit le corps en comptant, et coupe la connexion au premier octet de trop. */
  async function lireBorne(reponse, plafond, quoi) {
    const corps = reponse.body;
    if (typeof corps?.getReader !== 'function') {
      // Moteur sans flux lisible : on ne peut plus couper en vol, seulement
      // refuser après coup. Le plafond tient — rien n'atteint le disque — mais
      // les octets ont déjà transité, d'où le flux en premier choix.
      const octets = new Uint8Array(await reponse.arrayBuffer());
      if (octets.length > plafond) throw refus(`${quoi} : dépassement de ${plafond} octets`);
      return octets;
    }

    const lecteur = corps.getReader();
    const morceaux = [];
    let taille = 0;
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      taille += value.byteLength;
      if (taille > plafond) {
        await lecteur.cancel().catch(() => {});
        throw refus(`${quoi} : dépassement de ${plafond} octets`);
      }
      morceaux.push(value);
    }

    const tout = new Uint8Array(taille);
    let curseur = 0;
    for (const morceau of morceaux) {
      tout.set(morceau, curseur);
      curseur += morceau.byteLength;
    }
    return tout;
  }

  // -------------------------------------------------------------- le disque

  /**
   * Écrit un `woff2`. Chemin absolu et **pas** de `directory` : le greffon
   * accepte alors un `file://` complet, et c'est la seule forme que
   * `racineAppareil()` sache donner — elle ne dit pas sous quel alias de
   * répertoire la racine se trouve.
   */
  async function ecrire(chemin, octets) {
    await ctx.filesystem().writeFile({
      path: `file://${chemin}`,
      data: enBase64(octets),
      recursive: true,
    });
  }

  /** Efface un dossier de famille. Idempotent : un retrait ne doit jamais lever. */
  async function effacer(chemin) {
    try {
      await ctx.filesystem().rmdir({ path: `file://${chemin}`, recursive: true });
    } catch {
      // Absent, ou déjà retiré — le seul cas qu'on attende ici.
    }
  }

  // ------------------------------------------------------------ les méthodes

  /**
   * Installe une police depuis Google Fonts.
   *
   * L'URL vient de l'utilisateur : la page émet donc une requête sortante sur
   * sa demande, une fois, au moment de l'ajout — et plus jamais ensuite. C'est
   * tout l'écart entre installer et lier : un lecteur hors ligne garde ses
   * polices, et aucun lancement n'appelle un tiers.
   *
   * L'inscription en base vient **après** l'écriture des fichiers : une police
   * annoncée sans fichier ferait demander une ressource absente à chaque rendu.
   */
  async function installFont(url) {
    return sousGarde("installation d'une police", async () => {
      const feuilleUrl = assertHote(url, HOTE_FEUILLE);
      const depart = performance.now();

      const brut = await telecharger(feuilleUrl.toString(), PLAFONDS.feuille, 'feuille de style');
      const { family, faces, scripts } = lireFeuille(new TextDecoder('utf-8').decode(brut));

      const key = slugify(family);
      const { chemin, url: baseUrl } = await base();
      const dossier = `${chemin}/${key}`;

      const posees = [];
      try {
        let total = 0;
        for (const face of faces) {
          assertHote(face.url, HOTE_FICHIER);
          const octets = await telecharger(face.url, PLAFONDS.fichier, 'fichier de police');
          total += octets.length;
          if (total > PLAFONDS.famille) {
            throw refus(`famille trop lourde : au-delà de ${PLAFONDS.famille} octets`);
          }
          // Nom **construit** depuis le slug, la graisse et le sous-ensemble —
          // jamais repris de l'URL distante, qui traverserait le chemin.
          const file = `${key}-${face.weight}-${face.subset}.woff2`;
          await ecrire(`${dossier}/${file}`, octets);
          posees.push({ weight: face.weight, subset: face.subset, file, range: face.range });
        }
      } catch (erreur) {
        // Rien n'est laissé derrière : une police à moitié posée ne doit jamais
        // pouvoir se retrouver au catalogue.
        await effacer(dossier);
        throw erreur;
      }

      const police = { key, family, scripts, faces: posees, sourceUrl: feuilleUrl.toString() };

      // Le DDL de `user_fonts` n'est pas répété ici : la table est au schéma 3
      // de `user.sqlite` (`DATAMODEL.md`), et une seconde déclaration serait la
      // copie qui dérive.
      await ctx.executerUtilisateur(
        `INSERT OR REPLACE INTO user_fonts
           (key, family, scripts, source_url, installed_at, faces)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          key,
          family,
          scripts.join(','),
          police.sourceUrl,
          new Date().toISOString(),
          JSON.stringify(posees),
        ],
      );

      globalThis.__probe?.record(
        'polices:installation',
        performance.now() - depart,
        `${family} — ${posees.length} face(s)`,
      );

      return { ...police, css: cssPour(police, baseUrl) };
    });
  }

  /**
   * Les polices ajoutées, avec les règles `@font-face` que le rendu posera.
   *
   * La forme est celle qu'attend `src/renderer/js/user-fonts.js` :
   * `{ key, family, scripts: [...], faces: [...], css }`. Il lit `css` pour
   * `replaceSync`, `scripts` pour filtrer par écriture, `key` et `family` pour
   * présenter le choix.
   *
   * L'URL n'est **pas** stockée : elle est recomposée à chaque lecture. Le
   * chemin de l'appareil change d'une installation à l'autre, et une URL
   * conservée en base pointerait un jour à côté sans qu'aucune règle ne le dise.
   */
  async function listFonts() {
    return sousGarde('lecture des polices ajoutées', async () => {
      const lignes = await ctx.allUser('SELECT * FROM user_fonts ORDER BY installed_at');
      // Aucune police : inutile de réveiller le pont pour composer une base
      // d'URL dont personne ne se servira. C'est le cas courant.
      if (!lignes.length) return [];

      const { url: baseUrl } = await base();
      return lignes.map((ligne) => {
        const police = {
          key: ligne.key,
          family: ligne.family,
          scripts: String(ligne.scripts).split(',').filter(Boolean),
          faces: JSON.parse(ligne.faces),
        };
        return { ...police, css: cssPour(police, baseUrl) };
      });
    });
  }

  /**
   * Retire une police : la ligne d'abord, les fichiers ensuite. Dans l'autre
   * sens, une coupure laisserait une police au catalogue sans ses fichiers.
   *
   * La clé est construite par `slugify` — `user-` puis de l'ASCII sûr — mais
   * elle arrive du rendu : on la vérifie avant qu'elle ne désigne un dossier à
   * effacer.
   */
  async function removeFont(key) {
    return sousGarde("retrait d'une police", async () => {
      const cle = String(key ?? '');
      await ctx.executerUtilisateur('DELETE FROM user_fonts WHERE key = ?', [cle]);
      if (CLE.test(cle)) {
        const { chemin } = await base();
        await effacer(`${chemin}/${cle}`);
      }
      return { removed: cle };
    });
  }

  return { installFont, listFonts, removeFont };
}
