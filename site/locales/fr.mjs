/**
 * Les mots du site en français. Les clés sont identiques dans les trois
 * fichiers — `test/locales.test.js` le vérifie, comme le fait déjà
 * `no-hardcoded-strings.test.js` côté application.
 *
 * Ce catalogue est distinct de celui de l'application : un site de
 * présentation et une interface de lecture ne disent pas les mêmes choses, et
 * les mélanger obligerait à traduire des libellés d'écran pour rien.
 */
export default {
  'site.name': 'Beyt El Hikma',

  'format.size': '{value} Mo',

  'nav.home': 'Accueil',
  'nav.download': 'Télécharger',
  'nav.releases': 'Versions',
  'nav.source': 'Code source',
  'nav.language': 'Langue',
  'nav.skip': 'Aller au contenu',

  'home.title': 'Beyt El Hikma — la bibliothèque arabe, hors ligne',
  'home.description':
    'Application de bureau libre pour lire {books} livres du patrimoine arabe. '
    + 'Catalogue local, lecture hors ligne, annotations. Windows et Linux.',
  'home.badge': 'Version {version} disponible',
  'home.badge.none': 'Première version en préparation',
  'home.heading': 'Lire le patrimoine,',
  'home.heading.accent': 'sans rien demander à personne',
  'home.lede':
    'Une bibliothèque de {books} ouvrages qui vit sur votre machine. Pas de compte, '
    + 'pas de serveur, pas de suivi. Vous téléchargez un livre une fois, il est à vous.',
  'home.cta.primary': 'Télécharger pour {platform}',
  'home.cta.secondary': 'Voir les versions',
  'home.cta.pending': 'Bientôt disponible',
  'home.platforms': 'Disponible pour',

  'plate.home': 'L’accueil : disciplines, siècles, reprise de lecture.',
  'plate.reader': 'Le lecteur, une page posée.',
  'plate.night': 'La même page, ambiance nuit.',
  'plate.explore': 'L’exploration du catalogue, par discipline et par époque.',

  'features.heading': "Ce qu'elle fait",
  'features.lede':
    'Quatre choix de conception, tenus jusqu’au bout — c’est ce qui la distingue '
    + 'd’un lecteur de PDF de plus.',

  'features.offline.title': 'Tout est local',
  'features.offline.body':
    'Le catalogue est installé avec l’application : explorer, chercher et lire ne '
    + 'demandent aucune connexion. Seul le téléchargement d’un livre en réclame une.',
  'features.corpus.title': '{books} livres',
  'features.corpus.body':
    'Le corpus Shamela converti en bases SQLite, indexé et cherchable, réparti sur une '
    + 'quarantaine de disciplines, du 1ᵉʳ siècle de l’hégire à aujourd’hui.',
  'features.reading.title': 'Deux modes de lecture',
  'features.reading.body':
    'Page imprimée ou fil continu, trois ambiances, quatre teintes de surlignage, '
    + 'notes et signets ancrés sur le texte — pas sur un numéro de page.',
  'features.arabic.title': 'Écrit pour l’arabe',
  'features.arabic.body':
    'Interface RTL native, polices naskh embarquées, recherche qui ignore les '
    + 'diacritiques et les variantes de hamza. Interface disponible en arabe et en anglais.',

  'trust.free': 'Libre et gratuit',
  'trust.free.detail': 'Licence AGPL-3.0',
  'trust.private': 'Aucun suivi',
  'trust.private.detail': 'Ni compte, ni télémétrie',
  'trust.offline': 'Hors ligne',
  'trust.offline.detail': 'Vos livres restent chez vous',

  'download.title': 'Télécharger Beyt El Hikma',
  'download.description':
    'Installeurs Windows et Linux pour la version {version}. Gratuit, sans compte.',
  'download.heading': 'Télécharger',
  'download.lede': 'Version {version}, publiée le {date}.',
  'download.lede.none': 'Aucune version publiée pour l’instant.',
  'download.empty':
    'La première version est en préparation. Le code est déjà là — suivez le dépôt '
    + 'pour être prévenu.',
  'download.recommended': 'Recommandé pour votre système',
  'download.checksum': 'Empreinte SHA-512',

  'platform.windows': 'Windows',
  'platform.linux': 'Linux',
  'platform.android': 'Android',
  'platform.macos': 'macOS',
  'platform.unknown': 'votre système',
  'platform.pending': 'Pas encore publié : la dernière version ne porte aucun fichier pour ce système.',
  'platform.soon': 'bientôt',

  'asset.installer': 'Programme d’installation',
  'asset.portable': 'Version portable',
  'asset.appimage': 'AppImage',
  'asset.deb': 'Paquet .deb',
  'asset.rpm': 'Paquet .rpm',
  'asset.apk': 'Paquet APK',
  'asset.archive': 'Archive',
  'asset.installer.hint': 'Installe l’application et crée un raccourci.',
  'asset.portable.hint': 'S’exécute sans installation. Ne se met pas à jour toute seule.',
  'asset.appimage.hint': 'Rendre exécutable, puis lancer. Se met à jour toute seule.',
  'asset.deb.hint': 'Debian, Ubuntu et dérivées. Mise à jour par le gestionnaire de paquets.',
  'asset.rpm.hint': 'Fedora, openSUSE et dérivées.',
  'asset.apk.hint':
    'S’installe depuis le fichier, sans boutique. Ne se met pas à jour toute seule.',
  'asset.archive.hint': 'À décompresser à la main.',

  'specs.heading': 'Configuration requise',
  'specs.os': 'Système',
  'specs.os.value': 'Windows 10 ou 11 (64 bits) · Linux x86-64 · Android 7.0 ou plus récent',
  'specs.ram': 'Mémoire',
  'specs.ram.value': '4 Go minimum, 8 Go conseillés',
  'specs.disk': 'Disque',
  'specs.disk.value': '400 Mo pour l’application, plus la place des livres téléchargés',
  'specs.net': 'Réseau',
  'specs.net.value': 'Requis pour télécharger un livre, jamais pour en lire un',

  'smartscreen.heading': 'Windows affiche un avertissement',
  'smartscreen.body':
    'L’installeur n’est pas signé par un certificat commercial. Windows affiche '
    + '« Windows a protégé votre ordinateur ». Cliquez sur « Informations complémentaires », '
    + 'puis sur « Exécuter quand même ». Vérifiez l’empreinte SHA-512 ci-dessus si vous '
    + 'voulez la certitude que le fichier est bien celui publié ici.',

  'apk.unsigned.heading': 'L’APK n’est pas signé',
  'apk.unsigned.body':
    'Il porte la clé de débogage d’Android, pas un certificat d’éditeur. À l’installation, '
    + 'Android annonce donc une source inconnue et demande l’autorisation d’installer depuis '
    + 'ce fichier ; Play Protect peut la bloquer, et propose alors « Installer quand même ». '
    + 'Le jour où une clé de publication existera, il faudra désinstaller avant de mettre à '
    + 'jour : Android refuse de remplacer une application par une autre signature.',

  'releases.title': 'Versions de Beyt El Hikma',
  'releases.description': 'Notes de version, du plus récent au plus ancien.',
  'releases.heading': 'Versions',
  'releases.lede': 'Ce qui a changé, version après version.',
  'releases.latest': 'Dernière',
  'releases.prerelease': 'Préversion',
  'releases.published': 'Publiée le {date}',
  'releases.download': 'Télécharger cette version',
  'releases.empty': 'Aucune version publiée pour l’instant.',
  'releases.notes.empty': 'Aucune note pour cette version.',

  'privacy.title': 'Politique de confidentialité — Beyt El Hikma',
  'privacy.description':
    'Ce que Beyt El Hikma sait de vous : rien. Pas de compte, pas de télémétrie, '
    + 'pas de publicité. Le détail, ligne à ligne.',
  'privacy.heading': 'Politique de confidentialité',
  'privacy.lede':
    'Elle vaut pour l’application Beyt El Hikma — bureau et Android — et pour ce site. '
    + 'Elle est écrite depuis ce que le code fait, et le code est public : chaque '
    + 'affirmation ci-dessous se vérifie dans le dépôt.',
  'privacy.updated': 'En vigueur depuis le {date}',

  'privacy.summary.title': 'En bref',
  'privacy.summary.account': 'Aucun compte. L’application ne vous demande jamais qui vous êtes.',
  'privacy.summary.telemetry':
    'Aucune télémétrie, aucun mouchard, aucun outil de mesure d’audience dans l’application.',
  'privacy.summary.ads': 'Aucune publicité, et aucun identifiant publicitaire n’est lu.',
  'privacy.summary.sale': 'Rien n’est vendu, loué ni transmis à un tiers. Il n’y a rien à vendre.',

  'privacy.device.title': 'Ce qui reste sur votre appareil',
  'privacy.device.body':
    'Tout ce que vous produisez en lisant vit dans une base de données locale, sur votre '
    + 'appareil, et n’est jamais transmis nulle part :',
  'privacy.device.library': 'les livres que vous avez installés, et leur date d’installation ;',
  'privacy.device.progress': 'votre progression de lecture, page et position dans la page ;',
  'privacy.device.annotations': 'vos signets, surlignages et notes, avec le texte qu’ils ancrent ;',
  'privacy.device.settings':
    'vos réglages — langue, thème, police, taille du texte, mode de lecture.',

  'privacy.network.title': 'Ce que l’application demande au réseau',
  'privacy.network.body':
    'L’application n’a besoin du réseau que pour trois choses. Chacune est une requête '
    + 'HTTPS anonyme vers notre serveur de distribution, sans compte, sans cookie et sans '
    + 'identifiant :',
  'privacy.network.pointer':
    'au démarrage, un petit fichier qui dit quelle version du catalogue est publiée ;',
  'privacy.network.catalog': 'le catalogue lui-même, quand une version plus récente existe ;',
  'privacy.network.books': 'le fichier d’un livre, quand vous demandez à le télécharger.',
  'privacy.network.anonymous':
    'Explorer, chercher et lire ne demandent aucune connexion : le catalogue est installé '
    + 'avec l’application, et un livre téléchargé vous appartient.',

  'privacy.logs.title': 'Ce que le serveur enregistre',
  'privacy.logs.body':
    'Comme tout serveur web, celui qui distribue le catalogue et les livres journalise les '
    + 'requêtes qu’il reçoit. Ces journaux sont privés et personne d’autre n’y accède :',
  'privacy.logs.fields':
    'ce qu’ils contiennent : la date, le fichier demandé, sa taille, le code de réponse, et '
    + 'l’adresse IP de la requête ;',
  'privacy.logs.retention': 'ils sont effacés automatiquement au bout de 30 jours ;',
  'privacy.logs.purpose':
    'ils servent uniquement à compter le volume d’usage — combien de fois un livre a été '
    + 'téléchargé — et l’outil qui les lit écarte l’adresse IP dès la lecture ;',
  'privacy.logs.never':
    'ils ne sont jamais recoupés avec autre chose, jamais associés à une personne, jamais '
    + 'transmis à un tiers.',

  'privacy.fonts.title': 'Les polices que vous ajoutez',
  'privacy.fonts.body':
    'L’application est livrée avec ses six polices : elle n’en télécharge aucune d’elle-même. '
    + 'Si vous choisissez d’ajouter une police depuis Google Fonts, et à ce moment seulement, '
    + 'l’application contacte fonts.googleapis.com puis fonts.gstatic.com — Google voit alors '
    + 'cette requête, et donc votre adresse IP. Le fichier est enregistré une fois, et '
    + 'l’application ne revient jamais le chercher.',

  'privacy.permissions.title': 'Autorisations Android',
  'privacy.permissions.body':
    'L’application ne demande qu’une seule autorisation : l’accès à Internet, pour les trois '
    + 'requêtes ci-dessus. Ni localisation, ni contacts, ni appareil photo, ni microphone, ni '
    + 'accès à vos fichiers, ni identifiant publicitaire.',

  'privacy.store.title': 'La boutique qui vous a livré l’application',
  'privacy.store.body':
    'Si vous l’avez installée depuis Google Play, Google enregistre l’installation et peut '
    + 'recevoir des rapports de plantage selon les réglages de votre appareil. Cela relève de '
    + 'la politique de confidentialité de Google, pas de la nôtre : nous ne recevons de sa part '
    + 'que des statistiques agrégées, où personne n’est identifiable.',

  'privacy.children.title': 'Les enfants',
  'privacy.children.body':
    'L’application n’est pas destinée aux enfants de moins de 13 ans et ne leur demande rien. '
    + 'Elle ne collecte sciemment aucune donnée les concernant — puisqu’elle n’en collecte '
    + 'sur personne.',

  'privacy.rights.title': 'Vos données, et comment les effacer',
  'privacy.rights.body':
    'Nous ne détenons aucune donnée qui vous désigne : il n’y a donc rien à demander, à '
    + 'corriger ni à exporter. Vos annotations, votre progression et vos livres sont sur votre '
    + 'appareil ; désinstaller l’application les efface tous. Les journaux du serveur '
    + 'disparaissent d’eux-mêmes au bout de 30 jours.',

  'privacy.changes.title': 'Si cette politique change',
  'privacy.changes.body':
    'La date en vigueur en haut de cette page est modifiée à chaque révision, et l’historique '
    + 'complet des versions de ce texte est public dans le dépôt. Un changement qui étendrait '
    + 'ce que l’application envoie serait annoncé dans les notes de version.',

  'privacy.contact.title': 'Nous écrire',
  'privacy.contact.body':
    'Une question sur ce texte, ou sur ce que l’application fait de vos données :',
  'privacy.contact.issues': 'Poser la question en public',

  'changelog.added': 'Nouveautés',
  'changelog.changed': 'Améliorations',
  'changelog.fixed': 'Corrections',
  'changelog.removed': 'Retraits',
  'changelog.security': 'Sécurité',

  'footer.issues': 'Signaler un problème',
  'footer.privacy': 'Confidentialité',
  'footer.license': 'Publié sous licence AGPL-3.0',
  'footer.corpus': 'Corpus issu de la Bibliothèque Shamela',
  'footer.built': 'Version {version} du site',
  'colophon.heading': 'Colophon',
  'colophon.typefaces': 'Composé en EB Garamond, Literata et IBM Plex Sans Arabic, toutes embarquées.',
};
