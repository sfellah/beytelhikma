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
  'site.tagline': 'La bibliothèque arabe, hors ligne',

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
  'home.shot.alt': "Écran d'accueil de Beyt El Hikma",
  'home.shot.reader.alt': 'Le lecteur, une page de livre ouverte',

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
  'download.other': 'Autres plateformes',
  'download.checksum': 'Empreinte SHA-512',
  'download.checksum.copy': 'Copier',
  'download.checksum.copied': 'Copié',
  'download.size': 'Taille',

  'platform.windows': 'Windows',
  'platform.linux': 'Linux',
  'platform.macos': 'macOS',
  'platform.unknown': 'votre système',

  'asset.installer': 'Programme d’installation',
  'asset.portable': 'Version portable',
  'asset.appimage': 'AppImage',
  'asset.deb': 'Paquet .deb',
  'asset.rpm': 'Paquet .rpm',
  'asset.archive': 'Archive',
  'asset.installer.hint': 'Installe l’application et crée un raccourci.',
  'asset.portable.hint': 'S’exécute sans installation. Ne se met pas à jour toute seule.',
  'asset.appimage.hint': 'Rendre exécutable, puis lancer. Se met à jour toute seule.',
  'asset.deb.hint': 'Debian, Ubuntu et dérivées. Mise à jour par le gestionnaire de paquets.',
  'asset.rpm.hint': 'Fedora, openSUSE et dérivées.',
  'asset.archive.hint': 'À décompresser à la main.',

  'specs.heading': 'Configuration requise',
  'specs.os': 'Système',
  'specs.os.value': 'Windows 10 ou 11 (64 bits) · Linux x86-64',
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

  'changelog.added': 'Nouveautés',
  'changelog.changed': 'Améliorations',
  'changelog.fixed': 'Corrections',
  'changelog.removed': 'Retraits',
  'changelog.security': 'Sécurité',

  'footer.source': 'Code source',
  'footer.issues': 'Signaler un problème',
  'footer.license': 'Publié sous licence AGPL-3.0',
  'footer.corpus': 'Corpus issu de la Bibliothèque Shamela',
  'footer.built': 'Version {version} du site',
};
