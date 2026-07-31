## Architecture recommandée

Je partirais sur **4 types de bases/fichiers** :

| Élément           | Rôle                                     | Format                              |
| ----------------- | ---------------------------------------- | ----------------------------------- |
| `catalog.sqlite`  | Catalogue complet des livres disponibles | SQLite téléchargé par l’application |
| `book.sqlite`     | Contenu d’un livre ou d’une édition      | Un SQLite par livre                 |
| `user.sqlite`     | Collections, progression, favoris, notes | SQLite local privé                  |
| Packs spécialisés | Coran, narrateurs, racines, références   | SQLite optionnels                   |

Le dataset contient déjà 8 589 livres, environ 7,6 millions de pages, ainsi qu’un découpage par livre avec `manifest.json`, métadonnées, table des matières et pages.  

---

# 1. Concept important : Work, Edition et Release

Il ne faut pas avoir une seule table `books`.

| Concept   | Exemple                | Utilité                                        |
| --------- | ---------------------- | ---------------------------------------------- |
| `work`    | صحيح البخاري           | Œuvre intellectuelle                           |
| `edition` | Édition Dar Ibn Kathir | Version éditoriale précise                     |
| `release` | Fichier SQLite v2      | Fichier téléchargeable généré par ton pipeline |

Cela permet d’avoir plusieurs éditions ou versions d’un même ouvrage.

```text
work
  └── edition
        └── release
              └── book.sqlite
```

Pour la première version, chaque `book_id` Shamela peut devenir une `edition`. Les regroupements `parent_id` et `group_id` peuvent ensuite servir à créer les `works`.

---

# 2. Catalogue central

Je recommande d’avoir une base source PostgreSQL ou Parquet pendant la transformation, puis de produire un `catalog.sqlite` en lecture seule pour l’application.

## Table `categories`

| Colonne              | Type         | Description         |
| -------------------- | ------------ | ------------------- |
| `category_id`        | INTEGER PK   | Identifiant interne |
| `source_category_id` | INTEGER      | ID Shamela          |
| `parent_id`          | INTEGER NULL | Catégorie parente   |
| `name_ar`            | TEXT         | Nom arabe           |
| `name_normalized`    | TEXT         | Nom pour recherche  |
| `slug`               | TEXT         | Identifiant URL     |
| `sort_order`         | INTEGER      | Ordre d’affichage   |

## Table `authors`

| Colonne            | Type         | Description           |
| ------------------ | ------------ | --------------------- |
| `author_id`        | TEXT PK      | UUID stable           |
| `source_author_id` | INTEGER      | ID Shamela            |
| `name_ar`          | TEXT         | Nom original          |
| `name_normalized`  | TEXT         | Nom normalisé         |
| `death_hijri`      | INTEGER NULL | Décès hégirien        |
| `death_ce`         | INTEGER NULL | Décès grégorien       |
| `biography`        | TEXT NULL    | Biographie éventuelle |

## Table `works`

| Colonne              | Type      | Description          |
| -------------------- | --------- | -------------------- |
| `work_id`            | TEXT PK   | UUID stable          |
| `canonical_title_ar` | TEXT      | Titre principal      |
| `title_normalized`   | TEXT      | Recherche            |
| `category_id`        | INTEGER   | Catégorie principale |
| `description`        | TEXT NULL | Description          |
| `cover_url`          | TEXT NULL | Couverture publique  |

## Table `editions`

| Colonne             | Type         | Description             |
| ------------------- | ------------ | ----------------------- |
| `edition_id`        | TEXT PK      | UUID stable             |
| `work_id`           | TEXT         | Œuvre associée          |
| `source`            | TEXT         | `shamela4`              |
| `source_book_id`    | INTEGER      | `book_id` original      |
| `shamela_id`        | INTEGER      | ID Shamela              |
| `title_ar`          | TEXT         | Titre de cette édition  |
| `category_id`       | INTEGER      | Catégorie               |
| `book_type`         | INTEGER NULL | Type source             |
| `book_type_label`   | TEXT NULL    | Livre, recherche, etc.  |
| `bibliography_text` | TEXT NULL    | `betaka_text`           |
| `printed`           | BOOLEAN      | Livre imprimé           |
| `is_hidden`         | BOOLEAN      | Livre non distribuable  |
| `volume_count`      | INTEGER      | Nombre de volumes       |
| `has_multi_part`    | BOOLEAN      | Plusieurs parties       |
| `language`          | TEXT         | `ar`                    |
| `cover_url`         | TEXT NULL    | Couverture de l’édition |

Ces champs correspondent directement aux métadonnées déjà présentes : titre, catégorie, auteur principal, auteurs secondaires, type, description bibliographique et informations de volumes. 

## Table `edition_authors`

| Colonne      | Type    |
| ------------ | ------- |
| `edition_id` | TEXT    |
| `author_id`  | TEXT    |
| `role`       | TEXT    |
| `position`   | INTEGER |

Clé primaire :

```text
(edition_id, author_id, role)
```

Les rôles peuvent être :

```text
author
editor
compiler
translator
commentator
investigator
```

## Table `book_releases`

C’est la table la plus importante pour le téléchargement.

| Colonne             | Type    | Description              |
| ------------------- | ------- | ------------------------ |
| `release_id`        | TEXT PK | UUID                     |
| `edition_id`        | TEXT    | Livre concerné           |
| `schema_version`    | INTEGER | Version du schéma SQLite |
| `content_version`   | INTEGER | Version du contenu       |
| `source_version`    | TEXT    | Version Shamela          |
| `download_url`      | TEXT    | URL CDN/S3               |
| `compressed_size`   | INTEGER | Taille téléchargement    |
| `uncompressed_size` | INTEGER | Taille installée         |
| `sha256`            | TEXT    | Vérification intégrité   |
| `page_count`        | INTEGER | Nombre de pages          |
| `toc_count`         | INTEGER | Entrées de sommaire      |
| `fts_version`       | INTEGER | Version index recherche  |
| `min_app_version`   | TEXT    | Application minimale     |
| `published_at`      | TEXT    | Date de publication      |
| `is_active`         | BOOLEAN | Release actuelle         |

Exemple de chemin S3 :

```text
catalog/v12/catalog.sqlite.zst

books/
  7f93.../
    1/
      manifest.json
      book-package.zip
```

Les URLs doivent être **immutables** : une nouvelle version crée un nouveau chemin.

## Table `edition_relations`

| Colonne           | Description    |
| ----------------- | -------------- |
| `from_edition_id` | Édition source |
| `to_edition_id`   | Édition cible  |
| `relation_type`   | Relation       |

Relations possibles :

```text
same_work
commentary_of
summary_of
translation_of
continuation_of
volume_of
related_to
```

## Recherche dans le catalogue

```sql
CREATE VIRTUAL TABLE catalog_fts USING fts5(
    edition_id UNINDEXED,
    title_ar,
    title_normalized,
    author_names,
    bibliography_text
);
```

---

# 3. SQLite par livre

Chaque fichier correspond idéalement à **une édition Shamela**, pas forcément à une œuvre conceptuelle.

```text
book-package.zip
├── book.sqlite
├── manifest.json
├── cover.webp
└── assets/
    ├── image-001.webp
    └── image-002.webp
```

## Table `book_info`

Une seule ligne.

| Colonne           | Type    |
| ----------------- | ------- |
| `edition_id`      | TEXT    |
| `source_book_id`  | INTEGER |
| `shamela_id`      | INTEGER |
| `title_ar`        | TEXT    |
| `schema_version`  | INTEGER |
| `content_version` | INTEGER |
| `page_count`      | INTEGER |
| `toc_count`       | INTEGER |
| `created_at`      | TEXT    |
| `content_hash`    | TEXT    |

## Table `volumes`

| Colonne         | Type       |
| --------------- | ---------- |
| `volume_id`     | INTEGER PK |
| `part_number`   | INTEGER    |
| `label_ar`      | TEXT       |
| `sequence_num`  | INTEGER    |
| `first_page_id` | INTEGER    |
| `last_page_id`  | INTEGER    |

## Table `pages`

| Colonne            | Type         | Description                 |
| ------------------ | ------------ | --------------------------- |
| `page_id`          | INTEGER PK   | ID stable interne           |
| `shamela_page_id`  | INTEGER      | ID original                 |
| `volume_id`        | INTEGER NULL | Volume                      |
| `printed_page_num` | INTEGER NULL | Numéro imprimé              |
| `sequence_num`     | INTEGER      | Ordre réel                  |
| `body_html`        | TEXT         | Texte original              |
| `body_plain`       | TEXT         | Texte sans HTML             |
| `body_search`      | TEXT         | Texte arabe normalisé       |
| `footnotes`        | TEXT NULL    | Notes                       |
| `hints`            | TEXT NULL    | Annotations source          |
| `content_hash`     | TEXT         | Détection des modifications |

Le dataset fournit déjà `page_id`, `part`, `page_num`, `sequence_num`, `body`, `footnotes`, `hints` et l’identifiant Shamela. 

Je conserverais toujours :

* `body_html` pour l’affichage fidèle ;
* `body_plain` pour copier et surligner ;
* `body_search` pour la recherche arabe.

## Table `toc`

| Colonne            | Type         |
| ------------------ | ------------ |
| `toc_id`           | INTEGER PK   |
| `parent_toc_id`    | INTEGER NULL |
| `page_id`          | INTEGER      |
| `title_text`       | TEXT         |
| `title_normalized` | TEXT         |
| `level`            | INTEGER      |
| `sequence_num`     | INTEGER      |
| `shamela_title_id` | INTEGER NULL |

Le sommaire source possède déjà une hiérarchie avec `parent_id` et un lien vers la page. 

## Index FTS5

```sql
CREATE VIRTUAL TABLE pages_fts USING fts5(
    page_id UNINDEXED,
    body_search,
    footnotes_search,
    content=''
);
```

Le texte indexé doit être normalisé avant insertion :

```text
Suppression des harakāt
Suppression du tatweel ـ
Normalisation أ إ آ ٱ → ا
Normalisation ى → ي
Normalisation des espaces
Conservation du texte original séparément
```

Il peut être utile d’offrir deux recherches :

| Mode             | Colonne                 |
| ---------------- | ----------------------- |
| Recherche souple | `body_search` normalisé |
| Recherche exacte | `body_plain` original   |

## Table `assets`

| Colonne     | Type         |
| ----------- | ------------ |
| `asset_id`  | INTEGER PK   |
| `file_path` | TEXT         |
| `mime_type` | TEXT         |
| `sha256`    | TEXT         |
| `width`     | INTEGER NULL |
| `height`    | INTEGER NULL |

Les images Base64 présentes dans certaines pages doivent être extraites en fichiers, puis remplacées dans le HTML par une URL locale comme :

```html
<img src="assets/image-001.webp">
```

Le README signale notamment des retours `\r`, du HTML minimal et des images Base64 intégrées dans certaines pages. 

---

# 4. Base locale utilisateur

Cette base ne contient aucune authentification.

## Table `downloaded_books`

| Colonne            | Type    |
| ------------------ | ------- |
| `edition_id`       | TEXT PK |
| `release_id`       | TEXT    |
| `local_path`       | TEXT    |
| `download_status`  | TEXT    |
| `downloaded_bytes` | INTEGER |
| `total_bytes`      | INTEGER |
| `downloaded_at`    | TEXT    |
| `last_opened_at`   | TEXT    |
| `current_page_id`  | INTEGER |
| `current_offset`   | INTEGER |
| `progress_percent` | REAL    |

États possibles :

```text
queued
downloading
verifying
installed
failed
update_available
```

## Table `collections`

| Colonne         | Type      |
| --------------- | --------- |
| `collection_id` | TEXT PK   |
| `name`          | TEXT      |
| `description`   | TEXT NULL |
| `sort_order`    | INTEGER   |
| `created_at`    | TEXT      |
| `updated_at`    | TEXT      |

## Table `collection_books`

| Colonne         | Type    |
| --------------- | ------- |
| `collection_id` | TEXT    |
| `edition_id`    | TEXT    |
| `sort_order`    | INTEGER |
| `added_at`      | TEXT    |

Clé primaire :

```text
(collection_id, edition_id)
```

Un même livre peut donc appartenir à plusieurs collections.

## Table `bookmarks`

| Colonne       | Type         |
| ------------- | ------------ |
| `bookmark_id` | TEXT PK      |
| `edition_id`  | TEXT         |
| `page_id`     | INTEGER      |
| `text_offset` | INTEGER NULL |
| `label`       | TEXT NULL    |
| `created_at`  | TEXT         |

## Table `highlights`

| Colonne         | Type      |
| --------------- | --------- |
| `highlight_id`  | TEXT PK   |
| `edition_id`    | TEXT      |
| `page_id`       | INTEGER   |
| `start_offset`  | INTEGER   |
| `end_offset`    | INTEGER   |
| `selected_text` | TEXT      |
| `prefix_text`   | TEXT NULL |
| `suffix_text`   | TEXT NULL |
| `color`         | TEXT      |
| `created_at`    | TEXT      |

`selected_text`, `prefix_text` et `suffix_text` permettent de retrouver le passage même si une mise à jour modifie légèrement les positions.

## Table `notes`

| Colonne        | Type         |
| -------------- | ------------ |
| `note_id`      | TEXT PK      |
| `edition_id`   | TEXT         |
| `page_id`      | INTEGER NULL |
| `highlight_id` | TEXT NULL    |
| `content`      | TEXT         |
| `created_at`   | TEXT         |
| `updated_at`   | TEXT         |

## Table `reading_history`

| Colonne            | Type       |
| ------------------ | ---------- |
| `history_id`       | INTEGER PK |
| `edition_id`       | TEXT       |
| `page_id`          | INTEGER    |
| `opened_at`        | TEXT       |
| `duration_seconds` | INTEGER    |

---

# 5. Packs de données séparés

Je ne mettrais pas les données globales dans chaque livre.

Le dataset fournit notamment :

* 6 236 versets ;
* 18 989 narrateurs ;
* environ 1,95 million d’entrées de racines ;
* références hadith ;
* références tafsir ;
* chaînes de transmission. 

Je créerais donc :

```text
reference-quran.sqlite
reference-hadith.sqlite
reference-narrators.sqlite
reference-roots.sqlite
```

| Pack      | Contenu                    | Installation                       |
| --------- | -------------------------- | ---------------------------------- |
| Quran     | Versets et correspondances | Inclus ou téléchargement léger     |
| Hadith    | Références croisées        | Optionnel                          |
| Narrators | Narrateurs et isnads       | Optionnel                          |
| Roots     | Dictionnaire de racines    | Optionnel, probablement volumineux |

---

# 6. Pipeline de transformation

```text
Hugging Face JSONL/Parquet
        ↓
Validation des métadonnées
        ↓
Création Work / Edition / Author
        ↓
Nettoyage du texte
        ↓
Extraction des images Base64
        ↓
Création book.sqlite
        ↓
Création index FTS5
        ↓
PRAGMA integrity_check
        ↓
Compression
        ↓
Calcul SHA-256
        ↓
Upload S3/CDN
        ↓
Ajout dans book_releases
        ↓
Génération catalog.sqlite
```

Contrôles à effectuer pour chaque livre :

| Contrôle     | Vérification                          |
| ------------ | ------------------------------------- |
| Pages        | Nombre source = nombre SQLite         |
| TOC          | Toutes les pages référencées existent |
| Ordre        | `sequence_num` unique et continu      |
| Intégrité    | `PRAGMA integrity_check`              |
| Recherche    | Nombre de lignes FTS cohérent         |
| Fichier      | SHA-256                               |
| Distribution | `is_hidden = false`                   |

Le dataset marque certains livres avec `is_hidden: true` pour des restrictions de copyright ou d’accès. Ils ne devraient pas être publiés automatiquement sans validation. 

---

# Modèle final simplifié

```text
CATALOG
category
author
work
edition
edition_author
edition_relation
book_release

BOOK SQLITE
book_info
volume
page
toc
page_fts
asset

USER SQLITE
downloaded_book
collection
collection_book
bookmark
highlight
note
reading_history

OPTIONAL PACKS
quran
narrator
isnad
hadith_xref
tafsir_xref
root_dictionary
```

Le meilleur MVP serait donc :

```text
catalog.sqlite
user.sqlite
books/{edition_id}/book.sqlite
```

avec **un SQLite par édition**, un index FTS5 intégré à chaque livre, et toutes les références utilisateur basées sur `edition_id + page_id`.
