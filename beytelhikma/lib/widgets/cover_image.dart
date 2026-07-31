import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../models/book_summary.dart';
import '../theme/app_typography.dart';
import '../utils/book_cover.dart';

/// L'or du décor. Une seule valeur pour toutes les reliures : c'est ce qui fait
/// tenir ensemble neuf familles et cinq mises en page.
const _gilt = Color(0xFFD9B871);
const _paper = Color(0xFFF3E9D7);
const _ink = Color(0xFFF6F1E6);

/// Couverture d'un livre. Aucun livre du corpus n'a d'image — `cover_url` est
/// nulle partout — donc la couverture est dessinée, et dessinée d'après ce que
/// le catalogue sait : la forme de l'objet donne la reliure, la famille de la
/// catégorie donne la teinte et le motif, et le siècle de l'auteur donne la
/// patine. Les tables vivent dans `lib/utils/book_cover.dart`, en miroir du
/// fichier JavaScript du portage.
///
/// La branche [Image.network] reste en place pour le jour où une `cover_url` en
/// `http` existera ; elle n'est atteinte par aucune donnée actuelle.
class CoverImage extends StatelessWidget {
  const CoverImage({
    required this.book,
    this.borderRadius = 8,
    this.showTitle = true,
    super.key,
  });

  final BookSummary book;
  final double borderRadius;
  final bool showTitle;

  @override
  Widget build(BuildContext context) {
    final url = book.coverUrl;
    final radius = BorderRadius.circular(borderRadius);

    if (url != null && url.startsWith('http')) {
      return ClipRRect(
        borderRadius: radius,
        child: Image.network(
          url,
          fit: BoxFit.cover,
          errorBuilder: (context, _, _) => _composed(radius),
        ),
      );
    }
    return _composed(radius);
  }

  Widget _composed(BorderRadius radius) {
    final style = coverStyleFor(
      categoryLabel: book.categoryLabel,
      authorDeathYear: book.authorDeathYear,
      bookType: book.bookType,
      volumeCount: book.volumeCount,
      pageCount: book.pageCount,
    );
    return ClipRRect(
      borderRadius: radius,
      child: switch (style.shape) {
        CoverShape.treatise => _TreatiseCover(
          book: book,
          style: style,
          showTitle: showTitle,
        ),
        CoverShape.book => _BookCover(
          book: book,
          style: style,
          showTitle: showTitle,
        ),
        CoverShape.tome => _TomeCover(
          book: book,
          style: style,
          showTitle: showTitle,
        ),
        CoverShape.compendium => _CompendiumCover(
          book: book,
          style: style,
          showTitle: showTitle,
        ),
        CoverShape.document => _DocumentCover(
          book: book,
          style: style,
          showTitle: showTitle,
        ),
      },
    );
  }
}

/* ----------------------------------------------------------------- éléments */

/// Le fond dégradé commun à toutes les reliures sauf l'imprimée.
Widget _field(CoverStyle style, {required Widget child}) => DecoratedBox(
  decoration: BoxDecoration(
    gradient: LinearGradient(
      begin: Alignment.topCenter,
      end: Alignment.bottomCenter,
      colors: [style.start, style.end],
    ),
  ),
  child: child,
);

/// La dorure monte avec l'âge de l'auteur : `style.gilt` vient du module
/// partagé, `scale` la module par reliure sans rompre la progression.
Widget _grain(CoverStyle style, {double scale = 1}) => Positioned.fill(
  child: CustomPaint(
    painter: _PatternPainter(
      style.pattern,
      _gilt.withValues(alpha: (style.gilt * scale).clamp(0.0, 1.0)),
    ),
  ),
);

/// La même couverture sert de vignette de rayonnage, de carte de grille et de
/// couverture de fiche. Le texte suit donc la largeur, sinon il paraît écrasé
/// sur l'une et perdu sur l'autre. Les bornes sont ce qui reste lisible aux deux
/// extrêmes — mêmes valeurs que le `clamp()` de `components.css`.
double _titleSize(double width, {double ratio = 0.09, double max = 26}) =>
    (width * ratio).clamp(13.0, max);

double _authorSize(double width) => (width * 0.055).clamp(9.0, 15.0);

TextStyle _titleStyle({
  double size = 16,
  Color color = _ink,
  FontWeight weight = FontWeight.w600,
}) => TextStyle(
  fontFamilyFallback: AppFonts.arabicSerifFallback,
  color: color,
  fontSize: size,
  height: 1.5,
  fontWeight: weight,
);

TextStyle _authorStyle({
  Color color = _ink,
  double opacity = 0.72,
  double size = 11,
}) => TextStyle(
  fontFamilyFallback: AppFonts.arabicSansFallback,
  color: color.withValues(alpha: opacity),
  fontSize: size,
);

Widget _title(
  BookSummary book, {
  double size = 16,
  Color color = _ink,
  int maxLines = 3,
}) => Text(
  book.title,
  maxLines: maxLines,
  overflow: TextOverflow.ellipsis,
  textAlign: TextAlign.center,
  style: _titleStyle(size: size, color: color),
);

Widget? _author(
  BookSummary book, {
  required double width,
  Color color = _ink,
  double opacity = 0.72,
}) {
  final name = book.authorName;
  if (name == null) return null;
  return Text(
    name,
    maxLines: 1,
    overflow: TextOverflow.ellipsis,
    textAlign: TextAlign.center,
    style: _authorStyle(
      color: color,
      opacity: opacity,
      size: _authorSize(width),
    ),
  );
}

/* ------------------------------------- un tome, de 121 à 400 pages */

class _BookCover extends StatelessWidget {
  const _BookCover({
    required this.book,
    required this.style,
    required this.showTitle,
  });

  final BookSummary book;
  final CoverStyle style;
  final bool showTitle;

  @override
  Widget build(BuildContext context) => _field(
    style,
    child: LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        return Stack(
          fit: StackFit.expand,
          children: [
            _grain(style),
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.all(6),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: _gilt.withValues(alpha: style.gilt),
                    ),
                  ),
                ),
              ),
            ),
            if (showTitle)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    _title(book, size: _titleSize(width)),
                    const Spacer(),
                    ?_author(book, width: width),
                  ],
                ),
              ),
          ],
        );
      },
    ),
  );
}

/* ------------------------------------------------------- multi-tomes */

class _CompendiumCover extends StatelessWidget {
  const _CompendiumCover({
    required this.book,
    required this.style,
    required this.showTitle,
  });

  final BookSummary book;
  final CoverStyle style;
  final bool showTitle;

  @override
  Widget build(BuildContext context) => _field(
    style,
    child: LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        final medallion = width * 0.46;
        return Stack(
          fit: StackFit.expand,
          children: [
            _grain(style, scale: 0.8),
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.all(6),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: _gilt.withValues(alpha: style.gilt),
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(4),
                    child: DecoratedBox(
                      decoration: BoxDecoration(
                        border: Border.all(color: _gilt.withValues(alpha: 0.2)),
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 18, 14, 14),
              child: Column(
                children: [
                  SizedBox(
                    width: medallion,
                    height: medallion,
                    child: CustomPaint(
                      painter: _ShamsaPainter(_gilt.withValues(alpha: 0.78)),
                    ),
                  ),
                  if (showTitle) ...[
                    const SizedBox(height: 14),
                    Container(
                      padding: const EdgeInsets.symmetric(vertical: 8),
                      decoration: BoxDecoration(
                        border: Border.symmetric(
                          horizontal: BorderSide(
                            color: _gilt.withValues(alpha: 0.55),
                          ),
                        ),
                      ),
                      child: _title(
                        book,
                        size: _titleSize(width, ratio: 0.075, max: 22),
                        maxLines: 2,
                      ),
                    ),
                    const Spacer(),
                    ?_author(book, width: width),
                  ],
                ],
              ),
            ),
          ],
        );
      },
    ),
  );
}

/* --------------------------------- un tome de plus de 400 pages */

class _TomeCover extends StatelessWidget {
  const _TomeCover({
    required this.book,
    required this.style,
    required this.showTitle,
  });

  final BookSummary book;
  final CoverStyle style;
  final bool showTitle;

  @override
  Widget build(BuildContext context) => _field(
    style,
    child: LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        return Stack(
          fit: StackFit.expand,
          children: [
            // Le motif ne couvre plus le fond : il remplit un panneau encadré.
            // C'est la géométrie qui porte l'identité, pas la seule couleur.
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.all(8),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(
                      color: _gilt.withValues(alpha: 0.6),
                      width: 1.5,
                    ),
                  ),
                  child: CustomPaint(
                    painter: _PatternPainter(
                      style.pattern,
                      _gilt.withValues(alpha: 0.5),
                    ),
                  ),
                ),
              ),
            ),
            Positioned.fill(
              child: Padding(
                padding: const EdgeInsets.all(3),
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    border: Border.all(color: _gilt.withValues(alpha: 0.3)),
                  ),
                ),
              ),
            ),
            if (showTitle)
              Padding(
                padding: const EdgeInsets.all(12),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.all(8),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.42),
                        border: Border.all(color: _gilt.withValues(alpha: 0.5)),
                        borderRadius: BorderRadius.circular(2),
                      ),
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          _title(
                            book,
                            size: _titleSize(width, ratio: 0.075, max: 22),
                            maxLines: 2,
                          ),
                          ?_author(book, width: width),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        );
      },
    ),
  );
}

/* ------------------------------------------ ce qui n'est pas un livre */

/// Ce qui n'est pas un livre — رسالة جامعية, مجلة, دروس مفرغة. Seule reliure à
/// contraste inversé : papier clair, encre sombre, couleur de famille sur le dos. Le dos est posé en `start` — donc à droite en
/// RTL, là où se relie un livre arabe, et à gauche si l'interface passe en LTR.
class _DocumentCover extends StatelessWidget {
  const _DocumentCover({
    required this.book,
    required this.style,
    required this.showTitle,
  });

  final BookSummary book;
  final CoverStyle style;
  final bool showTitle;

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final spine = (constraints.maxWidth * 0.18).clamp(14.0, 42.0);
      return ColoredBox(
        color: _paper,
        child: Stack(
          fit: StackFit.expand,
          children: [
            PositionedDirectional(
              top: 0,
              bottom: 0,
              start: 0,
              width: spine,
              child: DecoratedBox(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [style.start, style.end],
                  ),
                  border: BorderDirectional(
                    end: BorderSide(color: _gilt.withValues(alpha: 0.4)),
                  ),
                ),
                child: CustomPaint(
                  painter: _PatternPainter(
                    style.pattern,
                    _gilt.withValues(alpha: 0.34),
                  ),
                ),
              ),
            ),
            if (showTitle)
              Padding(
                padding: EdgeInsetsDirectional.fromSTEB(spine + 12, 14, 12, 14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (book.categoryLabel != null)
                      Text(
                        book.categoryLabel!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: _authorStyle(color: style.end, opacity: 1),
                      ),
                    const SizedBox(height: 8),
                    Text(
                      book.title,
                      maxLines: 3,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.start,
                      style: _titleStyle(
                        size: _titleSize(constraints.maxWidth),
                        color: const Color(0xFF1B1B1E),
                        weight: FontWeight.w700,
                      ),
                    ),
                    const Spacer(),
                    if (book.authorName != null)
                      Text(
                        book.authorName!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: _authorStyle(
                          color: const Color(0xFF6B5C4C),
                          opacity: 1,
                          size: _authorSize(constraints.maxWidth),
                        ),
                      ),
                  ],
                ),
              ),
          ],
        ),
      );
    },
  );
}

/* -------------------------------------------- métn de 120 pages ou moins */

/// Un métn court n'a rien d'autre à montrer que son titre : il le montre en
/// grand. C'est aussi la mise en page la plus lisible en vignette.
class _TreatiseCover extends StatelessWidget {
  const _TreatiseCover({
    required this.book,
    required this.style,
    required this.showTitle,
  });

  final BookSummary book;
  final CoverStyle style;
  final bool showTitle;

  @override
  Widget build(BuildContext context) => _field(
    style,
    child: LayoutBuilder(
      builder: (context, constraints) {
        final width = constraints.maxWidth;
        return Stack(
          fit: StackFit.expand,
          children: [
            _grain(style, scale: 0.5),
            if (showTitle)
              Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _title(
                      book,
                      size: _titleSize(width, ratio: 0.12, max: 34),
                      maxLines: 3,
                    ),
                    Container(
                      width: 32,
                      height: 1,
                      margin: const EdgeInsets.symmetric(vertical: 8),
                      color: _gilt.withValues(alpha: 0.7),
                    ),
                    ?_author(book, width: width),
                  ],
                ),
              ),
          ],
        );
      },
    ),
  );
}

/* ------------------------------------------------------------- géométries */

/// Six trames, pas neuf : deux familles partagent parfois la même géométrie et
/// n'en changent que la teinte. Chaque tuile se dessine une fois puis se répète
/// en coordonnées absolues — le motif garde ainsi la même échelle sur une
/// vignette de rayonnage et sur la grande couverture de la fiche livre.
class _PatternPainter extends CustomPainter {
  const _PatternPainter(this.pattern, this.color);

  final CoverPattern pattern;
  final Color color;

  static const _tiles = <CoverPattern, double>{
    CoverPattern.girih: 52,
    CoverPattern.knot: 46,
    CoverPattern.octagon: 44,
    CoverPattern.vine: 48,
    CoverPattern.kufi: 30,
    CoverPattern.grid: 26,
  };

  @override
  void paint(Canvas canvas, Size size) {
    final tile = _tiles[pattern]!;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    final path = _tilePath(tile);

    canvas.save();
    canvas.clipRect(Offset.zero & size);
    for (double y = 0; y < size.height; y += tile) {
      for (double x = 0; x < size.width; x += tile) {
        canvas.save();
        canvas.translate(x, y);
        canvas.drawPath(path, paint);
        canvas.restore();
      }
    }
    canvas.restore();
  }

  Path _tilePath(double tile) {
    final path = Path();
    switch (pattern) {
      // étoile à huit branches : deux carrés superposés, l'un tourné d'un quart.
      // Le second est écrit en losange plutôt qu'obtenu par matrice — ses quatre
      // sommets sont à 13√2 du centre, ce qui se lit et se vérifie à l'œil.
      case CoverPattern.girih:
        const diagonal = 13 * math.sqrt2;
        path.addRect(const Rect.fromLTWH(13, 13, 26, 26));
        path.addPolygon(const [
          Offset(26, 26 - diagonal),
          Offset(26 + diagonal, 26),
          Offset(26, 26 + diagonal),
          Offset(26 - diagonal, 26),
        ], true);
        path.addOval(
          Rect.fromCircle(center: const Offset(26, 26), radius: 3.6),
        );
      // entrelacs : deux arcs qui se croisent et se relaient d'une tuile à l'autre
      case CoverPattern.knot:
        path.moveTo(0, 23);
        path.quadraticBezierTo(11.5, 0, 23, 23);
        path.quadraticBezierTo(34.5, 46, 46, 23);
        path.moveTo(23, 0);
        path.quadraticBezierTo(46, 11.5, 23, 23);
        path.quadraticBezierTo(0, 34.5, 23, 46);
      case CoverPattern.octagon:
        path.addPolygon(const [
          Offset(22, 4),
          Offset(34, 10),
          Offset(40, 22),
          Offset(34, 34),
          Offset(22, 40),
          Offset(10, 34),
          Offset(4, 22),
          Offset(10, 10),
        ], true);
        path.addOval(Rect.fromCircle(center: const Offset(22, 22), radius: 7));
      case CoverPattern.vine:
        path.moveTo(24, 4);
        path.cubicTo(34, 14, 34, 34, 24, 44);
        path.cubicTo(14, 34, 14, 14, 24, 4);
        path.moveTo(4, 24);
        path.cubicTo(14, 14, 34, 14, 44, 24);
        path.cubicTo(34, 34, 14, 34, 4, 24);
      // kufique carré : angles droits, jambages coupés net
      case CoverPattern.kufi:
        path.moveTo(4, 4);
        path.lineTo(20, 4);
        path.lineTo(20, 14);
        path.lineTo(10, 14);
        path.lineTo(10, 26);
        path.moveTo(26, 4);
        path.lineTo(26, 20);
        path.lineTo(16, 20);
      case CoverPattern.grid:
        path.addRect(const Rect.fromLTWH(4, 4, 18, 18));
        path.moveTo(0, 13);
        path.lineTo(26, 13);
        path.moveTo(13, 0);
        path.lineTo(13, 26);
    }
    return path;
  }

  @override
  bool shouldRepaint(_PatternPainter oldDelegate) =>
      oldDelegate.pattern != pattern || oldDelegate.color != color;
}

/// La rosace `شمسة` : seize pétales, décrits une fois et tournés quinze fois.
class _ShamsaPainter extends CustomPainter {
  const _ShamsaPainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    // La géométrie est décrite dans un carré de 80 unités, comme côté Electron ;
    // on la ramène à la taille réelle plutôt que de la redécrire.
    final scale = size.shortestSide / 80;
    canvas.save();
    canvas.translate(size.width / 2, size.height / 2);
    canvas.scale(scale);

    for (final radius in const [34.0, 26.0, 9.0]) {
      canvas.drawCircle(Offset.zero, radius, paint);
    }

    final petal = Path()
      ..moveTo(0, -26)
      ..lineTo(7, -13)
      ..lineTo(0, -6.5)
      ..lineTo(-7, -13)
      ..close();
    for (var index = 0; index < 16; index += 1) {
      canvas.save();
      canvas.rotate(index * math.pi / 8);
      canvas.drawPath(petal, paint);
      canvas.restore();
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_ShamsaPainter oldDelegate) => oldDelegate.color != color;
}
