# Journal des versions

> Ce fichier est la **source** des notes de version : la page `/releases` du
> site et le corps de la Release GitHub en sont tous deux dérivés. Les titres de
> rubrique sont des clés fixes — `added`, `changed`, `fixed`, `removed`,
> `security` — traduites à l'affichage. Toute version doit figurer dans les
> trois fichiers, avec la même date : le build échoue sinon.

## [0.5.1] — 2026-08-03

### added
- Les réglages se terminent par la version de l'application, la plateforme et le moteur, à côté de ce que porte la bibliothèque. Ce sont les trois premières lignes de tout rapport de bug.
- La table des téléchargements dit d'un coup d'œil si l'on a déjà un livre : une marque à l'entrée de la ligne, et une pastille qui porte un dessin autant que son mot — un crochet pour présent, un tiret pour absent. L'absence a sa propre teinte au lieu de la pastille neutre, qui se lisait comme « on ne sait pas ».

### changed
- Les barres d'action par lot flottent au-dessus de l'écran au lieu de défiler avec la page : on coche un livre au quarantième rang et les actions sont toujours sous le pouce. Cela vaut pour la table des téléchargements et pour la composition d'une collection, où « Terminé » vivait dans l'entête.

### fixed
- L'application Android annonçait la version « 1.0 (1) » — le gabarit écrit une fois par l'outillage de build, que personne ne mettait à jour puisque le projet natif est réengendré. La version vient maintenant du projet lui-même, et les deux applications portent le même numéro.

## [0.5.0] — 2026-08-03

### added
- La lecture en fil revient, à côté de la page : les pages s'enchaînent dans une seule colonne et l'on passe de l'une à l'autre en défilant. Le choix se fait une fois, dans les réglages, et vaut pour tous les livres. Le fil ne monte qu'une fenêtre de pages autour de celle qu'on lit — les plus gros titres du corpus passent le millier de pages.
- Les appels de note se touchent et mènent à la note, qu'ils soient balisés ou écrits en clair au fil du paragraphe. Un nombre n'est marqué que si une note lui répond : « (3) » est aussi bien un numéro de verset.
- Rouvrir un livre ramène à l'endroit exact où l'on s'était arrêté, et non en haut de la page. Sur un téléphone, une page du corpus fait couramment trois à six écrans.
- Un livre très gros le dit avant de faire attendre, au lieu de laisser tourner un rouet sans un mot.
- Ouvrir un chapitre depuis le sommaire, un résultat de recherche ou une annotation laisse une pastille pour revenir où l'on lisait.
- Sur Android, le geste retour ferme une couche à la fois — la note, la sélection, le panneau, le plein écran — au lieu de quitter le livre d'un coup.
- L'application Android a son icône et son écran de démarrage : le symbole sur fond crème, qui grandit et paraît.

### changed
- Le sommaire s'ouvre sur le chapitre qu'on lit, et non au début du livre ; il arrive après la première page au lieu de la faire attendre, et se cherche par son titre.
- La jauge de lecture annonce sa destination pendant qu'on la glisse et n'y va qu'au relâchement : elle chargeait jusque-là une page par cran.
- Les téléchargements gardent à l'écran ce qu'ils viennent d'installer, au lieu de le voir disparaître de la file.
- L'accueil resserre sa densité : le compte de livres installés et le lien vers toute la bibliothèque partagent une ligne, qui poussait sinon les cursus sous la ligne de flottaison.

### fixed
- Écrire une note sur un passage ne le teinte plus avant qu'on ait validé : « Annuler » laissait un surlignage orphelin, sans rien à l'écran pour le dire.

### removed
- Le réglage qui dressait le ruban de pagination contre le bord de l'écran. Il annonçait « horizontal / vertical » à une ligne de la façon de lire, qui dit la même chose d'autre chose : on croyait choisir sa lecture et l'on déplaçait la barre.

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
