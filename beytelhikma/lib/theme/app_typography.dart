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

/// Échelle typographique reprise de `ui-examples/home.html` (display-lg,
/// headline-lg, title-md, body-lg/md, label-md/sm), ramenée aux tailles
/// mobiles de la maquette (`headline-lg-mobile`).
abstract final class AppTypography {
  /// `display-lg` — titre de héros.
  static TextStyle display(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 34,
    height: 1.25,
    letterSpacing: -0.5,
    fontWeight: FontWeight.w700,
    color: color,
  );

  /// `headline-lg` — titres de sections.
  static TextStyle headline(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 26,
    height: 1.3,
    fontWeight: FontWeight.w600,
    color: color,
  );

  /// `title-md`.
  static TextStyle title(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 19,
    height: 1.4,
    fontWeight: FontWeight.w600,
    color: color,
  );

  /// `body-lg`.
  static TextStyle bodyLarge(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 17,
    height: 1.75,
    color: color,
  );

  /// `body-md`.
  static TextStyle body(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: 15,
    height: 1.7,
    color: color,
  );

  /// `label-md`.
  static TextStyle label(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSansFallback,
    fontSize: 14,
    height: 1.45,
    fontWeight: FontWeight.w500,
    color: color,
  );

  /// `label-sm`.
  static TextStyle labelSmall(Color color) => TextStyle(
    fontFamilyFallback: AppFonts.arabicSansFallback,
    fontSize: 12,
    height: 1.35,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.3,
    color: color,
  );
}
