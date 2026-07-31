import 'package:flutter/material.dart';

/// Tableau clé/valeur. Seules les métadonnées présentes sont passées ici :
/// aucune ligne « غير متوفر » n'est affichée.
class MetadataTable extends StatelessWidget {
  const MetadataTable({required this.rows, super.key});

  final Map<String, String> rows;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final entries = rows.entries.toList(growable: false);

    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.45),
        ),
      ),
      child: Column(
        children: [
          for (var i = 0; i < entries.length; i++)
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              decoration: BoxDecoration(
                border: i == entries.length - 1
                    ? null
                    : Border(
                        bottom: BorderSide(
                          color: theme.colorScheme.outlineVariant.withValues(
                            alpha: 0.35,
                          ),
                        ),
                      ),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SizedBox(
                    width: 110,
                    child: Text(
                      entries[i].key,
                      style: theme.textTheme.labelMedium,
                    ),
                  ),
                  Expanded(
                    child: Text(
                      entries[i].value,
                      style: theme.textTheme.labelLarge,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}
