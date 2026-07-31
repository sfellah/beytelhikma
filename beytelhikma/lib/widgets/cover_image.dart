import 'package:flutter/material.dart';

import '../models/book_summary.dart';
import '../theme/app_typography.dart';

/// Couverture d'un livre. Le catalogue peut ne pas fournir d'image :
/// on génère alors une couverture typographique déterministe à partir du titre.
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

  static const _palettes = <List<Color>>[
    [Color(0xFF002D29), Color(0xFF12514A)],
    [Color(0xFF0C2A33), Color(0xFF2F4B54)],
    [Color(0xFF4A3411), Color(0xFF735A35)],
    [Color(0xFF2A2340), Color(0xFF4C3F6B)],
    [Color(0xFF3B1F1F), Color(0xFF6B3A34)],
  ];

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
          errorBuilder: (context, _, _) => _placeholder(context, radius),
        ),
      );
    }
    return _placeholder(context, radius);
  }

  Widget _placeholder(BuildContext context, BorderRadius radius) {
    final palette = _palettes[book.editionId.hashCode.abs() % _palettes.length];
    return DecoratedBox(
      decoration: BoxDecoration(
        borderRadius: radius,
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: palette,
        ),
      ),
      child: Stack(
        fit: StackFit.expand,
        children: [
          Positioned.fill(
            child: CustomPaint(painter: _ArabesquePainter(palette.last)),
          ),
          if (showTitle)
            Padding(
              padding: const EdgeInsets.all(12),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    book.title,
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamilyFallback: AppFonts.arabicSerifFallback,
                      color: Colors.white.withValues(alpha: 0.95),
                      fontSize: 16,
                      height: 1.5,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (book.authorName != null) ...[
                    const SizedBox(height: 8),
                    Container(
                      width: 24,
                      height: 1,
                      color: Colors.white.withValues(alpha: 0.4),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      book.authorName!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamilyFallback: AppFonts.arabicSansFallback,
                        color: Colors.white.withValues(alpha: 0.7),
                        fontSize: 11,
                      ),
                    ),
                  ],
                ],
              ),
            ),
        ],
      ),
    );
  }
}

/// Motif géométrique discret, dans l'esprit des maquettes.
class _ArabesquePainter extends CustomPainter {
  const _ArabesquePainter(this.color);

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.white.withValues(alpha: 0.07)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;

    const step = 26.0;
    for (double y = -size.width; y < size.height + size.width; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y + size.width), paint);
      canvas.drawLine(Offset(0, y + size.width), Offset(size.width, y), paint);
    }

    final border = Paint()
      ..color = Colors.white.withValues(alpha: 0.16)
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1;
    canvas.drawRect(
      Rect.fromLTWH(6, 6, size.width - 12, size.height - 12),
      border,
    );
  }

  @override
  bool shouldRepaint(_ArabesquePainter oldDelegate) =>
      oldDelegate.color != color;
}
