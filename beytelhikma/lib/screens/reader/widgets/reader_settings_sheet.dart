import 'package:flutter/material.dart';

import '../reader_settings.dart';

/// Feuille de réglages du lecteur : taille, interligne, police, ambiance.
class ReaderSettingsSheet extends StatefulWidget {
  const ReaderSettingsSheet({
    required this.settings,
    required this.onChanged,
    super.key,
  });

  final ReaderSettings settings;
  final ValueChanged<ReaderSettings> onChanged;

  @override
  State<ReaderSettingsSheet> createState() => _ReaderSettingsSheetState();
}

class _ReaderSettingsSheetState extends State<ReaderSettingsSheet> {
  late ReaderSettings _settings = widget.settings;

  void _update(ReaderSettings settings) {
    setState(() => _settings = settings);
    widget.onChanged(settings);
  }

  @override
  Widget build(BuildContext context) {
    final palette = _settings.palette;
    final labelStyle = TextStyle(
      color: palette.onSurface,
      fontSize: 14,
      fontWeight: FontWeight.w600,
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 4, 20, 28),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('إعدادات القراءة', style: labelStyle.copyWith(fontSize: 17)),
          const SizedBox(height: 18),

          Text('حجم الخط', style: labelStyle),
          Row(
            children: [
              Icon(Icons.text_decrease, size: 18, color: palette.muted),
              Expanded(
                child: Slider(
                  value: _settings.fontSize,
                  min: ReaderSettings.minFontSize,
                  max: ReaderSettings.maxFontSize,
                  divisions:
                      (ReaderSettings.maxFontSize - ReaderSettings.minFontSize)
                          .round(),
                  label: _settings.fontSize.toStringAsFixed(0),
                  activeColor: palette.accent,
                  onChanged: (value) =>
                      _update(_settings.copyWith(fontSize: value)),
                ),
              ),
              Icon(Icons.text_increase, size: 22, color: palette.muted),
            ],
          ),

          Text('تباعد الأسطر', style: labelStyle),
          Slider(
            value: _settings.lineHeight,
            min: 1.4,
            max: 2.6,
            divisions: 12,
            label: _settings.lineHeight.toStringAsFixed(1),
            activeColor: palette.accent,
            onChanged: (value) =>
                _update(_settings.copyWith(lineHeight: value)),
          ),
          const SizedBox(height: 8),

          Text('نوع الخط', style: labelStyle),
          const SizedBox(height: 8),
          SegmentedButton<ReaderFont>(
            segments: [
              for (final font in ReaderFont.values)
                ButtonSegment(value: font, label: Text(font.label)),
            ],
            selected: {_settings.font},
            showSelectedIcon: false,
            onSelectionChanged: (selection) =>
                _update(_settings.copyWith(font: selection.first)),
          ),
          const SizedBox(height: 18),

          Text('الوضع', style: labelStyle),
          const SizedBox(height: 8),
          Row(
            children: [
              for (final palette in ReaderPalette.values)
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 4),
                    child: _PaletteChip(
                      palette: palette,
                      selected: palette == _settings.palette,
                      onTap: () =>
                          _update(_settings.copyWith(palette: palette)),
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),

          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            value: _settings.showFootnotes,
            activeColor: palette.accent,
            title: Text('إظهار الحواشي', style: labelStyle),
            onChanged: (value) =>
                _update(_settings.copyWith(showFootnotes: value)),
          ),
        ],
      ),
    );
  }
}

class _PaletteChip extends StatelessWidget {
  const _PaletteChip({
    required this.palette,
    required this.selected,
    required this.onTap,
  });

  final ReaderPalette palette;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14),
        decoration: BoxDecoration(
          color: palette.background,
          borderRadius: BorderRadius.circular(10),
          border: Border.all(
            color: selected
                ? palette.accent
                : palette.muted.withValues(alpha: 0.3),
            width: selected ? 2 : 1,
          ),
        ),
        child: Column(
          children: [
            Text(
              'أبجد',
              style: TextStyle(color: palette.onSurface, fontSize: 16),
            ),
            const SizedBox(height: 4),
            Text(
              palette.label,
              style: TextStyle(color: palette.muted, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }
}
