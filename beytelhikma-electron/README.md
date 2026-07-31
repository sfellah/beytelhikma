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
python ../tools/import_shamela.py --books-per-category 3   # 120 livres -> ../dist/shamela
npm start                                                  # les utilise automatiquement
```

Au premier accès, `AppDatabase` matérialise les fichiers dans
`app.getPath('userData')/library` — le catalogue au démarrage, chaque livre à sa
première ouverture —, comme le fera un jour le téléchargement depuis un CDN.
Un `library.json` y note la source installée : si elle change, les copies sont
jetées et réinstallées, `user.sqlite` étant conservé.

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
exception, commentée : le panneau de réglages du lecteur glisse via
`transform`, qui ignore le sens d'écriture.

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
4. **Lecteur** — une page imprimée par écran, sélection de texte native, taille
   de police (curseur, boutons, `Ctrl`+molette), ambiances ورقي / أبيض / ليلي,
   police serif ou sans, progression écrite dans `user.sqlite`.

Navigation clavier du lecteur : `←` page suivante, `→` page précédente,
`Échap` ferme le panneau ou revient en arrière.

## Hors périmètre

Recherche plein texte (FTS5 est indexé dans les bases mais non exposé) et
gestionnaire de téléchargement — comme dans la version Flutter.
