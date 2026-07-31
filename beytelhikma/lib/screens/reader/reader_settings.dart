import 'package:flutter/material.dart';

import '../../theme/app_colors.dart';
import '../../theme/app_typography.dart';

/// Ambiances de lecture.
enum ReaderPalette {
  parchment('ورقي'),
  sepia('بني فاتح'),
  night('ليلي');

  const ReaderPalette(this.label);

  final String label;

  Color get background => switch (this) {
    ReaderPalette.parchment => AppColors.parchment,
    ReaderPalette.sepia => AppColors.sepiaSurface,
    ReaderPalette.night => AppColors.darkSurface,
  };

  Color get surface => switch (this) {
    ReaderPalette.parchment => AppColors.surfaceContainerLowest,
    ReaderPalette.sepia => const Color(0xFFFAF3E2),
    ReaderPalette.night => AppColors.darkSurfaceContainer,
  };

  Color get onSurface => switch (this) {
    ReaderPalette.parchment => AppColors.onSurface,
    ReaderPalette.sepia => AppColors.sepiaOnSurface,
    ReaderPalette.night => AppColors.darkOnSurface,
  };

  Color get muted => switch (this) {
    ReaderPalette.parchment => AppColors.onSurfaceVariant,
    ReaderPalette.sepia => const Color(0xFF7A6647),
    ReaderPalette.night => AppColors.darkOnSurfaceVariant,
  };

  Color get accent => switch (this) {
    ReaderPalette.parchment => AppColors.deepEmerald,
    ReaderPalette.sepia => AppColors.antiqueGold,
    ReaderPalette.night => AppColors.inversePrimary,
  };

  Brightness get brightness =>
      this == ReaderPalette.night ? Brightness.dark : Brightness.light;
}

/// Famille de police du corps de texte (arabe).
enum ReaderFont {
  naskh('نسخ', AppFonts.arabicSerifFallback),
  sans('حديث', AppFonts.arabicSansFallback);

  const ReaderFont(this.label, this.fallback);

  final String label;
  final List<String> fallback;
}

/// Réglages du lecteur, persistés dans `user.sqlite` (table `app_settings`).
@immutable
class ReaderSettings {
  const ReaderSettings({
    this.fontSize = 19,
    this.lineHeight = 1.9,
    this.palette = ReaderPalette.parchment,
    this.font = ReaderFont.naskh,
    this.showFootnotes = true,
  });

  static const minFontSize = 14.0;
  static const maxFontSize = 40.0;

  final double fontSize;
  final double lineHeight;
  final ReaderPalette palette;
  final ReaderFont font;
  final bool showFootnotes;

  ReaderSettings copyWith({
    double? fontSize,
    double? lineHeight,
    ReaderPalette? palette,
    ReaderFont? font,
    bool? showFootnotes,
  }) => ReaderSettings(
    fontSize: (fontSize ?? this.fontSize).clamp(minFontSize, maxFontSize),
    lineHeight: lineHeight ?? this.lineHeight,
    palette: palette ?? this.palette,
    font: font ?? this.font,
    showFootnotes: showFootnotes ?? this.showFootnotes,
  );

  static const keyFontSize = 'reader.font_size';
  static const keyLineHeight = 'reader.line_height';
  static const keyPalette = 'reader.palette';
  static const keyFont = 'reader.font';
  static const keyFootnotes = 'reader.footnotes';

  factory ReaderSettings.fromMap(Map<String, String> map) {
    T byName<T extends Enum>(List<T> values, String? name, T fallback) {
      for (final value in values) {
        if (value.name == name) return value;
      }
      return fallback;
    }

    const defaults = ReaderSettings();
    return ReaderSettings(
      fontSize: double.tryParse(map[keyFontSize] ?? '') ?? defaults.fontSize,
      lineHeight:
          double.tryParse(map[keyLineHeight] ?? '') ?? defaults.lineHeight,
      palette: byName(ReaderPalette.values, map[keyPalette], defaults.palette),
      font: byName(ReaderFont.values, map[keyFont], defaults.font),
      showFootnotes: (map[keyFootnotes] ?? 'true') == 'true',
    );
  }

  Map<String, String> toMap() => {
    keyFontSize: fontSize.toStringAsFixed(1),
    keyLineHeight: lineHeight.toStringAsFixed(2),
    keyPalette: palette.name,
    keyFont: font.name,
    keyFootnotes: '$showFootnotes',
  };

  TextStyle bodyStyle() => TextStyle(
    fontFamilyFallback: font.fallback,
    fontSize: fontSize,
    height: lineHeight,
    color: palette.onSurface,
  );

  TextStyle headingStyle() => TextStyle(
    fontFamilyFallback: AppFonts.arabicSerifFallback,
    fontSize: fontSize * 1.2,
    height: lineHeight * 0.85,
    fontWeight: FontWeight.w700,
    color: palette.accent,
  );

  TextStyle footnoteStyle() => TextStyle(
    fontFamilyFallback: font.fallback,
    fontSize: fontSize * 0.78,
    height: lineHeight * 0.85,
    color: palette.muted,
  );
}
