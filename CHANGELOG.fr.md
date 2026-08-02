# Journal des versions

> Ce fichier est la **source** des notes de version : la page `/releases` du
> site et le corps de la Release GitHub en sont tous deux dérivés. Les titres de
> rubrique sont des clés fixes — `added`, `changed`, `fixed`, `removed`,
> `security` — traduites à l'affichage. Toute version doit figurer dans les
> trois fichiers, avec la même date : le build échoue sinon.

## [0.4.1] — 2026-08-03

### added
- Pincer la page à deux doigts agrandit ou réduit le texte du livre : les lignes se replient au lieu de déborder de l'écran, et la taille obtenue est celle des réglages.
- Les côtés de la page, qui la tournent au toucher, peuvent être éteints depuis les réglages : la main qui tient l'appareil frôle le bord, et c'est le seul geste du lecteur qu'on déclenche sans le vouloir. Le glissement, les chevrons et les flèches tournent toujours.

### changed
- Le bouton de téléchargement de l'accueil mène désormais droit au fichier qui convient au visiteur — l'APK sur un téléphone Android, l'installeur sur Windows — au lieu d'annoncer Windows à tout le monde.

## [0.4.0] — 2026-08-02

### added
- Tourner une page se fait maintenant de trois façons : toucher le tiers de l'écran où la ligne commence pour revenir en arrière, celui où elle finit pour avancer, et au doigt ou au stylet, glisser dans le sens où le texte s'écoule.
- L'application Android embarque désormais le catalogue de livres dans l'APK et propose sa mise à jour au démarrage — le premier lancement ne demande plus de câble.
- Android prend sa place sur la page de téléchargement et sur l'accueil, aux côtés de Windows et Linux, avec un avertissement : l'APK porte une signature de débogage tant qu'aucune clé d'éditeur n'existe.

### removed
- Le mode de lecture en fil continu disparaît : le corpus est paginé de bout en bout — pied imprimé, fraction du ruban, ancrage des annotations, lien `?page=` — et un fil oblige à abandonner ces repères un à un. La lecture ne garde qu'un mode : la page imprimée.

## [0.3.1] — 2026-08-01

### fixed
- Sous interface anglaise, le lecteur pointait à l'envers : le bouton de sortie et les deux chevrons de pagination désignaient le contraire de ce qu'ils faisaient. Ils suivent maintenant la direction de l'interface.
- La jauge de lecture se remplissait par le mauvais bord en anglais : la poignée avançait à droite, la couleur montait par la gauche.
- Les flèches du clavier feuilletaient à contresens en anglais, et la fiche des raccourcis annonçait la mauvaise touche.
- Le texte des livres porte désormais sa direction : une page arabe reste écrite de droite à gauche même sous interface anglaise, avec sa justification, ses titres de chapitre, son sommaire et ses résultats de recherche.
- L'animation de tournage de page et le chevron du sommaire d'une fiche livre s'orientaient d'après l'arabe seul.

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
