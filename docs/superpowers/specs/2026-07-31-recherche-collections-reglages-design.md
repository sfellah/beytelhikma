# Recherche dans le livre, collections, réglages

Date : 2026-07-31
Portée : `apps/desktop/`. Aucun changement de schéma, aucun changement de pipeline.

Troisième et dernier volet, après la distribution MinIO et l'exploration du
catalogue. Il ferme les trois derniers écrans laissés en attente.

## 0. Contrainte découverte : pas de FTS5

Le build sql.js embarqué ne contient **pas** le module FTS5, seulement FTS4
(vérifié : la chaîne `fts5` est absente de `sql-wasm.wasm`). Les tables
`catalog_fts` et `pages_fts` sont donc illisibles depuis Electron. Le pipeline
continue de les produire — le client Flutter s'en sert — mais ce portage ne les
interroge jamais.

Ce n'est pas un problème : le schéma expose déjà les colonnes normalisées dont
la recherche a besoin, `pages.body_search` et `toc.title_normalized`, remplies
par `normalize_ar`. Un `LIKE` sur ces colonnes donne exactement le même rappel
que FTS, sans le module.

## 1. Recherche dans le contenu d'un livre

### Données

```sql
SELECT page_id, sequence_num, printed_page_num, body_plain
  FROM pages
 WHERE body_search LIKE ? ESCAPE '\'
 ORDER BY sequence_num
 LIMIT ?
```

Le terme est normalisé par `normalizeArabic()`, puis `%`, `_` et `\` y sont
échappés — sans quoi un terme contenant `%` ramènerait tout le livre.

Les titres du sommaire sont interrogés en parallèle sur `toc.title_normalized`,
et leurs résultats précèdent ceux du corps : trouver un chapitre vaut mieux que
trouver une occurrence perdue au milieu d'une page.

### Extrait et surlignage

`body_search` est normalisé, `body_plain` ne l'est pas : leurs longueurs
diffèrent, donc les positions trouvées dans l'un ne valent pas dans l'autre.

D'où une seconde fonction dans `src/shared/arabic.js` :
`arabicSearchPattern(term) -> RegExp`, qui construit à partir du terme normalisé
une expression tolérante appliquée au **texte d'origine** :

| Caractère normalisé | Classe engendrée |
| --- | --- |
| `ا` | `[اأإآٱ]` |
| `ي` | `[يى]` |
| `ه` | `[هة]` |
| espace | `\s+` |
| autre | le caractère, échappé |

Entre deux caractères, l'expression admet `[harakāt et tatweel]*`. Chercher
`احمد` trouve donc `أَحْمَد` **à la bonne position**, ce qui permet d'extraire un
extrait de soixante caractères de part et d'autre et de surligner la
correspondance.

Le même motif sert à surligner les occurrences dans la page une fois affichée :
un parcours des nœuds de texte enveloppe chaque correspondance dans un `<mark>`.

### Interface

Le lecteur a déjà des panneaux latéraux (sommaire, réglages). La recherche en
devient un troisième, ouvert par une icône dans la barre du lecteur ou par
`Ctrl+F`.

Le panneau montre le champ, le nombre de résultats, puis la liste : titre de
chapitre ou numéro de page imprimée, et l'extrait avec le terme en gras.
Cliquer va à la page et y surligne les occurrences.

## 2. Collections personnelles

Les tables existent dans `user.sqlite` et n'ont jamais servi :

```sql
collections(collection_id TEXT PK, name, description, sort_order, created_at, updated_at)
collection_books(collection_id, edition_id, sort_order, added_at, PK(collection_id, edition_id))
```

`collection_id` est un `crypto.randomUUID()`.

### Opérations

`getCollections()` renvoie chaque collection avec son nombre de livres et le
nombre d'entre eux réellement installés. `createCollection(name)`,
`renameCollection(id, name)`, `deleteCollection(id)` — supprimer une collection
efface ses liens, **jamais les livres**. `addToCollection(id, editionIds)` et
`removeFromCollection(id, editionId)`.

`getCollectionBooks(id)` joint les `edition_id` au catalogue et porte le statut
d'installation, comme la bibliothèque.

Une collection peut contenir un livre non installé : c'est une liste d'envies
autant qu'un rangement. De là, `downloadSelection` sur tous ses livres manquants.

### Interface

Pas de sixième entrée dans la barre de navigation, déjà à cinq. Les collections
vivent dans `/library`, en bandeau au-dessus de la grille : une carte par
collection, plus une carte « nouvelle collection ». La route `/collection/:id`
affiche son contenu, avec renommage, suppression et « تنزيل الكل ».

Deux points d'entrée pour ranger un livre : le bouton `إضافة إلى مجموعة` de la
fiche livre, et le mode sélection de l'exploration, qui gagne l'action
`أضف إلى مجموعة` à côté de `تنزيل المحدد`.

La boîte de choix réutilise `confirmDialog` : liste des collections existantes,
plus un champ pour en créer une à la volée.

## 3. Écran de réglages

`/settings` affiche aujourd'hui un texte d'attente. Quatre sections.

**القراءة** — taille de police par défaut, ambiance (ورقي / بني / ليلي), police
(serif / sans). Ce sont les clés `reader.fontSize`, `reader.theme`,
`reader.font` déjà écrites par le lecteur : les régler ici change le point de
départ des prochaines ouvertures.

**التخزين** — nombre de livres installés et espace occupé (`getStorageUsage`),
un lien vers `/downloads`, et `حذف كل الكتب` qui efface tous les fichiers en
conservant la progression, derrière confirmation.

**الخادم** — le champ `minio.base_url`. Vide, l'application suit les
`download_url` du catalogue ; renseigné, elle en remplace l'origine. Le réglage
s'applique **immédiatement** à la file en cours, sans redémarrage.

> **Remplacé.** Cette section est devenue **مصدر التنزيل**, portée par
> `distribution.base_url`, qui *préfixe* la clé du catalogue au lieu d'en
> remplacer l'origine — remplacer l'origine seule cassait entre un bucket
> virtual-hosted et un path-style. Elle porte aussi la vérification de version du
> catalogue. Voir
> `2026-07-31-source-distribution-configurable-design.md`.

**عن التطبيق** — chemin de la bibliothèque source, version du schéma
utilisateur, nombre d'éditions au catalogue. Lecture seule : ce sont les
informations qu'on demande quand quelque chose ne va pas.

## 4. Nouvelles méthodes du dépôt

```
searchInBook(editionId, term, { limit })   -> { chapters, pages }
getCollections()                            -> [{ id, name, bookCount, installedCount }]
createCollection(name)                      -> id
renameCollection(id, name)
deleteCollection(id)
addToCollection(id, editionIds)             -> nombre ajouté
removeFromCollection(id, editionId)
getCollectionBooks(id)                      -> [{ book, status }]
deleteAllBooks()                            -> nombre supprimé
setDownloadBaseUrl(url)
getAbout()                                  -> { librarySource, schemaVersion, editionCount }
```

## 5. Tests

`test/arabic.test.js` — `arabicSearchPattern` : trouve `أَحْمَد` depuis `احمد`,
trouve `الرسالة` depuis `الرساله`, respecte les frontières, et échappe les
métacaractères d'expression régulière présents dans le terme.

`test/repository.test.js` :

- `searchInBook` trouve un terme présent avec et sans diacritiques, et renvoie
  un extrait qui contient réellement le terme ;
- un terme contenant `%` ne ramène pas tout le livre ;
- une collection se crée, se renomme, reçoit des livres, les rend, et sa
  suppression n'efface aucun livre ;
- `getCollectionBooks` ignore les éditions absentes du catalogue ;
- `deleteAllBooks` vide le dossier et conserve les progressions ;
- `setDownloadBaseUrl` est relu par `getSettings`.

## 6. Hors périmètre

- Alignement du client Flutter sur le téléchargement : autre chantier.
- Recherche transversale à tous les livres installés : elle demanderait d'ouvrir
  chaque base, ce que sql.js paie en mémoire.
- Partage ou export de collections.
