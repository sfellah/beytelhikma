/** كلمات الموقع بالعربية. المفاتيح مطابقة لـ `fr.mjs` — يتحقّق من ذلك اختبار. */
export default {
  'site.name': 'بيت الحكمة',

  'format.size': '{value} م.ب',

  'nav.home': 'الرئيسية',
  'nav.download': 'التحميل',
  'nav.releases': 'الإصدارات',
  'nav.source': 'الشيفرة المصدرية',
  'nav.language': 'اللغة',
  'nav.skip': 'تخطَّ إلى المحتوى',

  'home.title': 'بيت الحكمة — المكتبة العربية، دون اتصال',
  'home.description':
    'تطبيق سطح مكتب حرّ لقراءة {books} كتابًا من التراث العربي. '
    + 'فهرس محلّي، وقراءة دون اتصال، وتعليقات. لويندوز ولينكس.',
  'home.badge': 'الإصدار {version} متاح',
  'home.badge.none': 'الإصدار الأول قيد الإعداد',
  'home.heading': 'اقرأ التراث،',
  'home.heading.accent': 'دون أن تستأذن أحدًا',
  'home.lede':
    'مكتبة من {books} مصنَّفًا تعيش على جهازك. لا حساب، ولا خادم، ولا تتبُّع. '
    + 'تُنزِّل الكتاب مرّة واحدة فيصير لك.',
  'home.cta.primary': 'التحميل لـ{platform}',
  'home.cta.secondary': 'اطّلع على الإصدارات',
  'home.cta.pending': 'قريبًا',
  'home.platforms': 'متاح على',

  'plate.home': 'الرئيسية: الفنون، والقرون، وموضع الوقوف.',
  'plate.reader': 'القارئ، وصفحة موضوعة.',
  'plate.night': 'الصفحة نفسها، في سمة الليل.',
  'plate.explore': 'استكشاف الفهرس بالفنّ وبالعصر.',

  'features.heading': 'ما الذي يقدّمه',
  'features.lede': 'أربعة خيارات في التصميم، مُلتزَمة حتى النهاية — وهي ما يميّزه عن قارئ ملفات آخر.',

  'features.offline.title': 'كلّ شيء محلّي',
  'features.offline.body':
    'الفهرس يُثبَّت مع التطبيق: التصفّح والبحث والقراءة لا تحتاج إلى اتصال. '
    + 'التنزيل وحده هو ما يحتاجه.',
  'features.corpus.title': '{books} كتابًا',
  'features.corpus.body':
    'مدوّنة الشاملة محوَّلة إلى قواعد SQLite، مفهرسة وقابلة للبحث، موزّعة على نحو '
    + 'أربعين فنًّا، من القرن الأول الهجري إلى اليوم.',
  'features.reading.title': 'وضعان للقراءة',
  'features.reading.body':
    'صفحة مطبوعة أو سياق متّصل، وثلاث سمات، وأربع درجات للتظليل، وملاحظات وعلامات '
    + 'مرجعية مثبَّتة على النصّ لا على رقم الصفحة.',
  'features.arabic.title': 'مكتوب للعربية',
  'features.arabic.body':
    'واجهة من اليمين إلى اليسار أصالةً، وخطوط نسخ مضمَّنة، وبحث يتجاوز التشكيل '
    + 'وصور الهمزة. الواجهة متاحة بالعربية والإنجليزية.',

  'trust.free': 'حرّ ومجّاني',
  'trust.free.detail': 'رخصة AGPL-3.0',
  'trust.private': 'بلا تتبُّع',
  'trust.private.detail': 'لا حساب ولا قياس عن بُعد',
  'trust.offline': 'دون اتصال',
  'trust.offline.detail': 'كتبك تبقى عندك',

  'download.title': 'تحميل بيت الحكمة',
  'download.description': 'مثبِّتات ويندوز ولينكس للإصدار {version}. مجّانًا، ودون حساب.',
  'download.heading': 'التحميل',
  'download.lede': 'الإصدار {version}، صدر في {date}.',
  'download.lede.none': 'لا إصدار منشور بعد.',
  'download.empty': 'الإصدار الأول قيد الإعداد. الشيفرة متاحة — تابع المستودع ليصلك الخبر.',
  'download.recommended': 'الموصى به لنظامك',
  'download.checksum': 'بصمة SHA-512',

  'platform.windows': 'ويندوز',
  'platform.linux': 'لينكس',
  'platform.android': 'أندرويد',
  'platform.macos': 'ماك',
  'platform.unknown': 'نظامك',
  'platform.pending': 'لم يُنشر بعد: ليس في الإصدار الأخير ملفّ لهذا النظام.',
  'platform.soon': 'قريبًا',

  'asset.installer': 'برنامج التثبيت',
  'asset.portable': 'نسخة محمولة',
  'asset.appimage': 'AppImage',
  'asset.deb': 'حزمة deb.',
  'asset.rpm': 'حزمة rpm.',
  'asset.apk': 'حزمة APK',
  'asset.archive': 'أرشيف',
  'asset.installer.hint': 'يثبّت التطبيق وينشئ اختصارًا.',
  'asset.portable.hint': 'تعمل دون تثبيت، ولا تُحدِّث نفسها.',
  'asset.appimage.hint': 'اجعله قابلًا للتنفيذ ثم شغّله. يُحدِّث نفسه.',
  'asset.deb.hint': 'دبيان وأوبونتو وما تفرّع عنهما. التحديث عبر مدير الحزم.',
  'asset.rpm.hint': 'فيدورا وopenSUSE وما تفرّع عنهما.',
  'asset.apk.hint': 'تُثبَّت من الملفّ مباشرة، دون متجر. ولا تُحدِّث نفسها.',
  'asset.archive.hint': 'يُفكّ يدويًّا.',

  'specs.heading': 'المتطلّبات',
  'specs.os': 'النظام',
  'specs.os.value': 'ويندوز ١٠ أو ١١ (٦٤ بت) · لينكس x86-64 · أندرويد ٧ فما فوق',
  'specs.ram': 'الذاكرة',
  'specs.ram.value': '٤ غيغابايت حدًّا أدنى، و٨ مستحسنة',
  'specs.disk': 'القرص',
  'specs.disk.value': '٤٠٠ ميغابايت للتطبيق، وما تحتاجه الكتب المنزَّلة',
  'specs.net': 'الشبكة',
  'specs.net.value': 'مطلوبة لتنزيل كتاب، لا لقراءته',

  'smartscreen.heading': 'ويندوز يعرض تحذيرًا',
  'smartscreen.body':
    'المثبِّت غير موقَّع بشهادة تجارية، فيعرض ويندوز رسالة «Windows protected your PC». '
    + 'اضغط «More info» ثم «Run anyway». وإن أردت اليقين أنّ الملف هو المنشور هنا، '
    + 'فقارن بصمة SHA-512 أعلاه.',

  'apk.unsigned.heading': 'حزمة APK غير موقَّعة',
  'apk.unsigned.body':
    'هي موقَّعة بمفتاح التنقيح الخاصّ بأندرويد، لا بشهادة ناشر. لذلك ينبّهك أندرويد عند '
    + 'التثبيت إلى أنّ المصدر غير معروف، ويطلب الإذن بالتثبيت من هذا الملفّ؛ وقد يعترضها '
    + 'Play Protect فيعرض «التثبيت على أيّة حال». ومتى وُجد مفتاح نشر، لزم حذف التطبيق قبل '
    + 'التحديث: أندرويد لا يستبدل تطبيقًا بتوقيع مختلف.',

  'releases.title': 'إصدارات بيت الحكمة',
  'releases.description': 'ملاحظات الإصدارات، من الأحدث إلى الأقدم.',
  'releases.heading': 'الإصدارات',
  'releases.lede': 'ما الذي تغيّر، إصدارًا بعد إصدار.',
  'releases.latest': 'الأحدث',
  'releases.prerelease': 'إصدار تجريبي',
  'releases.published': 'صدر في {date}',
  'releases.download': 'تحميل هذا الإصدار',
  'releases.empty': 'لا إصدار منشور بعد.',
  'releases.notes.empty': 'لا ملاحظات لهذا الإصدار.',

  'changelog.added': 'جديد',
  'changelog.changed': 'تحسينات',
  'changelog.fixed': 'إصلاحات',
  'changelog.removed': 'ما أُزيل',
  'changelog.security': 'أمان',

  'footer.issues': 'الإبلاغ عن مشكلة',
  'footer.license': 'منشور برخصة AGPL-3.0',
  'footer.corpus': 'المدوّنة مصدرها المكتبة الشاملة',
  'footer.built': 'بناء الموقع {version}',
  'colophon.heading': 'الترقيمة',
  'colophon.typefaces': 'رُكِّب بخطّي أميري وIBM Plex Sans Arabic، وكلاهما مضمَّن.',
};
