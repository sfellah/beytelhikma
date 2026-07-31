import 'package:flutter/material.dart';

import 'app_colors.dart';
import 'app_typography.dart';

abstract final class AppTheme {
  static ThemeData light() {
    const scheme = ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.deepEmerald,
      onPrimary: Colors.white,
      primaryContainer: AppColors.primaryFixed,
      onPrimaryContainer: AppColors.primary,
      secondary: AppColors.antiqueGold,
      onSecondary: Colors.white,
      secondaryContainer: AppColors.secondaryContainer,
      onSecondaryContainer: AppColors.onSecondaryContainer,
      tertiary: AppColors.slateTeal,
      onTertiary: Colors.white,
      tertiaryContainer: AppColors.tertiaryFixed,
      onTertiaryContainer: AppColors.slateTeal,
      error: AppColors.error,
      onError: Colors.white,
      errorContainer: Color(0xFFFFDAD6),
      onErrorContainer: Color(0xFF93000A),
      surface: AppColors.parchment,
      onSurface: AppColors.onSurface,
      onSurfaceVariant: AppColors.onSurfaceVariant,
      surfaceContainerLowest: AppColors.surfaceContainerLowest,
      surfaceContainerLow: AppColors.surfaceContainerLow,
      surfaceContainer: AppColors.surfaceContainer,
      surfaceContainerHigh: AppColors.surfaceContainerHigh,
      surfaceContainerHighest: AppColors.surfaceContainerHighest,
      outline: AppColors.outline,
      outlineVariant: AppColors.outlineVariant,
      inversePrimary: AppColors.inversePrimary,
    );

    return _base(scheme);
  }

  static ThemeData dark() {
    const scheme = ColorScheme(
      brightness: Brightness.dark,
      primary: AppColors.inversePrimary,
      onPrimary: AppColors.primary,
      primaryContainer: AppColors.deepEmerald,
      onPrimaryContainer: AppColors.primaryFixed,
      secondary: AppColors.secondaryContainer,
      onSecondary: Color(0xFF291800),
      secondaryContainer: Color(0xFF594320),
      onSecondaryContainer: AppColors.secondaryContainer,
      tertiary: AppColors.tertiaryFixed,
      onTertiary: AppColors.slateTeal,
      tertiaryContainer: Color(0xFF0D2B34),
      onTertiaryContainer: AppColors.tertiaryFixed,
      error: Color(0xFFFFB4AB),
      onError: Color(0xFF690005),
      errorContainer: Color(0xFF93000A),
      onErrorContainer: Color(0xFFFFDAD6),
      surface: AppColors.darkSurface,
      onSurface: AppColors.darkOnSurface,
      onSurfaceVariant: AppColors.darkOnSurfaceVariant,
      surfaceContainerLowest: Color(0xFF0E1013),
      surfaceContainerLow: Color(0xFF181B1F),
      surfaceContainer: AppColors.darkSurfaceContainer,
      surfaceContainerHigh: Color(0xFF262A30),
      surfaceContainerHighest: Color(0xFF31353B),
      outline: Color(0xFF8B9195),
      outlineVariant: Color(0xFF3A3F44),
      inversePrimary: AppColors.deepEmerald,
    );

    return _base(scheme);
  }

  static ThemeData _base(ColorScheme scheme) {
    final onSurface = scheme.onSurface;
    final variant = scheme.onSurfaceVariant;

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      scaffoldBackgroundColor: scheme.surface,
      splashFactory: InkSparkle.splashFactory,
      textTheme: TextTheme(
        displayLarge: AppTypography.display(onSurface),
        headlineMedium: AppTypography.headline(onSurface),
        titleMedium: AppTypography.title(onSurface),
        bodyLarge: AppTypography.body(onSurface),
        bodyMedium: AppTypography.body(variant),
        labelLarge: AppTypography.label(onSurface),
        labelMedium: AppTypography.label(variant),
        labelSmall: AppTypography.labelSmall(variant),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        titleTextStyle: AppTypography.title(onSurface),
        iconTheme: IconThemeData(color: variant),
      ),
      cardTheme: CardThemeData(
        color: scheme.surfaceContainerLow,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(
            color: scheme.outlineVariant.withValues(alpha: 0.45),
          ),
        ),
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant.withValues(alpha: 0.5),
        space: 1,
        thickness: 1,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: scheme.secondaryContainer,
        labelStyle: AppTypography.labelSmall(scheme.onSecondaryContainer),
        side: BorderSide.none,
        shape: const StadiumBorder(),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: scheme.primary,
          foregroundColor: scheme.onPrimary,
          textStyle: AppTypography.label(scheme.onPrimary),
          shape: const StadiumBorder(),
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 14),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: scheme.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: scheme.secondaryContainer,
        elevation: 0,
        labelTextStyle: WidgetStatePropertyAll(
          AppTypography.labelSmall(variant),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(
        color: scheme.primary,
        linearTrackColor: scheme.surfaceContainerHighest,
      ),
    );
  }
}
