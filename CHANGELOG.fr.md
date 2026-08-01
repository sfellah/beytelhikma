# Journal des versions

> Ce fichier est la **source** des notes de version : la page `/releases` du
> site et le corps de la Release GitHub en sont tous deux dérivés. Les titres de
> rubrique sont des clés fixes — `added`, `changed`, `fixed`, `removed`,
> `security` — traduites à l'affichage. Toute version doit figurer dans les
> trois fichiers, avec la même date : le build échoue sinon.

## [0.3.0] — 2026-08-01

### added
- Première version publique, pour Windows et Linux.
- Catalogue de 8 568 éditions installé avec l'application : explorer, chercher et lire ne demandent aucune connexion.
- Téléchargement des livres reprenable, vérifié par empreinte SHA-256 avant installation.
- Lecteur à deux modes — page imprimée et fil continu — avec sommaire, recherche dans le livre et raccourcis clavier.
- Annotations : signets, quatre teintes de surlignage et notes, ancrées sur le texte et non sur un numéro de page.
- Trois ambiances — parchemin, blanc et nuit — appliquées à toute l'application.
- Interface en arabe et en anglais, avec choix de la police d'interface et de la police de lecture.
- Écrans d'exploration, de collections, de recherche transversale et de gestion des téléchargements.

### changed
- Le catalogue se met à jour depuis la source de distribution : la mise à jour est proposée, jamais imposée, et un refus est retenu version par version.
