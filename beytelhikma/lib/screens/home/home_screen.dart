import 'package:flutter/material.dart';

import '../../models/author.dart';
import '../../models/book_category.dart';
import '../../models/book_summary.dart';
import '../../models/library_entry.dart';
import '../../repositories/book_repository.dart';
import '../../theme/app_theme.dart';
import '../../widgets/book_card.dart';
import '../../widgets/repository_scope.dart';
import '../../widgets/state_views.dart';
import '../book_detail/book_detail_screen.dart';
import 'widgets/category_grid.dart';
import 'widgets/continue_reading_card.dart';
import 'widgets/featured_author_card.dart';
import 'widgets/home_app_bar.dart';
import 'widgets/section_header.dart';

/// Au-delà de cette largeur, l'accueil passe en deux colonnes comme la
/// maquette de bureau (`lg:` dans `ui-examples/home.html`).
const _wideBreakpoint = 900.0;

/// Données agrégées de l'accueil : un seul aller-retour vers le repository.
class HomeData {
  const HomeData({
    required this.continueReading,
    required this.continueExcerpt,
    required this.recent,
    required this.categories,
    required this.featuredAuthor,
    required this.featuredAuthorBooks,
  });

  final LibraryEntry? continueReading;

  /// Extrait de la page en cours, cité dans le héros.
  final String? continueExcerpt;
  final List<BookSummary> recent;
  final List<BookCategory> categories;
  final Author? featuredAuthor;
  final List<BookSummary> featuredAuthorBooks;

  bool get isEmpty => recent.isEmpty && categories.isEmpty;
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  late Future<HomeData> _future;
  final ScrollController _carouselController = ScrollController();

  BookRepository get _repository => RepositoryScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future = _load();
  }

  @override
  void dispose() {
    _carouselController.dispose();
    super.dispose();
  }

  Future<HomeData> _load() async {
    final repository = _repository;
    final results = await Future.wait([
      repository.getContinueReading(),
      repository.getRecentBooks(limit: 12),
      repository.getCategories(),
      repository.getFeaturedAuthor(),
    ]);

    final author = results[3] as Author?;
    final authorBooks = author == null
        ? const <BookSummary>[]
        : await repository.getBooksByAuthor(author.authorId, limit: 3);

    final resume = results[0] as LibraryEntry?;
    String? excerpt;
    if (resume != null) {
      final pageId = resume.progress?.pageId;
      final page = pageId == null
          ? null
          : await repository.getPageById(resume.book.editionId, pageId);
      excerpt = page?.bodyPlain.replaceAll('\n', ' ').trim();
    }

    return HomeData(
      continueReading: resume,
      continueExcerpt: excerpt,
      recent: results[1] as List<BookSummary>,
      categories: results[2] as List<BookCategory>,
      featuredAuthor: author,
      featuredAuthorBooks: authorBooks,
    );
  }

  void _reload() => setState(() => _future = _load());

  Future<void> _openBook(BookSummary book) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => BookDetailScreen(editionId: book.editionId),
      ),
    );
    if (mounted) _reload();
  }

  void _scrollCarousel(double delta) {
    if (!_carouselController.hasClients) return;
    final position = _carouselController.position;
    _carouselController.animateTo(
      (_carouselController.offset + delta).clamp(
        position.minScrollExtent,
        position.maxScrollExtent,
      ),
      duration: const Duration(milliseconds: 320),
      curve: Curves.easeOutCubic,
    );
  }

  void _showBooks(String title, Future<List<BookSummary>> books) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => _BooksSheet(
        title: title,
        books: books,
        onBookTap: (book) {
          Navigator.of(sheetContext).pop();
          _openBook(book);
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: AsyncView<HomeData>(
        future: _future,
        onRetry: _reload,
        isEmpty: (data) => data.isEmpty,
        emptyMessage: 'المكتبة فارغة حالياً',
        loadingLabel: 'جارٍ تحميل المكتبة…',
        builder: (context, data) => RefreshIndicator(
          onRefresh: () async => _reload(),
          child: LayoutBuilder(
            builder: (context, constraints) {
              final isWide = constraints.maxWidth >= _wideBreakpoint;
              return CustomScrollView(
                slivers: [
                  const HomeAppBar(),
                  SliverList.list(
                    children: [
                      if (data.continueReading != null)
                        _HeroSection(
                          entry: data.continueReading!,
                          excerpt: data.continueExcerpt,
                          isWide: isWide,
                          onContinue: () =>
                              _openBook(data.continueReading!.book),
                        ),
                      _RecentSection(
                        books: data.recent,
                        controller: _carouselController,
                        onBookTap: _openBook,
                        onScroll: _scrollCarousel,
                        onSeeAll: () => _showBooks(
                          'كل الإصدارات',
                          _repository.getBooks(limit: 50),
                        ),
                      ),
                      _BentoSection(
                        isWide: isWide,
                        categories: data.categories
                            .where((category) => category.bookCount > 0)
                            .toList(growable: false),
                        author: data.featuredAuthor,
                        authorBooks: data.featuredAuthorBooks,
                        onCategoryTap: (category) => _showBooks(
                          category.label,
                          _repository.getBooksByCategory(category.categoryId),
                        ),
                        onBookTap: _openBook,
                      ),
                      const SizedBox(height: 40),
                    ],
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}

/// Héros « أكمل القراءة » : discours à gauche, carte du livre en cours à droite.
class _HeroSection extends StatelessWidget {
  const _HeroSection({
    required this.entry,
    required this.excerpt,
    required this.isWide,
    required this.onContinue,
  });

  final LibraryEntry entry;
  final String? excerpt;
  final bool isWide;
  final VoidCallback onContinue;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    final pitch = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'أكمل القراءة..',
          style: theme.textTheme.displayLarge?.copyWith(
            color: theme.colorScheme.primary,
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'لا تدع القصة تنتهي هنا. واصل قراءة كتابك الأخير وانغمس في عالم '
          'المعرفة والأدب.',
          style: theme.textTheme.bodyLarge,
        ),
        const SizedBox(height: 20),
        FilledButton.icon(
          onPressed: onContinue,
          iconAlignment: IconAlignment.end,
          icon: const Icon(Icons.arrow_outward, size: 18),
          label: const Text('متابعة القراءة'),
        ),
      ],
    );

    final card = ContinueReadingCard(
      entry: entry,
      excerpt: excerpt,
      onTap: onContinue,
    );

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 8),
      child: isWide
          ? Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  flex: 2,
                  child: Padding(
                    padding: const EdgeInsetsDirectional.only(end: 32, top: 12),
                    child: pitch,
                  ),
                ),
                Expanded(flex: 3, child: card),
              ],
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [pitch, const SizedBox(height: 24), card],
            ),
    );
  }
}

/// Carrousel « المجموعات الحديثة ».
class _RecentSection extends StatelessWidget {
  const _RecentSection({
    required this.books,
    required this.controller,
    required this.onBookTap,
    required this.onScroll,
    required this.onSeeAll,
  });

  static const cardWidth = 168.0;
  static const _gap = 16.0;

  final List<BookSummary> books;
  final ScrollController controller;
  final ValueChanged<BookSummary> onBookTap;
  final ValueChanged<double> onScroll;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(
          title: 'المجموعات الحديثة',
          subtitle: 'أحدث الكتب المضافة للمكتبة',
          action: Row(
            children: [
              _RoundIconButton(
                icon: Icons.arrow_forward,
                onPressed: () => onScroll(-(cardWidth + _gap) * 2),
              ),
              const SizedBox(width: 8),
              _RoundIconButton(
                icon: Icons.arrow_back,
                onPressed: () => onScroll((cardWidth + _gap) * 2),
              ),
            ],
          ),
        ),
        SizedBox(
          height: cardWidth * 1.5 + 62,
          child: ListView.separated(
            controller: controller,
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            physics: const BouncingScrollPhysics(),
            itemCount: books.length + 1,
            separatorBuilder: (_, _) => const SizedBox(width: _gap),
            itemBuilder: (context, index) {
              if (index == books.length) {
                return _SeeAllCard(width: cardWidth, onTap: onSeeAll);
              }
              final book = books[index];
              return BookCard(
                book: book,
                width: cardWidth,
                onTap: () => onBookTap(book),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _RoundIconButton extends StatelessWidget {
  const _RoundIconButton({required this.icon, required this.onPressed});

  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: 38,
      height: 38,
      child: OutlinedButton(
        onPressed: onPressed,
        style: OutlinedButton.styleFrom(
          padding: EdgeInsets.zero,
          shape: const CircleBorder(),
          side: BorderSide(color: theme.colorScheme.outlineVariant),
          foregroundColor: theme.colorScheme.onSurfaceVariant,
        ),
        child: Icon(icon, size: 18),
      ),
    );
  }
}

/// Dernière tuile du carrousel : « عرض كل الإصدارات الجديدة ».
class _SeeAllCard extends StatelessWidget {
  const _SeeAllCard({required this.width, required this.onTap});

  final double width;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SizedBox(
      width: width,
      child: InkWell(
        borderRadius: BorderRadius.circular(AppRadius.container),
        onTap: onTap,
        child: AspectRatio(
          aspectRatio: 2 / 3,
          child: Container(
            decoration: BoxDecoration(
              color: theme.colorScheme.surfaceContainerHigh,
              borderRadius: BorderRadius.circular(AppRadius.container),
              border: Border.all(
                color: theme.colorScheme.outlineVariant.withValues(alpha: 0.4),
              ),
            ),
            padding: const EdgeInsets.all(16),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(
                  Icons.library_add_outlined,
                  size: 32,
                  color: theme.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(height: 10),
                Text(
                  'عرض كل الإصدارات',
                  textAlign: TextAlign.center,
                  style: theme.textTheme.labelMedium,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Grille « bento » : disciplines (2/3) + personnalité du mois (1/3).
class _BentoSection extends StatelessWidget {
  const _BentoSection({
    required this.isWide,
    required this.categories,
    required this.author,
    required this.authorBooks,
    required this.onCategoryTap,
    required this.onBookTap,
  });

  final bool isWide;
  final List<BookCategory> categories;
  final Author? author;
  final List<BookSummary> authorBooks;
  final ValueChanged<BookCategory> onCategoryTap;
  final ValueChanged<BookSummary> onBookTap;

  @override
  Widget build(BuildContext context) {
    final disciplines = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(title: 'التخصصات العلمية'),
        CategoryGrid(categories: categories, onTap: onCategoryTap),
      ],
    );

    if (author == null) return disciplines;

    final featured = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SectionHeader(title: 'شخصية الشهر'),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16),
          child: FeaturedAuthorCard(
            author: author!,
            books: authorBooks,
            onBookTap: onBookTap,
          ),
        ),
      ],
    );

    if (!isWide) {
      return Column(children: [disciplines, featured]);
    }

    // Pas d'IntrinsicHeight ici : la grille des disciplines est un viewport
    // paresseux, dont on ne peut pas mesurer la hauteur intrinsèque.
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(flex: 2, child: disciplines),
        Expanded(child: featured),
      ],
    );
  }
}

/// Liste de livres en feuille (catégorie ou « tout le catalogue »).
class _BooksSheet extends StatelessWidget {
  const _BooksSheet({
    required this.title,
    required this.books,
    required this.onBookTap,
  });

  final String title;
  final Future<List<BookSummary>> books;
  final ValueChanged<BookSummary> onBookTap;

  @override
  Widget build(BuildContext context) {
    return FractionallySizedBox(
      heightFactor: 0.78,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            child: Text(
              title,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          ),
          Expanded(
            child: AsyncView<List<BookSummary>>(
              future: books,
              isEmpty: (list) => list.isEmpty,
              emptyMessage: 'لا توجد كتب في هذا التصنيف',
              builder: (context, list) => ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: list.length,
                itemBuilder: (context, index) => BookListTile(
                  book: list[index],
                  onTap: () => onBookTap(list[index]),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
