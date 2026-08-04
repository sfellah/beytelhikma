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
