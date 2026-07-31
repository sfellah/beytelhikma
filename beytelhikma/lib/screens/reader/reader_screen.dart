import 'dart:async';

import 'package:flutter/material.dart';

import '../../models/book_detail.dart';
import '../../models/book_page.dart';
import '../../models/reading_progress.dart';
import '../../models/toc_entry.dart';
import '../../models/volume.dart';
import '../../repositories/book_repository.dart';
import '../../widgets/repository_scope.dart';
import '../../widgets/state_views.dart';
import 'reader_settings.dart';
import 'widgets/reader_page_view.dart';
import 'widgets/reader_settings_sheet.dart';
import 'widgets/reader_toc_sheet.dart';

class ReaderData {
  const ReaderData({
    required this.detail,
    required this.pages,
    required this.toc,
    required this.settings,
    required this.startIndex,
  });

  final BookDetail detail;
  final List<BookPage> pages;
  final List<TocEntry> toc;
  final ReaderSettings settings;
  final int startIndex;
}

/// Lecteur : une page imprimée par écran, balayage RTL, texte sélectionnable
/// et taille de police réglable (boutons, feuille de réglages ou pincement).
class ReaderScreen extends StatefulWidget {
  const ReaderScreen({required this.editionId, this.startPageId, super.key});

  final String editionId;
  final int? startPageId;

  @override
  State<ReaderScreen> createState() => _ReaderScreenState();
}

class _ReaderScreenState extends State<ReaderScreen> {
  late Future<ReaderData> _future;
  PageController? _controller;
  ReaderSettings _settings = const ReaderSettings();
  List<BookPage> _pages = const [];
  Map<int, Volume> _volumesById = const {};
  int _index = 0;
  bool _chromeVisible = true;
  double? _pinchStartFontSize;
  Timer? _saveDebounce;

  /// Référence conservée : `dispose()` enregistre la progression et ne peut
  /// plus remonter l'arbre à ce moment-là.
  late BookRepository _repository;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _repository = RepositoryScope.of(context);
    _future = _load();
  }

  @override
  void dispose() {
    _saveDebounce?.cancel();
    _persistProgress();
    _controller?.dispose();
    super.dispose();
  }

  Future<ReaderData> _load() async {
    final repository = _repository;
    final detail = await repository.getBookDetail(widget.editionId);
    final pageCount = await repository.getPageCount(widget.editionId);
    final pages = await repository.getPages(
      widget.editionId,
      limit: pageCount == 0 ? 50 : pageCount,
    );
    final toc = TocEntry.buildTree(await repository.getToc(widget.editionId));
    final settings = ReaderSettings.fromMap(await repository.getSettings());
    final progress = await repository.getProgress(widget.editionId);

    final targetPageId = widget.startPageId ?? progress?.pageId;
    var startIndex = 0;
    if (targetPageId != null) {
      final found = pages.indexWhere((page) => page.pageId == targetPageId);
      if (found >= 0) startIndex = found;
    }

    _pages = pages;
    _settings = settings;
    _index = startIndex;
    _volumesById = {
      for (final volume in detail.volumes) volume.volumeId: volume,
    };
    _controller?.dispose();
    _controller = PageController(initialPage: startIndex);

    return ReaderData(
      detail: detail,
      pages: pages,
      toc: toc,
      settings: settings,
      startIndex: startIndex,
    );
  }

  void _reload() => setState(() => _future = _load());

  // -------------------------------------------------------------- progression

  void _onPageChanged(int index) {
    setState(() => _index = index);
    _saveDebounce?.cancel();
    _saveDebounce = Timer(const Duration(milliseconds: 600), _persistProgress);
  }

  void _persistProgress() {
    if (_pages.isEmpty || _index >= _pages.length) return;
    final page = _pages[_index];
    unawaited(
      _repository.saveProgress(
        ReadingProgress(
          editionId: widget.editionId,
          pageId: page.pageId,
          sequenceNum: page.sequenceNum,
          percent: (_index + 1) / _pages.length,
          updatedAt: DateTime.now(),
        ),
      ),
    );
  }

  // ----------------------------------------------------------------- réglages

  Future<void> _applySettings(ReaderSettings settings) async {
    setState(() => _settings = settings);
    final repository = _repository;
    for (final entry in settings.toMap().entries) {
      await repository.saveSetting(entry.key, entry.value);
    }
  }

  void _bumpFontSize(double delta) => unawaited(
    _applySettings(_settings.copyWith(fontSize: _settings.fontSize + delta)),
  );

  void _openSettings() {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      backgroundColor: _settings.palette.surface,
      builder: (_) => ReaderSettingsSheet(
        settings: _settings,
        onChanged: (settings) => unawaited(_applySettings(settings)),
      ),
    );
  }

  void _openToc(List<TocEntry> toc) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      backgroundColor: _settings.palette.surface,
      builder: (sheetContext) => ReaderTocSheet(
        entries: toc,
        palette: _settings.palette,
        currentPageId: _pages.isEmpty ? null : _pages[_index].pageId,
        onTap: (entry) {
          Navigator.of(sheetContext).pop();
          _goToPageId(entry.pageId);
        },
      ),
    );
  }

  void _goToPageId(int pageId) {
    final index = _pages.indexWhere((page) => page.pageId == pageId);
    if (index < 0) return;
    _controller?.jumpToPage(index);
  }

  // -------------------------------------------------------------------- build

  @override
  Widget build(BuildContext context) {
    final palette = _settings.palette;

    return Scaffold(
      backgroundColor: palette.background,
      body: AsyncView<ReaderData>(
        future: _future,
        onRetry: _reload,
        loadingLabel: 'جارٍ فتح الكتاب…',
        isEmpty: (data) => data.pages.isEmpty,
        emptyMessage: 'لا توجد صفحات في هذا الكتاب',
        builder: (context, data) => SafeArea(
          child: Column(
            children: [
              if (_chromeVisible) _buildTopBar(data),
              Expanded(
                child: GestureDetector(
                  behavior: HitTestBehavior.translucent,
                  onTap: () => setState(() => _chromeVisible = !_chromeVisible),
                  onScaleStart: (details) {
                    if (details.pointerCount >= 2) {
                      _pinchStartFontSize = _settings.fontSize;
                    }
                  },
                  onScaleUpdate: (details) {
                    final start = _pinchStartFontSize;
                    if (start == null || details.pointerCount < 2) return;
                    setState(() {
                      _settings = _settings.copyWith(
                        fontSize: start * details.scale,
                      );
                    });
                  },
                  onScaleEnd: (_) {
                    if (_pinchStartFontSize == null) return;
                    _pinchStartFontSize = null;
                    unawaited(_applySettings(_settings));
                  },
                  child: Directionality(
                    textDirection: TextDirection.rtl,
                    child: PageView.builder(
                      controller: _controller,
                      itemCount: data.pages.length,
                      onPageChanged: _onPageChanged,
                      itemBuilder: (context, index) {
                        final page = data.pages[index];
                        return ReaderPageView(
                          page: page,
                          settings: _settings,
                          volumeLabel:
                              _volumesById[page.volumeId]?.displayLabel,
                        );
                      },
                    ),
                  ),
                ),
              ),
              if (_chromeVisible) _buildBottomBar(data),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTopBar(ReaderData data) {
    final palette = _settings.palette;
    return Container(
      color: palette.surface,
      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 6),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back),
            color: palette.onSurface,
            onPressed: () => Navigator.of(context).maybePop(),
          ),
          Expanded(
            child: Text(
              data.detail.title,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                color: palette.onSurface,
                fontSize: 16,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          IconButton(
            tooltip: 'تصغير الخط',
            icon: const Icon(Icons.text_decrease),
            color: palette.onSurface,
            onPressed: () => _bumpFontSize(-1),
          ),
          IconButton(
            tooltip: 'تكبير الخط',
            icon: const Icon(Icons.text_increase),
            color: palette.onSurface,
            onPressed: () => _bumpFontSize(1),
          ),
          IconButton(
            tooltip: 'الفهرس',
            icon: const Icon(Icons.toc),
            color: palette.onSurface,
            onPressed: () => _openToc(data.toc),
          ),
          IconButton(
            tooltip: 'إعدادات القراءة',
            icon: const Icon(Icons.tune),
            color: palette.onSurface,
            onPressed: _openSettings,
          ),
        ],
      ),
    );
  }

  Widget _buildBottomBar(ReaderData data) {
    final palette = _settings.palette;
    final total = data.pages.length;
    final page = data.pages[_index.clamp(0, total - 1)];

    return Container(
      color: palette.surface,
      padding: const EdgeInsets.fromLTRB(16, 6, 16, 10),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SliderTheme(
            data: SliderThemeData(
              activeTrackColor: palette.accent,
              thumbColor: palette.accent,
              inactiveTrackColor: palette.muted.withValues(alpha: 0.25),
              trackHeight: 3,
            ),
            child: Slider(
              value: (_index + 1).toDouble(),
              min: 1,
              max: total.toDouble(),
              divisions: total > 1 ? total - 1 : null,
              label: '${_index + 1}',
              onChanged: (value) => _controller?.jumpToPage(value.round() - 1),
            ),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'الصفحة ${_index + 1} من $total',
                style: TextStyle(color: palette.muted, fontSize: 12),
              ),
              if (page.printedPageNum != null)
                Text(
                  'المطبوعة ${page.printedPageNum}',
                  style: TextStyle(color: palette.muted, fontSize: 12),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
