# Les indicateurs du projet

Trois sources, aucune ligne ajoutée au HTML du site, aucun identifiant posé
chez qui que ce soit.

| Source | Ce qu'elle mesure | Où on la lit |
| --- | --- | --- |
| Cloudflare | la fréquentation du site, à l'edge | tableau de bord Cloudflare |
| API GitHub Releases | les téléchargements d'installeurs | `python tools/stats.py releases` |
| Journaux d'accès S3 | l'usage réel des applications installées | `python tools/stats.py bucket --days 30` |

## À lire d'abord : ce que rien de tout cela ne dit

**Rien ne suit une personne.** On ne sait pas si les deux cents démarrages
d'hier sont deux cents lecteurs ou vingt qui ont ouvert l'application dix fois.
On ne sait pas si celui qui a téléchargé l'installeur l'a installé. On ne sait
pas quel livre un lecteur donné ouvre, ni combien de temps il lit.

C'est le prix assumé de ne poser aucun identifiant, aucun cookie, aucun
traqueur. Un indicateur dont on oublie la limite finit par être lu comme s'il
n'en avait pas : chaque section ci-dessous dit donc aussi ce qu'elle ignore.

Conséquence pratique : **les chiffres se lisent en tendance, pas en absolu.**
Un doublement d'une semaine à l'autre est un signal ; « 412 » n'est pas une
population.

---

## Diffusion — combien de gens essaient

`python tools/stats.py releases`

| Indicateur | Comment | Ce qu'il ne dit pas |
| --- | --- | --- |
| **Téléchargements cumulés**, par plateforme | somme des `download_count` | Ni installations, ni lancements. Un téléchargement interrompu compte. |
| **Part de la dernière version** dans le total | rapport affiché en fin de rapport | Une part basse peut être une version trop récente autant que d'anciens liens qui traînent. |
| **Répartition Windows / Linux / Android** | par extension de l'artefact | Rien sur les versions de système. |

Les fichiers du mécanisme de mise à jour (`latest.yml`, `.blockmap`) sont
écartés du décompte : personne ne les télécharge à la main, et les compter
ferait passer le trafic de mise à jour pour une adoption.

**Le seuil qui compte** : la part de la dernière version un mois après sa
publication. En dessous de la moitié, les gens tombent sur d'anciens liens —
c'est un problème de site, pas de produit.

## Site — qui trouve le projet, et par où

Tableau de bord Cloudflare, *Analytics & Logs*. Mesuré à l'edge : aucun script
dans la page, aucun cookie, aucun bandeau de consentement.

| Indicateur | Où | Pourquoi il compte |
| --- | --- | --- |
| Visiteurs uniques et pages vues par mois | *Traffic* | Le volume brut. |
| **Taux de conversion accueil → téléchargement** | pages vues `/…/download/` ÷ pages vues `/…/` | Le KPI produit du site : il mesure si la page d'accueil convainc. |
| **Taux de clic effectif** | Δ `download_count` sur la période ÷ pages vues `/download/` | Un écart avec le précédent dit que la page de téléchargement perd des gens — plateforme absente, avertissement SmartScreen, bouton peu clair. |
| Répartition ar / fr / en | les pages les plus vues, préfixées `/ar/`, `/fr/`, `/en/` | Décide où porte l'effort de traduction. |
| Pays et référents | *Traffic* | Dit d'où vient l'audience, donc où parler du projet. |

Le « visiteur unique » de Cloudflare est une estimation sans cookie, fondée sur
l'adresse et l'agent : deux personnes derrière la même sortie réseau peuvent
n'en faire qu'une, et une personne sur deux appareils en fait deux.

## Usage réel — le seul qui dise si le produit sert

`python tools/stats.py bucket --days 30`

Chaque lancement d'application lit `catalog/latest.json` pour savoir si le
catalogue a bougé. Compter ces requêtes donne un nombre de **démarrages**.

| Indicateur | Comment | Ce qu'il ne dit pas |
| --- | --- | --- |
| **Démarrages par jour** | colonne `démarrages` | Pas un nombre de personnes. Une application ouverte trois fois compte trois. |
| **Taux de survie** | démarrages du mois ÷ installeurs téléchargés depuis le début | Le chiffre qui distingue la curiosité de l'usage. Grossier — il compare un flux à un cumul — mais sa **tendance** est juste. |
| **Adhésion aux mises à jour de catalogue** | `catalogues` ÷ `démarrages` | Un rapport durablement bas dit que la bande de proposition est ignorée ou refusée. |
| **Livres téléchargés**, et lesquels | colonne `livres` + le classement | Ce que les gens ouvrent vraiment. Un livre téléchargé n'est pas un livre lu. |

Un 404 ne compte pas comme un téléchargement : il apparaît en `erreurs`, où il
est un défaut à corriger.

## Coût et santé

| Indicateur | Où | Seuil |
| --- | --- | --- |
| Octets servis par mois depuis le bucket | colonne `Mo servis` | Le seul poste de facture qui grandit avec le succès. Un livre pèse ~30 Mo. |
| Taux d'erreurs du bucket | colonne `erreurs` | Toute erreur durable est un livre qu'un lecteur n'a pas eu. |
| Taux de cache et statuts HTTP du site | Cloudflare | Un site statique doit être servi depuis le cache presque tout le temps. |

## Ce qui n'est pas mesuré, volontairement

- **Rien dans l'application.** Aucune télémétrie, aucun événement, aucun
  identifiant d'installation. Ce qu'on sait de l'usage vient d'une requête que
  l'application faisait déjà pour son propre compte.
- **Aucun compteur public sur le site.** Un chiffre bas dessert un projet
  jeune, et le site ne se reconstruit qu'aux publications : un compteur affiché
  serait figé à la date du build, donc faux la plupart du temps.
- **Aucune adresse IP conservée ni affichée.** Les journaux S3 en portent ;
  leur bucket est privé et les expire à 30 jours, et `parse_log_line` les
  écarte à la lecture — l'outil ne peut pas en afficher une.

Design et décisions :
`docs/superpowers/specs/2026-08-04-domaine-et-mesure-design.md`.
