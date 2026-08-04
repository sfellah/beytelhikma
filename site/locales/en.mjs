/** The English site strings. Keys mirror `fr.mjs` exactly — a test enforces it. */
export default {
  'site.name': 'Beyt El Hikma',

  'format.size': '{value} MB',

  'nav.home': 'Home',
  'nav.download': 'Download',
  'nav.releases': 'Releases',
  'nav.source': 'Source code',
  'nav.language': 'Language',
  'nav.skip': 'Skip to content',

  'home.title': 'Beyt El Hikma — the Arabic library, offline',
  'home.description':
    'Free desktop application for reading {books} books of the Arabic heritage. '
    + 'Local catalogue, offline reading, annotations. Windows and Linux.',
  'home.badge': 'Version {version} available',
  'home.badge.none': 'First release in preparation',
  'home.heading': 'Read the heritage,',
  'home.heading.accent': 'asking no one for permission',
  'home.lede':
    'A library of {books} works that lives on your machine. No account, no server, '
    + 'no tracking. Download a book once and it is yours.',
  'home.cta.primary': 'Download for {platform}',
  'home.cta.secondary': 'See releases',
  'home.cta.pending': 'Coming soon',
  'home.platforms': 'Available for',

  'plate.home': 'The home screen: disciplines, centuries, where you left off.',
  'plate.reader': 'The reader, a page set.',
  'plate.night': 'The same page, night mood.',
  'plate.explore': 'Browsing the catalogue by discipline and by era.',

  'features.heading': 'What it does',
  'features.lede':
    'Four design choices, carried through — that is what sets it apart from one more PDF reader.',

  'features.offline.title': 'Everything is local',
  'features.offline.body':
    'The catalogue ships with the application: browsing, searching and reading need no '
    + 'connection. Only downloading a book does.',
  'features.corpus.title': '{books} books',
  'features.corpus.body':
    'The Shamela corpus converted to SQLite, indexed and searchable, across some forty '
    + 'disciplines, from the 1st century AH to the present.',
  'features.reading.title': 'Two reading modes',
  'features.reading.body':
    'Printed page or continuous scroll, three moods, four highlight tints, notes and '
    + 'bookmarks anchored to the text — not to a page number.',
  'features.arabic.title': 'Built for Arabic',
  'features.arabic.body':
    'Native RTL interface, embedded naskh fonts, search that ignores diacritics and hamza '
    + 'variants. Interface available in Arabic and English.',

  'trust.free': 'Free and open',
  'trust.free.detail': 'AGPL-3.0 licensed',
  'trust.private': 'No tracking',
  'trust.private.detail': 'No account, no telemetry',
  'trust.offline': 'Offline',
  'trust.offline.detail': 'Your books stay with you',

  'download.title': 'Download Beyt El Hikma',
  'download.description': 'Windows and Linux installers for version {version}. Free, no account.',
  'download.heading': 'Download',
  'download.lede': 'Version {version}, released on {date}.',
  'download.lede.none': 'No release published yet.',
  'download.empty':
    'The first release is in preparation. The code is already there — watch the repository '
    + 'to be notified.',
  'download.recommended': 'Recommended for your system',
  'download.checksum': 'SHA-512 checksum',

  'platform.windows': 'Windows',
  'platform.linux': 'Linux',
  'platform.android': 'Android',
  'platform.macos': 'macOS',
  'platform.unknown': 'your system',
  'platform.pending': 'Not published yet: the latest release carries no file for this system.',
  'platform.soon': 'soon',

  'asset.installer': 'Installer',
  'asset.portable': 'Portable build',
  'asset.appimage': 'AppImage',
  'asset.deb': '.deb package',
  'asset.rpm': '.rpm package',
  'asset.apk': 'APK package',
  'asset.archive': 'Archive',
  'asset.installer.hint': 'Installs the application and creates a shortcut.',
  'asset.portable.hint': 'Runs without installing. Does not update itself.',
  'asset.appimage.hint': 'Make it executable, then run. Updates itself.',
  'asset.deb.hint': 'Debian, Ubuntu and derivatives. Updated by the package manager.',
  'asset.rpm.hint': 'Fedora, openSUSE and derivatives.',
  'asset.apk.hint': 'Installs from the file, without a store. Does not update itself.',
  'asset.archive.hint': 'Unpack it yourself.',

  'specs.heading': 'System requirements',
  'specs.os': 'System',
  'specs.os.value': 'Windows 10 or 11 (64-bit) · Linux x86-64 · Android 7.0 or later',
  'specs.ram': 'Memory',
  'specs.ram.value': '4 GB minimum, 8 GB recommended',
  'specs.disk': 'Disk',
  'specs.disk.value': '400 MB for the application, plus room for downloaded books',
  'specs.net': 'Network',
  'specs.net.value': 'Needed to download a book, never to read one',

  'smartscreen.heading': 'Windows shows a warning',
  'smartscreen.body':
    'The installer is not signed with a commercial certificate. Windows will show '
    + '“Windows protected your PC”. Click “More info”, then “Run anyway”. Check the SHA-512 '
    + 'checksum above if you want certainty that the file is the one published here.',

  'apk.unsigned.heading': 'The APK is not signed',
  'apk.unsigned.body':
    'It carries the Android debug key, not a publisher certificate. Android will therefore '
    + 'report an unknown source and ask you to allow installing from this file; Play Protect '
    + 'may block it, offering “Install anyway”. Once a publishing key exists you will have to '
    + 'uninstall before updating: Android refuses to replace an app with a different signature.',

  'releases.title': 'Beyt El Hikma releases',
  'releases.description': 'Release notes, newest first.',
  'releases.heading': 'Releases',
  'releases.lede': 'What changed, version after version.',
  'releases.latest': 'Latest',
  'releases.prerelease': 'Pre-release',
  'releases.published': 'Released on {date}',
  'releases.download': 'Download this version',
  'releases.empty': 'No release published yet.',
  'releases.notes.empty': 'No notes for this version.',

  'privacy.title': 'Privacy Policy — Beyt El Hikma',
  'privacy.description':
    'What Beyt El Hikma knows about you: nothing. No account, no telemetry, no ads. '
    + 'Here is the detail, line by line.',
  'privacy.heading': 'Privacy Policy',
  'privacy.lede':
    'This policy covers the Beyt El Hikma application — desktop and Android — and this '
    + 'website. It is written from what the code does, and the code is public: every claim '
    + 'below can be checked in the repository.',
  'privacy.updated': 'In effect since {date}',

  'privacy.summary.title': 'In short',
  'privacy.summary.account': 'No account. The app never asks who you are.',
  'privacy.summary.telemetry': 'No telemetry, no trackers, no analytics inside the app.',
  'privacy.summary.ads': 'No advertising, and no advertising identifier is read.',
  'privacy.summary.sale': 'Nothing is sold, rented or shared. There is nothing to sell.',

  'privacy.device.title': 'What stays on your device',
  'privacy.device.body':
    'Everything you produce while reading lives in a local database on your device, and is '
    + 'never transmitted anywhere:',
  'privacy.device.library': 'the books you have installed, and when you installed them;',
  'privacy.device.progress': 'your reading progress, page and position within the page;',
  'privacy.device.annotations':
    'your bookmarks, highlights and notes, with the text they are anchored to;',
  'privacy.device.settings':
    'your settings — language, theme, typeface, text size, reading mode.',

  'privacy.network.title': 'What the app asks of the network',
  'privacy.network.body':
    'The app needs the network for three things only. Each is an anonymous HTTPS request to '
    + 'our distribution server, with no account, no cookie and no identifier:',
  'privacy.network.pointer':
    'at startup, a small file stating which catalogue version is published;',
  'privacy.network.catalog': 'the catalogue itself, when a newer version exists;',
  'privacy.network.books': 'a book file, when you ask to download it.',
  'privacy.network.anonymous':
    'Browsing, searching and reading need no connection at all: the catalogue ships with the '
    + 'app, and a downloaded book is yours.',

  'privacy.logs.title': 'What the server records',
  'privacy.logs.body':
    'Like any web server, the one distributing the catalogue and the books logs the requests '
    + 'it receives. Those logs are private and no one else has access to them:',
  'privacy.logs.fields':
    'what they contain: the date, the file requested, its size, the response code, and the '
    + 'IP address of the request;',
  'privacy.logs.retention': 'they are deleted automatically after 30 days;',
  'privacy.logs.purpose':
    'they serve only to count usage volume — how often a book was downloaded — and the tool '
    + 'that reads them discards the IP address as it reads;',
  'privacy.logs.never':
    'they are never cross-referenced with anything else, never tied to a person, never shared '
    + 'with a third party.',

  'privacy.fonts.title': 'Fonts you add yourself',
  'privacy.fonts.body':
    'The app ships with its six typefaces and downloads none on its own. If you choose to add '
    + 'a typeface from Google Fonts, and only then, the app contacts fonts.googleapis.com and '
    + 'fonts.gstatic.com — Google sees that request, and therefore your IP address. The file '
    + 'is stored once, and the app never goes back for it.',

  'privacy.permissions.title': 'Android permissions',
  'privacy.permissions.body':
    'The app requests a single permission: internet access, for the three requests above. No '
    + 'location, no contacts, no camera, no microphone, no access to your files, no '
    + 'advertising identifier.',

  'privacy.store.title': 'The store that delivered the app',
  'privacy.store.body':
    'If you installed it from Google Play, Google records the installation and may receive '
    + 'crash reports depending on your device settings. That falls under Google’s privacy '
    + 'policy, not ours: all we receive from them is aggregate statistics, in which no one is '
    + 'identifiable.',

  'privacy.children.title': 'Children',
  'privacy.children.body':
    'The app is not directed at children under 13 and asks them for nothing. It knowingly '
    + 'collects no data about them — since it collects none about anyone.',

  'privacy.rights.title': 'Your data, and how to erase it',
  'privacy.rights.body':
    'We hold no data that identifies you, so there is nothing to request, correct or export. '
    + 'Your annotations, your progress and your books are on your device; uninstalling the app '
    + 'erases all of them. The server logs expire on their own after 30 days.',

  'privacy.changes.title': 'If this policy changes',
  'privacy.changes.body':
    'The effective date at the top of this page is updated on every revision, and the full '
    + 'history of this text is public in the repository. A change that widened what the app '
    + 'sends would be announced in the release notes.',

  'privacy.contact.title': 'Write to us',
  'privacy.contact.body':
    'A question about this text, or about what the app does with your data:',
  'privacy.contact.issues': 'Ask in public',

  'changelog.added': 'New',
  'changelog.changed': 'Improved',
  'changelog.fixed': 'Fixed',
  'changelog.removed': 'Removed',
  'changelog.security': 'Security',

  'footer.issues': 'Report an issue',
  'footer.privacy': 'Privacy',
  'footer.license': 'Published under the AGPL-3.0 licence',
  'footer.corpus': 'Corpus from the Shamela Library',
  'footer.built': 'Site build {version}',
  'colophon.heading': 'Colophon',
  'colophon.typefaces': 'Set in EB Garamond, Literata and IBM Plex Sans Arabic, all self-hosted.',
};
