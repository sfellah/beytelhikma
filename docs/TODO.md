# À faire — décisions différées

Ce que l'on sait devoir faire, et qui attend un déclencheur. Chaque entrée dit
**quand** s'y mettre : une dette qu'on ne date pas se relit tous les six mois
sans jamais se payer.

---

## 1. Les livres populaires passent au catalogue à la prochaine refonte du jeu de données

**Aujourd'hui** — `apps/desktop/src/shared/popular.js` porte vingt-trois
`edition_id` en dur. Le filtre les colle dans un `WHERE … IN (?,…)`
(`catalog-query.js`, et son miroir dans `repo/catalogue-plus.js`).

**Pourquoi ce n'est pas déjà dans le catalogue** — l'y mettre aujourd'hui
coûterait un `schema_version` 2 → 3, la régénération du catalogue, un nouveau
`catalog/<version>/catalog.sqlite.zst`, un pointeur, et 8 568 manifestes
touchés — pour corriger un jour un choix d'édition. Hors d'une refonte, le
rapport est mauvais.

**Le déclencheur** — la **prochaine évolution du jeu de données** : tout
changement qui fait déjà monter `schema_version` et republier le corpus. Le
surcoût devient alors nul, et deux défauts disparaissent :

- la liste est aujourd'hui **muette sur ce qu'elle ignore**. Si une édition
  sort du corpus, `getPopularBooks` en rend une de moins sans que rien ne le
  dise ; `resolvePopular` sait compter les manquantes mais personne ne l'appelle
  encore côté écran ;
- corriger un choix d'édition oblige à publier une version d'application, alors
  que le catalogue se met à jour seul depuis le bucket.

**Ce que ça veut dire concrètement**

- une colonne `editions.is_popular` (ou une table `curated_lists`, si les cursus
  suivent le même chemin — les deux listes ont la même nature) ;
- `tools/_common.py` : le DDL, source unique partagée par `gen_sample_data.py`
  et l'importeur Shamela ;
- `catalog-query.js` : la clause devient `e.is_popular = 1`, sans liste à
  transporter — donc plus d'accesseur `ctx.POPULAR_EDITION_IDS` côté mobile ;
- `shared/popular.js` ne garde alors que le **jeu d'exemple**, ou disparaît ;
- `test/popular.test.js` : la règle « aucune vue ne redéclare la liste » reste
  valable, la parité de comptage passe au catalogue.

**Ne pas oublier** — le jeu d'exemple (5 livres) doit alors porter au moins une
édition marquée, sinon la bande de l'accueil n'est plus jamais exercée en
développement et le chemin meurt sans qu'un test le dise. C'est exactement ce
qui est arrivé au thème `sepia`.

---


---

## 2. Migrer la distribution vers Cloudflare R2 si le trafic monte

**Aujourd'hui** — les livres et le catalogue sont sur **AWS S3**
(`beytelhima-library`, `eu-west-1`), publics par politique, avec journaux
d'accès vers un second bucket privé. `tools/publish_minio.py` est le seul
composant qui connaisse la disposition du bucket.

**Le déclencheur** — la **facture de sortie réseau**. Les livres pèsent de 1 à
29 Mo compressés chacun, et le corpus complet fait ~55 Go ; chaque démarrage
d'application lit en plus `catalog/latest.json`. À quelques centaines
d'installations, le transfert sortant devient le premier poste. R2 ne facture
**pas** l'egress — c'est le seul argument, et il ne vaut que si le trafic est
réel. Surveiller avec `python tools/stats.py bucket --days 30` (voir
`docs/KPI.md`).

**Ce qui rend la migration peu coûteuse, et qu'il faut préserver**

- `book_releases.object_key` porte une **clé relative**, jamais un hôte. Le
  client la colle derrière le réglage `distribution.base_url`
  (`shared/distribution.js`). Changer d'hébergeur, c'est changer ce réglage —
  et les catalogues déjà installés continuent de fonctionner.
- R2 parle l'API S3 : `publish_minio.py` gère déjà MinIO **et** AWS par
  `--endpoint`. Un troisième cas est un `elif`, pas une réécriture.

**Ce qu'il faudra vérifier, point par point**

- **Les requêtes `Range`.** Le téléchargement reprenable en dépend
  entièrement (`download-manager.js`). R2 les gère, mais c'est le premier test
  à écrire.
- **La politique publique.** R2 n'a pas les politiques de bucket S3 : l'accès
  public passe par un domaine public ou un Worker. Le contrat à tenir est celui
  d'aujourd'hui — `GET` anonyme sur `books/*` et `catalog/*`, **et rien
  d'autre**, listing anonyme en 403.
- **Le CORS**, avec `Content-Range` et `Accept-Ranges` exposés.
- **Le `Cache-Control` du pointeur.** `catalog/latest.json` part en `no-cache`
  et c'est vital : c'est le seul objet qui change sous une clé fixe. Le mettre
  en cache un an tuerait la mise à jour en silence — tout marcherait le premier
  jour, plus rien ensuite.
  `test_le_pointeur_n_est_jamais_mis_en_cache` existe pour ça ; il devra tourner
  contre R2.
- **Les journaux d'accès.** R2 n'a pas l'équivalent direct des journaux S3 :
  `tools/stats.py bucket` devrait passer aux journaux Cloudflare, ou la mesure
  d'usage réel se perd. Ne pas migrer avant de savoir par quoi la remplacer —
  c'est la seule source qui dise l'usage, la fréquentation du site venant du
  proxy et les téléchargements de l'API GitHub.
- **La graine de build.** `scripts/fetch-seed.mjs` télécharge la graine depuis
  le bucket au moment du build et **ne se replie sur rien** : un installeur
  silencieusement périmé est pire qu'un build raté. La bascule doit donc se
  faire avec le bucket S3 encore debout, pas après l'avoir éteint.

**À ne pas faire** — migrer « pour la propreté ». Tant que le trafic reste bas,
S3 coûte quelques euros et porte des journaux d'accès qu'on sait lire. Le
déclencheur est un chiffre, pas une envie.
