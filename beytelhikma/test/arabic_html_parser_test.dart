import 'package:beytelhikma/utils/arabic_html_parser.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('parseArabicHtml', () {
    test('sépare titres et paragraphes', () {
      final blocks = parseArabicHtml(
        '<h2>كتاب العلم</h2><p>الحمد لله</p><p>أما بعد</p>',
      );

      expect(blocks, hasLength(3));
      expect(blocks.first.type, HtmlBlockType.heading);
      expect(blocks.first.level, 2);
      expect(blocks.first.plainText, 'كتاب العلم');
      expect(blocks[1].type, HtmlBlockType.paragraph);
      expect(blocks[2].plainText, 'أما بعد');
    });

    test('reconnaît les vers via class="verse"', () {
      final blocks = parseArabicHtml('<p class="verse">على قدر أهل العزم</p>');

      expect(blocks.single.type, HtmlBlockType.verse);
    });

    test('marque les appels de note', () {
      final blocks = parseArabicHtml('<p>نص المتن<sup class="fn">1</sup></p>');

      final tokens = blocks.single.tokens;
      expect(tokens.where((token) => token.footnoteRef), hasLength(1));
      expect(tokens.firstWhere((token) => token.footnoteRef).text, '1');
      expect(tokens.first.footnoteRef, isFalse);
    });

    test('applique gras et italique', () {
      final blocks = parseArabicHtml('<p>عادي <b>غليظ</b> <i>مائل</i></p>');

      final tokens = blocks.single.tokens;
      expect(tokens.firstWhere((token) => token.bold).text, 'غليظ');
      expect(tokens.firstWhere((token) => token.italic).text, 'مائل');
    });

    test('convertit <br> en saut de ligne et décode les entités', () {
      final blocks = parseArabicHtml(
        '<p>سطر&nbsp;أول<br>سطر ثانٍ &amp; آخر</p>',
      );

      expect(blocks.single.plainText, 'سطر أول\nسطر ثانٍ & آخر');
    });

    test(
      'conserve le texte des balises inconnues et ignore les blocs vides',
      () {
        final blocks = parseArabicHtml(
          '<p></p><section><p>محتوى <mark>مهم</mark></p></section>',
        );

        expect(blocks, hasLength(1));
        expect(blocks.single.plainText, 'محتوى مهم');
      },
    );

    test('tolère une balise fermante orpheline', () {
      final blocks = parseArabicHtml('نص</b> يتبع');

      expect(blocks.single.plainText.trim(), 'نص يتبع');
    });
  });
}
