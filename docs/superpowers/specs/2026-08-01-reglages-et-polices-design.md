# Réglages : hiérarchie, polices séparées, polices ajoutées — conception

*2026-08-01 — phase 2 de deux. Dépend de
`2026-08-01-i18n-ar-en-design.md` : l'écran écrit ici passe par `t()`, et la
liste des polices d'interface suit la locale.*

## Ce qu'on résout

Quatre choses, dont trois sont des pannes et non des goûts.

**Une liste de polices a déjà divergé.** `views/reader.js:31` déclare trois
familles — son commentaire dit « Trois familles embarquées » — et
`views/settings.js:12` n'en déclare que deux. `--font-naskh` et
`.reader--font-naskh` existent dans `tokens.css` et `views.css`, mais aucun
réglage ne les propose : Noto Naskh Arabic est **orpheline**, accessible depuis
le lecteur et invisible depuis les réglages. C'est exactement la panne du thème
`sepia` que `CLAUDE.md` raconte, rejouée sur les polices.

**Les six sections se ressemblent.** Même titre, même poids, aucun repère.
Rien ne distingue « المظهر » de « منطقة الخطر ».

**Le destructif est au milieu.** « حذف كل الكتب » vit dans « التخزين », entre
deux boutons « فتح » anodins, à mi-écran. On peut l'atteindre en passant.

**Les actions sont des mots seuls.** « حفظ », « حذف », « فتح » : pas d'icône,
`button--tonal` partout, aucune hiérarchie entre ouvrir une liste et effacer
la bibliothèque.

## Polices : deux réglages, deux usages

L'interface parle deux langues, le corpus reste arabe. Les deux réglages ont
donc chacun un domaine qui ne recouvre pas l'autre.

| Réglage | Peint | Choix proposés |
|---|---|---|
| `app.font` — خط الواجهة | coque, navigation, réglages, listes | suit la locale |
| `reader.font` — خط القراءة | le texte du livre, toujours arabe | faces arabes |

`app.font` liste les faces **latines** quand la locale est `en`, les faces
**arabes** quand elle est `ar`. Une liste qui proposerait EB Garamond à une
interface arabe offrirait un choix sans effet visible — le seul cas où ça se
verrait sont les chiffres, qui sont arabes-indiens en mode `ar`. La liste suit
donc la locale, et ne montre jamais une face qui ne rendrait rien.

`reader.font` ne liste que des faces arabes : le corpus l'est.

`app.font` se pose comme le thème : un attribut sur `<html>`, et `tokens.css`
en tire `--font-display` et `--font-label`. La chaîne de repli système reste en
queue de chaque déclaration, pour qu'un fichier manquant ne laisse pas
l'interface sans police. `--font-body` et `--font-naskh` ne bougent pas : elles
servent le lecteur, que `reader.font` gouverne seul.

Comme le thème et la locale, `app.font` porte un miroir `localStorage` lu en
synchrone au démarrage — sans lui, l'interface se peindrait dans la police par
défaut puis sauterait à celle choisie, une fois les réglages arrivés par IPC.

### Les six familles de base

Arabes, **déjà embarquées** — Amiri (naskh de bibliothèque), Noto Naskh Arabic
(plus ouvert, celle qui était orpheline), IBM Plex Sans Arabic (pour
manœuvrer).

Latines, **à embarquer** — Literata (dessinée pour Google Books, faite pour la
lecture longue à l'écran), EB Garamond (le garamond, référence du livre
imprimé), Source Serif 4 (ouverte, lisible en petit corps).

`tools/fetch_fonts.py` gagne ces trois familles dans son `API`, avec le seul
sous-ensemble `latin` — leur sous-ensemble arabe n'existe pas.

### `src/shared/fonts.js` — la liste, seule

Sur le modèle de `shared/theme.js`, et pour la raison qu'on vient de vivre :

```js
export const FONTS = [
  { key: 'amiri',   family: 'Amiri',                 scripts: ['arab'], label: 'أميري' },
  { key: 'naskh',   family: 'Noto Naskh Arabic',     scripts: ['arab'], label: 'نسخ' },
  { key: 'plex',    family: 'IBM Plex Sans Arabic',  scripts: ['arab'], label: 'بلكس' },
  { key: 'literata',   family: 'Literata',      scripts: ['latn'], label: 'Literata' },
  { key: 'garamond',   family: 'EB Garamond',   scripts: ['latn'], label: 'EB Garamond' },
  { key: 'sourceserif', family: 'Source Serif 4', scripts: ['latn'], label: 'Source Serif' },
];
export const DEFAULT_READER_FONT = 'amiri';
export function fontsForScript(script) { … }
export function resolveFont(stored, script) { … }   // replie sur le défaut
```

`views/reader.js` et l'écran des réglages importent cette liste. Ni l'un ni
l'autre n'en redéclare une — `test/fonts.test.js` l'interdit, comme
`test/theme.test.js` le fait pour les thèmes.

Les clés `serif` / `sans` déjà écrites dans `user.sqlite` se replient :
`serif → amiri`, `sans → plex`. Une clé inconnue prend le défaut. Aucune
migration, `resolveFont` suffit.

Les classes CSS suivent la clé : `.reader--font-amiri`, `--naskh`, `--plex`.
Les trois blocs existent déjà sous les anciens noms (`serif`, `naskh`, `sans`)
et sont renommés.

## Ajouter une police depuis Google Fonts

L'utilisateur colle `https://fonts.googleapis.com/css2?family=Vibes&display=swap`
et la police devient disponible dans les deux listes, selon les scripts
qu'elle couvre.

### Installer, pas lier

La CSP est fermée :

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
```

Poser un `<link>` vers `fonts.googleapis.com` imposerait d'ouvrir `style-src`
**et** `font-src` vers deux hôtes tiers. Deux conséquences, toutes deux
inacceptables ici : l'application appelle Google à chaque démarrage — donc un
lecteur hors ligne perd ses polices, alors que tout le reste de l'application
fonctionne sans réseau — et chaque lancement émet une requête vers un tiers.

On fait donc ce que `tools/fetch_fonts.py` fait déjà au build, mais à
l'exécution : **on télécharge et on installe**. Une seule requête réseau, au
moment de l'ajout. Ensuite la police est un fichier local comme les six
autres.

### `src/main/font-installer.js`

1. Récupère la feuille CSS avec l'en-tête `User-Agent` de Chrome — sans lui,
   Google renvoie du TTF non compressé. `fetch_fonts.py` porte déjà cette
   constante et la raison.
2. Lit les blocs `@font-face`, retient les sous-ensembles `arabic` et `latin`
   et leurs `unicode-range`.
3. Télécharge les `.woff2` vers `userData/fonts/<slug>/`.
4. Écrit la police dans `user.sqlite`.

Le rendu **ne reçoit jamais la feuille de Google**. On en extrait des URL et
des `unicode-range` ; l'application réécrit ses propres règles `@font-face`.

### Bornes de sécurité

Le champ prend une URL fournie par l'utilisateur, et le processus principal va
la chercher : c'est une requête sortante arbitraire déclenchée depuis
l'interface. Quatre bornes, chacune avec son test.

- **Hôtes en liste fermée.** La feuille doit venir exactement de
  `fonts.googleapis.com`, les fichiers exactement de `fonts.gstatic.com`.
  Toute autre origine est refusée, quelle que soit l'URL collée et quelle que
  soit l'origine annoncée dans la feuille.
- **`https` seul**, et **aucune redirection suivie vers un autre hôte** — une
  liste d'hôtes que la redirection contourne ne protège rien.
- **Tailles plafonnées** : 256 Kio par feuille, 2 Mio par fichier de police,
  8 Mio par famille installée.
- **`.woff2` uniquement** écrit sur disque, et le nom de fichier est
  **construit** par l'application depuis le slug et le poids — jamais repris de
  l'URL distante, qui traverserait le chemin.

Le nom de famille extrait de la feuille est traité comme une donnée hostile :
il est écrit dans `user.sqlite` et rendu comme du texte, jamais concaténé dans
une règle CSS sans être cité et échappé.

### `userfont://`

Les fichiers vivent dans `userData/`, hors du dossier de l'application : la
page étant chargée par `loadFile` (`main.js:100`), ils ne sont pas `'self'`.

Le processus principal enregistre un schéma `userfont:` servant **uniquement**
depuis `userData/fonts/`, chemin résolu et vérifié comme descendant de cette
racine. La CSP gagne exactement un mot :

```
font-src 'self' userfont:;
```

`script-src` et `style-src` ne bougent pas. Une police ajoutée ne peut donc
jamais exécuter quoi que ce soit.

### Stockage

Nouvelle table dans `user.sqlite`, migration **additive**, `user_version`
passe de 2 à **3** :

```sql
CREATE TABLE IF NOT EXISTS user_fonts (
  key          TEXT PRIMARY KEY,
  family       TEXT NOT NULL,
  scripts      TEXT NOT NULL,      -- 'arab', 'latn', ou 'arab,latn'
  source_url   TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  faces        TEXT NOT NULL       -- JSON : [{weight, subset, file, range}]
);
```

Comme les autres migrations, elle est rejouée à l'ouverture par
`AppDatabase.#migrateUser`.

### Méthodes exposées

`installFont`, `listFonts`, `removeFont` — ajoutées **aux deux listes**,
`METHODS` de `preload.cjs` et `REPOSITORY_METHODS` de `book-repository.js`.
Une méthode posée d'un seul côté ne casse rien au démarrage : elle échoue au
premier clic. `test/repository.test.js` porte déjà le test de parité.

## L'écran

```
الإعدادات

◐ اللغة والمظهر
  اللغة        [ العربية ✓ ][ English ]
               الصفحة ٤٢ من ٣٥٠            ← aperçu des chiffres
  السمة        [paper][white][night]

◇ الخطوط
  خط الواجهة   [ أميري ][ نسخ ][ بلكس ]      ← suit la locale
               الصفحة ٤٢ من ٣٥٠
  خط القراءة   [ أميري ][ نسخ ][ بلكس ]
               بسم الله الرحمن الرحيم
  حجم القراءة  ▁▂▃▄▅  ٢٢
  إضافة خط     [ https://fonts.googleapis.com/… ]  [＋ إضافة]

▤ المكتبة
  قائمة التنزيل   [⭳ فتح]
  ملاحظاتي        [✎ فتح]

◍ مصدر التنزيل
  عنوان المصدر  [ … ]  [حفظ]
  الفهرس        محدَّث  [التحقّق من التحديثات]

?  عن التطبيق
  …

△ منطقة الخطر
  حذف كل الكتب        [🗑 حذف]
  حذف الخطوط المضافة  [🗑 حذف]
```

**Icônes de section**, prises de `icons.js`, aucune à dessiner : `translate`,
`type`, `bank`, `globe`, `help`, `trash`. Chacune dans une pastille teintée en
tête de section — c'est le repère qui manque aujourd'hui.

**Groupes segmentés.** Les choix deviennent un cadre unique, sélection remplie
portant `check`, au lieu de trois `button--tonal` flottants qu'on ne lit pas
comme un ensemble. Un seul composant,
`src/renderer/js/components/segmented.js`, utilisé par la langue, le thème et
les deux polices. `themeChoices` reste le seul rendu des pastilles de thème et
s'appuie dessus.

**Icône + libellé** sur chaque action, jamais un mot seul.

**Aperçu dans la police elle-même** sous chaque liste — c'est le seul moyen de
choisir une face, et ça vaut d'abord pour celles ajoutées depuis Google Fonts,
dont on ne connaît que le nom.

**Zone de danger** : cadre teinté, **après** « عن التطبيق ». Rien de
destructif n'est plus atteignable en passant. Les deux actions gardent leur
`confirmDialog`.

Deuxième ligne de la zone : les polices ajoutées vivent dans `userData/fonts/`
et aucune réinstallation ne les nettoie — il faut un moyen de les reprendre.

## Tests

`test/fonts.test.js`

1. Aucune vue ne redéclare `FONTS` — grep sur `views/`.
2. Chaque clé de `FONTS` a son bloc `.reader--font-<key>` dans `views.css`, et
   réciproquement. C'est ce test qui aurait attrapé la police orpheline.
3. Chaque famille arabe a ses fichiers dans `assets/fonts/`.
4. `resolveFont('serif')` rend `amiri`, `resolveFont('sans')` rend `plex`,
   `resolveFont('vibes')` rend le défaut.
5. `fontsForScript('latn')` ne rend aucune famille arabe.

`test/font-installer.test.js` — sans réseau, sur feuilles servies localement

6. Une feuille dont un `src` pointe ailleurs que `fonts.gstatic.com` est
   refusée, et **rien n'est écrit sur disque**.
7. Une URL en `http`, ou vers un autre hôte, est refusée avant toute requête.
8. Une redirection vers un autre hôte est refusée.
9. Un fichier au-delà du plafond est refusé en cours de lecture.
10. Un nom de famille contenant `"`, `;`, `}` ou un saut de ligne ressort cité
    et inoffensif dans la règle `@font-face` produite.
11. Un chemin `userfont://` remontant hors de `userData/fonts/` est refusé.

`test/settings.test.js`

12. La zone de danger est le dernier bloc de l'écran.
13. Chaque action destructive passe par `confirmDialog`.

## Étapes

1. `shared/fonts.js` + tests, replis `serif`/`sans`, renommage des classes
   CSS. `reader.js` et `settings.js` importent la liste. **La police orpheline
   est réparée ici**, avant toute refonte.
2. Les trois familles latines dans `fetch_fonts.py`, régénération de
   `fonts.css`.
3. `components/segmented.js` + reprise de `themeChoices`.
4. Refonte de l'écran : sections, icônes, zone de danger, aperçus.
5. `font-installer.js`, schéma `userfont:`, migration `user_fonts`, CSP, les
   trois méthodes dans les deux listes.
6. Le champ d'ajout et la suppression des polices dans l'écran.
7. Passe `impeccable` sur l'écran fini.

## Ce qu'on ne fait pas

- **Pas de fichier de police local** (`.ttf` déposé depuis le disque) : Google
  Fonts couvre le besoin, et lire un fichier arbitraire du disque est une
  surface d'attaque distincte à traiter séparément.
- **Pas de catalogue Google Fonts intégré** — un champ d'URL, pas un
  navigateur de polices. L'appel réseau reste déclenché par un geste explicite.
- **Pas de graisses variables.** Les poids fixes des sous-ensembles suffisent,
  comme pour les six familles de base.
