import 'package:flutter/material.dart';

import '../../../models/book_page.dart';
import '../../../utils/arabic_html_parser.dart';
import '../reader_settings.dart';

/// Rendu d'une page : blocs typés → `TextSpan`, texte sélectionnable.
///
/// La direction du contenu est forcée en RTL : c'est la langue du livre qui
/// commande, pas la locale de l'interface.
class ReaderPageView extends StatelessWidget {
  const ReaderPageView({
    required this.page,
    required this.settings,
    required this.volumeLabel,
    super.key,
  });

  final BookPage page;
  final ReaderSettings settings;
  final String? volumeLabel;

  @override
  Widget build(BuildContext context) {
    final blocks = parseArabicHtml(page.bodyHtml);
    final palette = settings.palette;

    return Directionality(
      textDirection: TextDirection.rtl,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 16, 20, 40),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _PageMarker(
              page: page,
              volumeLabel: volumeLabel,
              settings: settings,
            ),
            const SizedBox(height: 18),
            SelectionArea(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  for (final block in blocks)
                    _Block(block: block, settings: settings),
                  if (settings.showFootnotes && page.hasFootnotes) ...[
                    const SizedBox(height: 24),
                    Divider(color: palette.muted.withValues(alpha: 0.35)),
                    const SizedBox(height: 10),
                    Text(page.footnotes!, style: settings.footnoteStyle()),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PageMarker extends StatelessWidget {
  const _PageMarker({
    required this.page,
    required this.volumeLabel,
    required this.settings,
  });

  final BookPage page;
  final String? volumeLabel;
  final ReaderSettings settings;

  @override
  Widget build(BuildContext context) {
    final style = settings.footnoteStyle();
    final label = [
      if (volumeLabel != null) volumeLabel!,
      if (page.printedPageNum != null) 'ص ${page.printedPageNum}',
    ].join(' • ');

    if (label.isEmpty) return const SizedBox.shrink();

    return Row(
      children: [
        Expanded(
          child: Divider(color: settings.palette.muted.withValues(alpha: 0.25)),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10),
          child: Text(label, style: style),
        ),
        Expanded(
          child: Divider(color: settings.palette.muted.withValues(alpha: 0.25)),
        ),
      ],
    );
  }
}

class _Block extends StatelessWidget {
  const _Block({required this.block, required this.settings});

  final HtmlBlock block;
  final ReaderSettings settings;

  @override
  Widget build(BuildContext context) {
    final palette = settings.palette;

    final base = switch (block.type) {
      HtmlBlockType.heading => settings.headingStyle(),
      HtmlBlockType.verse => settings.bodyStyle().copyWith(
        fontStyle: FontStyle.italic,
        height: settings.lineHeight * 0.95,
      ),
      HtmlBlockType.quote => settings.bodyStyle().copyWith(
        color: palette.muted,
      ),
      HtmlBlockType.paragraph => settings.bodyStyle(),
    };

    final text = Text.rich(
      TextSpan(
        children: [
          for (final token in block.tokens)
            TextSpan(
              text: token.text,
              style: base.copyWith(
                fontWeight: token.bold ? FontWeight.w700 : null,
                fontStyle: token.italic ? FontStyle.italic : null,
                fontSize: token.footnoteRef ? base.fontSize! * 0.7 : null,
                color: token.footnoteRef ? palette.accent : null,
                height: token.footnoteRef ? 1 : null,
              ),
            ),
        ],
      ),
      textAlign: switch (block.type) {
        HtmlBlockType.heading => TextAlign.center,
        HtmlBlockType.verse => TextAlign.center,
        _ => TextAlign.justify,
      },
    );

    final padding = switch (block.type) {
      HtmlBlockType.heading => const EdgeInsets.only(top: 20, bottom: 12),
      HtmlBlockType.verse => const EdgeInsets.symmetric(vertical: 6),
      _ => const EdgeInsets.only(bottom: 14),
    };

    if (block.type == HtmlBlockType.quote) {
      return Padding(
        padding: padding,
        child: Container(
          padding: const EdgeInsetsDirectional.only(start: 14),
          decoration: BoxDecoration(
            border: BorderDirectional(
              start: BorderSide(
                color: palette.accent.withValues(alpha: 0.6),
                width: 3,
              ),
            ),
          ),
          child: text,
        ),
      );
    }

    return Padding(padding: padding, child: text);
  }
}
