# Domaine propre et mesure sans traqueur

**Date** : 2026-08-04
**État** : design validé

## Problème

Le site vit sous `https://sfellah.github.io/beytelhikma/`. Deux manques
distincts, qu'un même travail résout.

**Pas de domaine.** Le nom du projet est enterré dans le chemin d'un
sous-domaine qui appartient à quelqu'un d'autre. L'URL ne se dicte pas au
téléphone, ne se cite pas dans un document, et un déménagement d'hébergeur
casserait tous les liens jamais partagés. `beytelhikma.com` a été acheté.

**Aucune mesure.** On ne sait pas combien de fois les installeurs ont été
téléchargés, ni si quiconque visite le site, ni combien d'applications
installées sont encore vivantes. Une décision produit — vaut-il la peine de
signer l'APK ? faut-il traduire davantage ? — se prend aujourd'hui à l'aveugle.

## La contrainte qui décide de tout

`site/test/build.test.js` interdit **toute ressource tierce** dans le HTML
produit :

```js
assert.ok(
  link.startsWith('https://github.com/') || link.startsWith(SITE_ORIGIN),
  `ressource tierce : ${link}`,
);
```

Ce test existe parce que les maquettes d'origine tiraient Tailwind, Google
Fonts et Material Symbols d'un CDN. Il dit une propriété du produit, pas une
préférence de style : le site n'appelle personne, donc il n'a rien à déclarer,
rien à faire consentir, et rien à perdre le jour où un tiers ferme.

Un script d'analytics classique — Google Analytics, Plausible, Umami,
GoatCounter — casse ce test. Google le casse deux fois : cookies, identifiants
publicitaires, bandeau de consentement obligatoire, et l'utilisateur est suivi
d'un site à l'autre, ce que ce projet ne veut pas.

D'où la règle : **la mesure se fait côté serveur, jamais dans la page.** Aucune
ligne n'est ajoutée au HTML. Ce qui est mesuré, ce sont des requêtes, pas des
personnes.

## Trois sources, aucune nouvelle

| Question | Source | Coût |
| --- | --- | --- |
| Combien de visites, d'où, dans quelle langue | Cloudflare en proxy devant GitHub Pages, mesuré à l'edge | gratuit |
| Combien de fois chaque installeur est téléchargé | `download_count` de l'API GitHub Releases | gratuit |
| Combien d'applications installées sont vivantes | Journaux d'accès S3 : chaque démarrage fait un `GET catalog/latest.json` | quelques centimes par mois |

Les trois données existent déjà. La deuxième est même **déjà sur le disque du
runner** : `.github/workflows/site.yml` écrit la réponse brute de l'API dans
`site/data/releases.api.json`, et `site/lib/releases.mjs` jette le champ en
lisant l'artefact. Il n'y a rien à instrumenter, seulement à lire.

La troisième est une conséquence heureuse de l'architecture : `catalog-updater`
lit le pointeur au démarrage, sans identifiant ni cookie. Compter ces requêtes
donne un nombre de démarrages. Ce n'est pas un nombre de personnes, et le
document des indicateurs doit le dire.

## Ce qui n'est pas fait, et pourquoi

**Les compteurs ne sont pas affichés sur le site.** Deux raisons. Un chiffre bas
dessert un projet jeune — « 12 téléchargements » se lit comme un abandon. Et le
site ne se reconstruit qu'aux push et aux publications : un compteur affiché
serait figé à la date du build, donc faux la plupart du temps. Il vit dans
`tools/stats.py`, en console. La donnée reste disponible si l'on change d'avis.

**Pas de migration d'hébergement.** Cloudflare Pages remplacerait GitHub Pages
et donnerait les mêmes statistiques, mais `site.yml` marche, sa garde contre le
double producteur d'artefact est écrite et commentée, et rien ne justifie de
rejouer cela. Cloudflare se met **devant**, pas à la place.

**Pas de proxy Cloudflare devant le bucket de livres.** Cela donnerait les
statistiques de téléchargement de livres sans toucher à AWS. Mais les livres
pèsent des dizaines de mégaoctets pièce, ce que les conditions du plan gratuit
n'autorisent pas, et cela changerait `distribution.base_url`, donc l'origine
d'où tous les clients déjà installés tirent leurs fichiers. Les journaux S3
coûtent quelques centimes et ne déplacent rien.

## Le site bascule sur le domaine

Un seul module connaît l'hôte, et c'était déjà écrit dans son commentaire :

```js
export const BASE_PATH = '/';                            // était '/beytelhikma/'
export const SITE_ORIGIN = 'https://beytelhikma.com';    // était github.io
```

`url()` retire le `/` initial du chemin qu'on lui passe : `url('/assets/x')`
rend `/assets/x` et non `//assets/x`. `serve.mjs` cesse simplement de rediriger,
tout chemin commençant par `/`. Rien d'autre ne bouge — c'est ce que la règle
« un seul module connaît l'hôte » achetait.

**`dist/CNAME` est écrit par le build**, à côté de `.nojekyll`, et son contenu
est **dérivé de `SITE_ORIGIN`** (`new URL(SITE_ORIGIN).host`) et non réécrit en
dur. Deux littéraux qui disent le même hôte finissent par diverger : c'est la
panne du thème `sepia` et celle de la liste de polices, rejouée sur un nom de
domaine. Le fichier doit être dans l'artefact déployé : `actions/deploy-pages`
publie ce qu'on lui donne, et un artefact sans `CNAME` peut faire retomber le
dépôt sur son sous-domaine `github.io`, en silence.

Le test « aucun lien interne n'oublie le préfixe » devient trivialement vrai
avec un `BASE_PATH` à `/` — tout chemin absolu commence par `/`. Il est donc
doublé d'un test qui interdit le `//` initial, le seul piège que la bascule
introduit : `//assets/x` est un lien **protocol-relative**, que le navigateur
lit comme un hôte distant nommé `assets`.

## L'ordre d'allumage du DNS

C'est la seule partie fragile, et elle est fragile une fois.

GitHub Pages émet son certificat par un défi HTTP sur le domaine. **Proxy
Cloudflare allumé, le défi n'atteint jamais GitHub** : le certificat n'est pas
émis, le site répond en HTTPS cassé, et l'erreur ne nomme pas sa cause.

D'où la séquence, qui ne se devine pas :

1. Zone Cloudflare créée, serveurs de noms délégués chez le registrar.
2. Enregistrements posés **en nuage gris** (DNS only) : apex et `www` vers
   `sfellah.github.io`.
3. Domaine personnalisé déclaré côté GitHub, certificat émis, *Enforce HTTPS*
   coché.
4. **Alors seulement** : nuage orange, et mode SSL **Full (strict)**. Jamais
   *Flexible* — avec *Enforce HTTPS* côté GitHub, c'est une boucle de
   redirection.

GitHub redirige de lui-même l'ancienne URL vers la nouvelle : les liens déjà
partagés survivent, et le `README` peut être mis à jour sans urgence.

## Les journaux du bucket

`configure_bucket` de `tools/publish_minio.py` pose déjà toute la configuration
du bucket de distribution en une fois. Les journaux d'accès s'y ajoutent sur le
même patron `_try` — MinIO n'implémente pas `put_bucket_logging`, et un réglage
que le serveur refuse doit être signalé et sauté, jamais fatal.

Quatre gestes, dans cet ordre :

1. Le bucket de journaux est créé **privé et le reste** : blocage d'accès public
   à quatre `True`, `BucketOwnerEnforced`. Il contient des adresses IP ; le
   bucket de distribution est public par politique, celui-ci ne doit jamais
   l'être par accident.
2. Sa politique autorise `s3:PutObject` au principal `logging.s3.amazonaws.com`,
   **restreint par `aws:SourceArn` et `aws:SourceAccount`**. Sans ces
   conditions, le service de journalisation d'un autre compte pourrait y écrire.
3. Cycle de vie : expiration à 30 jours. Un journal gardé un an est un coût qui
   grimpe et un fichier d'adresses dont on n'a aucun usage.
4. `put_bucket_logging` sur le bucket de distribution, préfixe `access/`.

`tools/stats.py` lit ces journaux. **`parse_log_line` écarte l'adresse IP à la
lecture** : l'outil ne peut donc en afficher aucune, même par erreur. C'est une
fonction pure, testée sans réseau ni AWS, et une ligne malformée rend `None`
sans lever — un format de journal qui évolue ne doit pas faire tomber l'outil.

## Ce que la mesure ne dira jamais

Rien ne suit une personne. On ne sait pas si les deux cents démarrages d'hier
sont deux cents lecteurs ou vingt. On ne sait pas si celui qui a téléchargé
l'installeur l'a installé. On ne sait pas quel livre un lecteur donné ouvre.

C'est le prix assumé de ne poser aucun identifiant, et il doit être écrit en
tête de `docs/KPI.md` : un indicateur dont on a oublié la limite finit par être
lu comme s'il n'en avait pas.
