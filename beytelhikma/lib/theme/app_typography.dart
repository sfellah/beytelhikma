import 'package:flutter/material.dart';

/// Piles de polices : l'arabe et le latin restent séparés (voir CLAUDE.md).
///
/// Aucune police n'est embarquée pour l'instant : on s'appuie sur les familles
/// système avec repli explicite. Le jour où les fichiers Amiri / Noto Naskh
/// seront ajoutés dans `assets/fonts/`, seules ces constantes changent.
abstract final class AppFonts {
  static const arabicSerifFallback = <String>[
    'Amiri',
    'Scheherazade New',
    'Noto Naskh Arabic',
    'Traditional Arabic',
    'Times New Roman',
    'serif',
  ];

  static const arabicSansFallback = <String>[
    'Noto Kufi Arabic',
    'Dubai',
    'Segoe UI',
    'sans-serif',
  ];

  static const latinSerifFallback = <String>[
    'Playfair Display',
    'Source Serif 4',
    'Georgia',
    'serif',
  ];
}

abstract final class AppTypography {
  /// Titres d'écran et de sections.
  static TextStyle display(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 30,
    height: 1.35,
    fontWeight: FontWeight.w700,
    color: color,
  );

  static TextStyle headline(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 22,
    height: 1.4,
    fontWeight: FontWeight.w600,
    color: color,
  );

  static TextStyle title(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 17,
    height: 1.4,
    fontWeight: FontWeight.w600,
    color: color,
  );

  static TextStyle body(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 15,
    height: 1.7,
    color: color,
  );

  static TextStyle label(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSansFallback,
    fontSize: 13,
    height: 1.4,
    fontWeight: FontWeight.w500,
    color: color,
  );

  static TextStyle labelSmall(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSansFallback,
    fontSize: 11,
    height: 1.35,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.2,
    color: color,
  );
}
