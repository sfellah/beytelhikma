import 'package:beytelhikma/app.dart';
import 'package:beytelhikma/screens/book_detail/book_detail_screen.dart';
import 'package:beytelhikma/screens/reader/reader_screen.dart';
import 'package:beytelhikma/widgets/repository_scope.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fakes/fake_book_repository.dart';

Widget _wrap(Widget child, {bool failing = false}) => RepositoryScope(
  repository: FakeBookRepository(failing: failing),
  child: MaterialApp(
    locale: const Locale('ar'),
    home: Directionality(textDirection: TextDirection.rtl, child: child),
  ),
);

void main() {
  testWidgets('l\'accueil affiche les sections du catalogue', (tester) async {
    await tester.pumpWidget(BeytElHikmaApp(repository: FakeBookRepository()));
    await tester.pumpAndSettle();

    expect(find.text('بيت الحكمة'), findsOneWidget);
    expect(find.text('المجموعات الحديثة'), findsOneWidget);
    expect(find.text('التخصصات العلمية'), findsOneWidget);
    expect(find.text('كتاب الاختبار'), findsWidgets);
  });

  testWidgets('la fiche livre montre métadonnées et sommaire', (tester) async {
    await tester.pumpWidget(
      _wrap(const BookDetailScreen(editionId: 'ed-test-01')),
    );
    await tester.pumpAndSettle();

    expect(find.text('ابدأ القراءة'), findsOneWidget);
    expect(find.text('دار الاختبار'), findsOneWidget);
    expect(find.text('فهرس المحتويات'), findsOneWidget);
    expect(find.text('الباب الأول'), findsOneWidget);
  });

  testWidgets('le lecteur rend la page et navigue', (tester) async {
    await tester.pumpWidget(_wrap(const ReaderScreen(editionId: 'ed-test-01')));
    await tester.pumpAndSettle();

    expect(find.text('نص الصفحة الأولى'), findsOneWidget);
    expect(find.text('الصفحة 1 من 2'), findsOneWidget);

    await tester.fling(find.byType(PageView), const Offset(400, 0), 1000);
    await tester.pumpAndSettle();

    expect(find.text('نص الصفحة الثانية'), findsOneWidget);
    expect(find.text('الصفحة 2 من 2'), findsOneWidget);
  });

  testWidgets('le lecteur agrandit le texte', (tester) async {
    await tester.pumpWidget(_wrap(const ReaderScreen(editionId: 'ed-test-01')));
    await tester.pumpAndSettle();

    double fontSizeOf(String text) {
      final span = tester.widget<Text>(find.text(text)).textSpan!;
      final first = (span as TextSpan).children!.first as TextSpan;
      return first.style!.fontSize!;
    }

    final before = fontSizeOf('نص الصفحة الأولى');
    await tester.tap(find.byTooltip('تكبير الخط'));
    await tester.pumpAndSettle();

    expect(fontSizeOf('نص الصفحة الأولى'), greaterThan(before));
  });

  testWidgets('une panne du repository affiche l\'état erreur', (tester) async {
    await tester.pumpWidget(
      _wrap(const BookDetailScreen(editionId: 'ed-test-01'), failing: true),
    );
    await tester.pumpAndSettle();

    expect(find.text('تعذّر تحميل المحتوى'), findsOneWidget);
    expect(find.text('إعادة المحاولة'), findsOneWidget);
  });
}
