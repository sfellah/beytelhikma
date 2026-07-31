import 'dart:ui';

import 'package:flutter/material.dart';

/// Barre supérieure de la maquette : marque à gauche, recherche et profil à
/// droite, fond translucide flouté au défilement.
class HomeAppBar extends StatelessWidget {
  const HomeAppBar({super.key});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;

    return SliverAppBar(
      pinned: true,
      backgroundColor: scheme.surface.withValues(alpha: 0.85),
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleSpacing: 16,
      flexibleSpace: ClipRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 12, sigmaY: 12),
          child: const SizedBox.expand(),
        ),
      ),
      shape: Border(
        bottom: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.3)),
      ),
      title: Row(
        children: [
          Icon(Icons.menu_book, size: 28, color: scheme.primary),
          const SizedBox(width: 10),
          Text(
            'بيت الحكمة',
            style: theme.textTheme.headlineMedium?.copyWith(
              color: scheme.primary,
              fontSize: 24,
            ),
          ),
        ],
      ),
      actions: [
        IconButton(
          tooltip: 'البحث',
          icon: const Icon(Icons.search),
          onPressed: () => ScaffoldMessenger.of(
            context,
          ).showSnackBar(const SnackBar(content: Text('البحث قيد الإنجاز'))),
        ),
        Padding(
          padding: const EdgeInsetsDirectional.only(start: 4, end: 16),
          child: Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: scheme.surfaceContainerHigh,
              border: Border.all(color: scheme.outlineVariant),
            ),
            child: Icon(
              Icons.person_outline,
              size: 19,
              color: scheme.onSurfaceVariant,
            ),
          ),
        ),
      ],
    );
  }
}
