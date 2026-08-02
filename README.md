<div align="center">

<img src="apps/desktop/src/renderer/assets/brand/lockup.png" alt="Beyt El Hikma" width="360" />

**La bibliothèque arabe, hors ligne.**

Application de bureau pour lire le patrimoine arabe — 8 568 éditions,
catalogue local, aucun compte, aucun serveur.

[Télécharger](https://sfellah.github.io/beytelhikma/) ·
[Versions](https://sfellah.github.io/beytelhikma/fr/releases/) ·
[Modèle de données](docs/DATAMODEL.md) ·
[Design](docs/DESIGN.md)

[![ci](https://github.com/sfellah/beytelhikma/actions/workflows/ci.yml/badge.svg)](https://github.com/sfellah/beytelhikma/actions/workflows/ci.yml)

</div>

---

## Ce que c'est

Une application de bureau qui installe un catalogue de 8 568 ouvrages sur la
machine et laisse télécharger les livres un par un. Explorer, chercher et lire
ne demandent **aucune connexion** ; seul le téléchargement d'un livre en
réclame une.

Trilingue de contenu, bilingue d'interface : le corpus est arabe et se lit en
RTL, l'interface se met en arabe ou en anglais. Ces deux directions sont
distinctes et le restent — une page de livre arabe reste RTL sous une interface
anglaise.

Le même rendu tourne sur Android, sous Capacitor, sur SQLite natif : le portage
tient en **un seul fichier remplacé** — celui qui touche le pont — et rien du
routeur, des vues, des thèmes ou du RTL n'est dupliqué.

## L'arborescence

| Dossier | Rôle |
| --- | --- |
| `apps/desktop/` | l'application de bureau (Electron) — processus principal, préchargement, rendu. Voir son [README](apps/desktop/README.md). |
| `apps/mobile/` | l'application Android (Capacitor) — le même rendu, sur SQLite natif. Voir son [README](apps/mobile/README.md). |
| `site/` | le site de présentation et de téléchargement : trois pages × trois langues, générées sans dépendance. |
| `tools/` | la chaîne de données Python — import du corpus Shamela, génération du jeu d'exemple, publication vers S3. |
| `docs/` | le modèle de données, le système visuel, les maquettes, les notes de conception et les spikes. |

Trois documents portent le reste : [`docs/DATAMODEL.md`](docs/DATAMODEL.md) pour
le schéma des trois bases, [`docs/DESIGN.md`](docs/DESIGN.md) pour le système
visuel, [`CLAUDE.md`](CLAUDE.md) pour les règles d'architecture et leurs raisons.

## Démarrer

```bash
# l'application de bureau
cd apps/desktop
npm install
npm run seed        # récupère le catalogue publié depuis le bucket
npm start
npm test

# l'application Android — un appareil ou un émulateur connecté
cd apps/mobile
npm install
npm run verify      # parité des 67 méthodes du pont, hors appareil
npm run data        # bucket -> .sqlite -> adb push  (~30 Mo)
npm run android

# le site — aucune dépendance à installer
cd site
node build.mjs                            # état réel
node build.mjs --data test/fixtures/data  # aperçu avec une version fictive
node serve.mjs                            # http://localhost:4173/beytelhikma/
node --test "test/**/*.test.js"
```

## Trois règles qui expliquent le reste

**Local d'abord, pas d'API.** La source de vérité est SQLite : `catalog.sqlite`
en lecture seule pour le catalogue, `books/<edition_id>.sqlite` par livre,
`user.sqlite` en lecture/écriture pour la bibliothèque, la progression et les
annotations. L'interface ne touche jamais une base — tout passe par le pont IPC
vers `BookRepository`, et les erreurs remontent typées.

**Le catalogue ne porte aucun hôte.** Il stocke une clé d'objet relative que le
client colle derrière un réglage. C'est ce qui garde le jeu d'exemple utilisable
hors ligne et permet de changer de bucket sans réécrire une seule ligne du
catalogue.

**La mise à jour se propose, ne s'impose pas.** Au démarrage, l'application lit
un pointeur et compare. Cinq branches de décision sur six sont silencieuses :
une application hors ligne a déjà tout ce qu'il lui faut pour explorer, lui
afficher une alerte serait du bruit. Un refus est retenu par version.

## Deux chaînes de build

Elles ont deux cadences et un seul point de couplage.

**La bibliothèque** — `python tools/release_library.py` — tourne en local : le
corpus source pèse ~60 Go, aucune CI ne l'aura. Elle importe, publie par
tranches, vérifie sans identifiants, nettoie.

**L'application et le site** — GitHub Actions. Un tag `v*` construit les
installeurs Windows et Linux, rédige la Release depuis les `CHANGELOG`, la
publie, la relit sans jeton, puis redéploie le site.

## Publier une version

1. Écrire les notes en tête des trois `CHANGELOG.{ar,fr,en}.md`. Même version,
   même date dans les trois — le build échoue sinon, exprès. Les titres de
   rubrique sont des clés fixes (`added`, `changed`, `fixed`, `removed`,
   `security`), traduites à l'affichage.
2. Aligner la version :
   `npm --prefix apps/desktop version <x.y.z> --no-git-tag-version`
3. Pousser sur `main`, puis `git tag v<x.y.z> && git push origin v<x.y.z>`.

Le reste est automatique. Le site relit l'API GitHub et se reconstruit :
**aucune URL de téléchargement n'est devinée**, seules celles que la Release
porte réellement sont affichées.

Rattrapages :

```bash
gh workflow run site.yml                    # republier le site seul
gh workflow run release.yml -f tag=v0.4.0   # rejouer un tag existant
```

## État

Publié : le catalogue (8 568 éditions, `catalog_version` 2) sur
`beytelhima-library` en `eu-west-1`, et le site.

Les trois findings de sécurité qui bloquaient l'ouverture du dépôt sont
corrigés et tenus par des tests : la garde `will-navigate` (`src/main/navigation.js`),
la validation d'`edition_id` avant tout `path.join` (`src/main/edition-id.js`),
et le SHA-256 du catalogue vérifié **avant** le `rename`
(`src/main/catalog-updater.js`).

Reste à faire, dans cet ordre :

1. **La mise à jour du catalogue au démarrage.** Le chemin complet est en place
   et testé — pointeur, décision, installation vérifiée — mais rien n'appelle
   `checkCatalogUpdate` à l'ouverture. Le seul déclencheur est le bouton de
   `/settings`, et `declineCatalogUpdate` n'a donc aucun appelant.
2. **Le câblage `electron-updater`.** La configuration de publication est en
   place et les workflows produisent déjà `latest.yml` ; le module côté
   application reste à écrire. Ni la cible portable ni le `.deb` ne peuvent se
   mettre à jour — seul l'AppImage le peut.
3. **La signature Windows.** Sans certificat, SmartScreen affiche un
   avertissement à chaque installation ; la page de téléchargement le dit et
   donne l'empreinte SHA-512.
4. **L'application Android n'a pas de chaîne de publication.** `npm run
   android:release` produit une archive signée de la clé de débogage ; aucun
   workflow ne la construit, et rien ne la distribue.

## Licence

[AGPL-3.0-or-later](LICENSE). Le corpus provient de la Bibliothèque Shamela.
