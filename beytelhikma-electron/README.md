# Beyt El Hikma — Electron

Portage Electron de l'application **بيت الحكمة** (bibliothèque numérique arabe et
lecteur), calqué sur les maquettes de `../ui-examples/`. Même modèle de données
et même découpage que l'application Flutter voisine : local-first, aucune API.

## Démarrer

```bash
npm install     # electron + sql.js
npm start       # lance l'application
npm test        # tests du repository sur les vraies bases d'exemple
npm run shot    # écrit build/screenshots/*.png (relecture du design)
```

## Données

Trois bases SQLite, conformément à `../DATAMODEL.md` :

| Base                        | Rôle                                     | Accès            |
| --------------------------- | ---------------------------------------- | ---------------- |
| `catalog.sqlite`            | catalogue (œuvres, éditions, auteurs)    | lecture seule    |
| `books/<edition_id>.sqlite` | contenu d'un livre (pages, volumes, toc) | lecture seule    |
| `user.sqlite`               | bibliothèque, progression, réglages      | lecture/écriture |

### D'où vient la bibliothèque

`resolveLibrarySource()` retient le premier dossier contenant un `catalog.sqlite` :

1. `BEYTELHIKMA_LIBRARY` — pour pointer une bibliothèque arbitraire ;
2. `../dist/shamela/` — la sortie de `../tools/import_shamela.py` (corpus réel) ;
3. `assets/sample/` — les 5 livres factices de `../tools/gen_sample_data.py`, pour
   qu'un dépôt fraîchement cloné démarre sans avoir lancé l'import.

Ne jamais éditer `assets/sample/` à la main : modifier le générateur puis recopier.

```bash
python ../tools/import_shamela.py --books-per-category 10  # 397 livres -> ../dist/shamela
npm start                                                  # les utilise automatiquement
```

Au premier accès, `AppDatabase` copie **le catalogue seul** dans
`app.getPath('userData')/library`. Les livres, eux, ne se matérialisent plus tout
seuls : `AppDatabase.book()` exige un fichier installé et lève
`BookNotInstalledError` sinon. C'est `download-manager.js` qui les installe.

Un `library.json` note la source installée. Si elle change, le catalogue est jeté
— il appartenait à l'ancienne source — mais **les livres restent**. Purger
`books/` était tenable quand la source était un dossier qu'on changeait à la
main ; avec un catalogue qui se met à jour tout seul depuis le bucket, ce serait
tout retélécharger à chaque rafraîchissement. La réconciliation se fait par
édition, à la lecture.

### D'où viennent les livres

Le catalogue ne porte aucun hôte : `book_releases.object_key` contient une clé
relative (`books/<edition_id>/<content_version>/book.sqlite.zst`) que
l'application colle derrière son réglage `distribution.base_url`. Une seule
règle : **la présence de `://` marque un absolu** — `asset://` et `local://`
désignent la bibliothèque source, ce qui garde les deux jeux locaux utilisables
sans réseau et fait tourner les tests sans serveur.

Changer `distribution.base_url` suffit donc à servir la même bibliothèque depuis
un autre bucket, sans rien retélécharger de ce qui est installé. La résolution
vit dans `src/shared/distribution.js`, et nulle part ailleurs.

Au démarrage, `catalog-updater.js` lit `catalog/latest.json` sur le bucket et
compare les versions. Cinq branches de décision sur six sont silencieuses : hors
ligne, pointeur illisible, schéma trop récent, déjà à jour, version refusée. Une
application hors ligne a déjà tout ce qu'il lui faut pour explorer.

**Limite connue** : `sql.js` charge chaque livre intégralement en mémoire. Les
120 livres de la sélection par défaut plafonnent à ~18 Mo, mais le corpus complet
(`--all`) contient des livres de plusieurs centaines de Mo qui ne s'ouvriront pas.

`sql.js` (SQLite compilé en WebAssembly) évite toute dépendance native à
recompiler par version d'Electron. Il travaille en mémoire : chaque écriture
dans `user.sqlite` réexporte le fichier sur disque — les bases pèsent quelques
dizaines de kilo-octets.

## Architecture

```
src/main/       processus principal : bases, repository, IPC, fenêtre
src/preload/    pont contextBridge : la seule surface exposée au rendu
src/renderer/   interface (ES modules, CSS maison, aucun bundler)
  js/views/     accueil, bibliothèque, fiche livre, lecteur
  js/components/ carte livre, couverture, états loading/empty/error
  styles/       jetons de la maquette, coquille, composants, vues
```

Règles reprises de l'application Flutter :

- **Le rendu ne touche jamais SQLite.** Il appelle `window.beytelhikma.repository`,
  qui passe par IPC vers `BookRepository` ; toute erreur remonte en
  `RepositoryError` avec un message affichable.
- **Quatre états par écran** : `loading / success / empty / error` (`asyncView`).
- **Pas de contenu statique dans l'interface** : tout vient du repository.
- **Aucune chaîne HTML interprétée.** Le contenu des livres passe par
  `content-html.js`, qui reconstruit les nœuds selon une liste blanche ; la
  fenêtre tourne avec `contextIsolation`, `sandbox` et une CSP stricte, sans
  accès réseau.

## RTL et typographie

L'interface est en arabe : `dir="rtl"` et propriétés logiques partout
(`inset-inline-start`, `margin-inline`, `border-inline-end`). Une seule
exception, commentée : les panneaux du lecteur glissent via `transform`, qui
ignore le sens d'écriture — ils sont donc ancrés au bord **physique droit**,
celui où la barre haute pose ses outils en RTL, et le texte leur cède la place
plutôt que de se lire par-dessous (`.reader.has-panel`).

Les polices de la maquette (Playfair Display, Source Serif 4, Inter) sont
servies par Google Fonts, indisponible hors ligne : les piles retombent sur les
serifs arabes du système (Amiri, Traditional Arabic…). Déposer les `.ttf` dans
`assets/fonts/` et déclarer les `@font-face` suffirait à retrouver la maquette
au pixel près. Même chose pour les icônes : Material Symbols est remplacé par
un jeu SVG local (`js/icons.js`).

## Marque

`src/renderer/assets/brand/` est dérivé de `../logo.png` par
`python ../tools/gen_brand_assets.py` — ne rien y éditer à la main, relancer le
générateur. Il découpe le lockup en deux : le **symbole** (`mark.png`) sert
partout où la place est carrée (rail, barre supérieure) pendant que le nom
« بيت الحكمة » reste du texte à côté, net et sélectionnable ; le **lockup**
entier (`lockup.png`) est réservé aux surfaces larges. Les variantes `-light`
remplacent l'encre vert foncé par du crème pour un fond sombre — la coquille est
crème aujourd'hui, elles n'ont donc pas encore d'emploi. `app-icon.png`
(512×512, plaque crème arrondie) est l'icône de la fenêtre et de la barre des
tâches.

## Écrans

1. **Accueil** — reprise de lecture avec citation de la page courante,
   nouveautés en défilement horizontal, disciplines, auteur en vedette.
2. **Bibliothèque** — livres installés, filtres (الكل / قيد القراءة / مكتمل),
   tri, bascule grille/liste, progression par livre.
3. **Fiche livre** — métadonnées présentes uniquement, auteur, sommaire
   hiérarchique cliquable, œuvres de la même discipline.
4. **Lecteur** — deux façons de parcourir un livre, au choix dans les réglages
   (`نمط القراءة`) : **صفحة صفحة**, une page imprimée par écran, ou **تمرير
   متصل**, le fil continu où les pages s'enchaînent et où le pied imprimé ne
   fait plus que séparer. Le fil ne garde qu'une tranche de pages autour de la
   lecture (`FLOW_KEEP`) : sql.js tient déjà tout le livre en mémoire, un fil
   sans fin ferait enfler la page autant que le processus. Sélection de texte
   native, taille de police (curseur, boutons, `Ctrl`+molette), ambiances
   ورقي / أبيض / ليلي, police serif ou sans, progression écrite dans
   `user.sqlite`. Le menu de sélection surligne (quatre teintes de la palette du
   projet), commente et cherche le passage ; un panneau liste les annotations du
   livre, filtrables par type, et un bouton pose une marque-page — le signet se
   voit alors sur la page comme dans la barre haute.
5. **Téléchargements** — la file en cours, puis **tout le catalogue en table
   paginée** : titre, discipline, nombre de pages, taille, statut. On y
   télécharge, annule, ouvre et supprime, livre par livre ou par sélection.
6. **Recherche dans les textes** (`/search`) — le terme est cherché dans le
   contenu de tous les livres **installés**, puis dans les annotations. Le
   catalogue, lui, se cherche depuis l'exploration : trouver un livre et
   trouver un passage sont deux gestes, ils ne se mélangent pas dans une même
   liste. `Entrée` dans la barre du haut mène au catalogue, `Ctrl+Entrée` aux
   textes.
7. **Mes notes** (`/notes`) — notes, surlignages et marques-pages de tous les
   livres, filtrables par type et par texte ; chaque entrée rouvre sa page.

Navigation clavier du lecteur : `←` page suivante, `→` page précédente,
`Début`/`Fin` les deux bouts, `B` marque-page, `N` mes notes, `C` sommaire,
`V` bascule le mode de lecture, `Ctrl+F` recherche, `F11` plein écran, `؟` la
fiche des raccourcis, `Échap` ferme le panneau ou revient en arrière. La fiche
(`؟`) est la source à tenir à jour : c'est elle que l'utilisateur lit, la
constante `SHORTCUTS` de `views/reader.js` en est le texte.

### Pagination

Le corpus fait 8 589 livres et plusieurs milliers d'auteurs : aucun écran ne
peut tout montrer. Toute lecture qui déborde d'un écran renvoie
`{ rows, total }`, et **le nombre affiché vient toujours de `total`, jamais de
`rows.length`** — un `limit` sans `total` faisait annoncer à l'écran des
auteurs le nombre qu'il avait reçu plutôt que le nombre qu'il y a.

| Écran | Lecture | Compte à part |
| --- | --- | --- |
| `/authors` | `getAuthors` (tri, recherche) | `getAuthorStats`, `getEras` |
| `/author/:id`, `/category/:id`, `/era/:id` | `getBooksIn` | `total` de la même requête |
| `/library` | `getLibrary` (filtre, tri) | `counts` par onglet |
| `/collection/:id` | `getCollectionBooks` | `total` et `missing` sur tout le lot |
| `/notes`, `/downloads`, `/explore` | déjà paginés | — |

Le sommaire d'un livre échappe à la règle : le lecteur en a besoin en entier
pour nommer le chapitre de chaque page. Il est donc chargé d'un bloc mais
**fenêtré à l'affichage** (`TOC_WINDOW`), avec un champ qui filtre sur le titre
normalisé.

### Ancrage des annotations

Un surlignage garde ses décalages **dans le texte rendu** de la page, plus le
passage lui-même et son contexte (`prefix_text` / `suffix_text`). À
l'affichage, les décalages sont essayés d'abord ; s'ils ne retombent pas sur le
même texte — livre réédité, rendu modifié — l'occurrence la plus proche est
retenue. Un passage devenu introuvable n'est pas dessiné mais reste en base et
dans la liste des annotations : rien n'est perdu en silence. Voir
`src/renderer/js/annotations.js`.

## Hors périmètre

FTS5 reste inexploitable ici (le build sql.js embarqué ne contient que FTS4) :
la recherche s'appuie sur les colonnes normalisées `pages.body_search` et
`toc.title_normalized`. Le balayage transversal ouvre les livres un par un et
referme ceux qu'il a ouverts ; il est borné (`maxBooks`) et dit ce qu'il n'a
pas parcouru.
