/// Parseur du sous-ensemble HTML produit par le pipeline Shamela.
///
/// Le contenu des pages est du HTML minimal : titres, paragraphes, sauts de
/// ligne, gras/italique, appels de note (`<sup class="fn">`) et vers de poésie
/// (`<p class="verse">`). On le convertit en blocs typés, que le lecteur rend
/// en `TextSpan` — ce qui garde le contrôle total sur la typographie arabe,
/// la sélection et la taille du texte.
library;

enum HtmlBlockType { heading, paragraph, verse, quote }

/// Fragment de texte homogène dans un bloc.
class InlineToken {
  const InlineToken(
    this.text, {
    this.bold = false,
    this.italic = false,
    this.footnoteRef = false,
  });

  final String text;
  final bool bold;
  final bool italic;

  /// Appel de note (`<sup class="fn">1</sup>`).
  final bool footnoteRef;
}

class HtmlBlock {
  const HtmlBlock({required this.type, required this.tokens, this.level = 0});

  final HtmlBlockType type;
  final List<InlineToken> tokens;

  /// Niveau du titre (1 pour `<h1>`), 0 hors titre.
  final int level;

  String get plainText => tokens.map((token) => token.text).join();

  bool get isEmpty => plainText.trim().isEmpty;
}

/// Balises ouvrant un nouveau bloc.
const _blockTags = {
  'p': HtmlBlockType.paragraph,
  'div': HtmlBlockType.paragraph,
  'blockquote': HtmlBlockType.quote,
  'h1': HtmlBlockType.heading,
  'h2': HtmlBlockType.heading,
  'h3': HtmlBlockType.heading,
  'h4': HtmlBlockType.heading,
  'h5': HtmlBlockType.heading,
  'h6': HtmlBlockType.heading,
};

const _entities = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&laquo;': '«',
  '&raquo;': '»',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
};

final _tagPattern = RegExp(r'<(/?)([a-zA-Z0-9]+)([^>]*)>');
final _classPattern = RegExp(r'''class\s*=\s*["']([^"']*)["']''');

String decodeEntities(String input) {
  var text = input;
  _entities.forEach((entity, value) {
    text = text.replaceAll(entity, value);
  });
  return text.replaceAllMapped(
    RegExp(r'&#(\d+);'),
    (match) => String.fromCharCode(int.parse(match.group(1)!)),
  );
}

/// Convertit `html` en blocs. Toute balise inconnue est ignorée, son texte
/// conservé : une page mal formée reste lisible.
List<HtmlBlock> parseArabicHtml(String html) {
  final blocks = <HtmlBlock>[];
  var tokens = <InlineToken>[];
  var currentType = HtmlBlockType.paragraph;
  var currentLevel = 0;
  var boldDepth = 0;
  var italicDepth = 0;
  var footnoteDepth = 0;
  final buffer = StringBuffer();

  void flushText() {
    if (buffer.isEmpty) return;
    tokens.add(
      InlineToken(
        decodeEntities(buffer.toString()),
        bold: boldDepth > 0,
        italic: italicDepth > 0,
        footnoteRef: footnoteDepth > 0,
      ),
    );
    buffer.clear();
  }

  void closeBlock() {
    flushText();
    final block = HtmlBlock(
      type: currentType,
      tokens: List.unmodifiable(tokens),
      level: currentLevel,
    );
    if (!block.isEmpty) blocks.add(block);
    tokens = <InlineToken>[];
    currentType = HtmlBlockType.paragraph;
    currentLevel = 0;
  }

  var cursor = 0;
  for (final match in _tagPattern.allMatches(html)) {
    if (match.start > cursor) {
      buffer.write(html.substring(cursor, match.start));
    }
    cursor = match.end;

    final isClosing = match.group(1) == '/';
    final tag = match.group(2)!.toLowerCase();
    final attributes = match.group(3) ?? '';
    final classes = _classPattern.firstMatch(attributes)?.group(1) ?? '';

    if (tag == 'br') {
      buffer.write('\n');
      continue;
    }

    final blockType = _blockTags[tag];
    if (blockType != null) {
      closeBlock();
      if (!isClosing) {
        currentType = classes.contains('verse')
            ? HtmlBlockType.verse
            : classes.contains('quote')
            ? HtmlBlockType.quote
            : blockType;
        currentLevel = blockType == HtmlBlockType.heading
            ? int.tryParse(tag.substring(1)) ?? 1
            : 0;
      }
      continue;
    }

    switch (tag) {
      case 'b' || 'strong':
        flushText();
        boldDepth += isClosing ? -1 : 1;
      case 'i' || 'em':
        flushText();
        italicDepth += isClosing ? -1 : 1;
      case 'sup' when classes.contains('fn'):
        flushText();
        footnoteDepth += isClosing ? -1 : 1;
      case 'span' when classes.contains('title'):
        flushText();
        boldDepth += isClosing ? -1 : 1;
      default:
        // Balise non gérée : on garde son contenu textuel.
        break;
    }
    if (boldDepth < 0) boldDepth = 0;
    if (italicDepth < 0) italicDepth = 0;
    if (footnoteDepth < 0) footnoteDepth = 0;
  }

  if (cursor < html.length) buffer.write(html.substring(cursor));
  closeBlock();

  return blocks;
}
