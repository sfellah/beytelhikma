import 'package:flutter/material.dart';

/// Palette issue des maquettes `ui-examples/` (thème « parchemin »).
abstract final class AppColors {
  // Surfaces claires
  static const parchment = Color(0xFFFBF9F4);
  static const surfaceContainerLowest = Color(0xFFFFFFFF);
  static const surfaceContainerLow = Color(0xFFF5F3EE);
  static const surfaceContainer = Color(0xFFF0EEE9);
  static const surfaceContainerHigh = Color(0xFFEAE8E3);
  static const surfaceContainerHighest = Color(0xFFE4E2DD);

  // Texte
  static const onSurface = Color(0xFF1B1C19);
  static const onSurfaceVariant = Color(0xFF414847);

  // Traits
  static const outline = Color(0xFF717977);
  static const outlineVariant = Color(0xFFC0C8C6);

  // Accents
  static const deepEmerald = Color(0xFF002D29);
  static const primary = Color(0xFF001614);
  static const primaryFixed = Color(0xFFC1EBE4);
  static const inversePrimary = Color(0xFFA5CFC8);
  static const antiqueGold = Color(0xFF735A35);
  static const secondaryContainer = Color(0xFFFDDAAC);
  static const onSecondaryContainer = Color(0xFF785E39);
  static const slateTeal = Color(0xFF0C2A33);
  static const tertiaryFixed = Color(0xFFCAE7F3);
  static const error = Color(0xFFBA1A1A);

  // Surfaces sombres (lecteur en thème nuit)
  static const darkSurface = Color(0xFF14161A);
  static const darkSurfaceContainer = Color(0xFF1D2025);
  static const darkOnSurface = Color(0xFFE6E3DC);
  static const darkOnSurfaceVariant = Color(0xFFA9AEB2);

  // Sépia (lecteur)
  static const sepiaSurface = Color(0xFFF4ECD8);
  static const sepiaOnSurface = Color(0xFF3B2F1E);
}
