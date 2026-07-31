import 'package:flutter/material.dart';

import '../../models/author.dart';
import '../../models/book_category.dart';
import '../../models/book_summary.dart';
import '../../models/library_entry.dart';
import '../../repositories/book_repository.dart';
import '../../widgets/book_card.dart';
import '../../widgets/repository_scope.dart';
import '../../widgets/state_views.dart';
import '../book_detail/book_detail_screen.dart';
import 'widgets/category_grid.dart';
import 'widgets/continue_reading_card.dart';
import 'widgets/featured_author_card.dart';
import 'widgets/section_header.dart';

/// Données agrégées de l'accueil : un seul aller-retour vers le repository.
class HomeData {
  const HomeData({
    required this.continueReading,
    required this.recent,
    required this.categories,
    required this.featuredAuthor,
    required this.featuredAuthorBooks,
  });

  final LibraryEntry? continueReading;
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
  BookRepository get _repository => RepositoryScope.of(context);

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _future = _load();
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
        : await repository.getBooksByAuthor(author.authorId, limit: 4);
    return HomeData(
      continueReading: results[0] as LibraryEntry?,
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('بيت الحكمة'),
        actions: [
          IconButton(
            tooltip: 'البحث',
            icon: const Icon(Icons.search),
            onPressed: () => ScaffoldMessenger.of(
              context,
            ).showSnackBar(const SnackBar(content: Text('البحث قيد الإنجاز'))),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: AsyncView<HomeData>(
        future: _future,
        onRetry: _reload,
        isEmpty: (data) => data.isEmpty,
        emptyMessage: 'المكتبة فارغة حالياً',
        loadingLabel: 'جارٍ تحميل المكتبة…',
        builder: (context, data) => RefreshIndicator(
          onRefresh: () async => _reload(),
          child: ListView(
            padding: const EdgeInsets.only(bottom: 32),
            children: [
              if (data.continueReading != null) ...[
                const SectionHeader(
                  title: 'أكمل القراءة',
                  subtitle: 'لا تدع القصة تنتهي هنا',
                ),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: ContinueReadingCard(
                    entry: data.continueReading!,
                    onTap: () => _openBook(data.continueReading!.book),
                  ),
                ),
                const SizedBox(height: 8),
              ],
              const SectionHeader(
                title: 'المجموعات الحديثة',
                subtitle: 'أحدث الكتب المضافة للمكتبة',
              ),
              SizedBox(
                height: 268,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  itemCount: data.recent.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 14),
                  itemBuilder: (context, index) {
                    final book = data.recent[index];
                    return BookCard(book: book, onTap: () => _openBook(book));
                  },
                ),
              ),
              const SizedBox(height: 12),
              const SectionHeader(title: 'التخصصات العلمية'),
              CategoryGrid(
                categories: data.categories
                    .where((category) => category.bookCount > 0)
                    .toList(growable: false),
                onTap: (category) => _showCategory(category),
              ),
              if (data.featuredAuthor != null) ...[
                const SectionHeader(title: 'شخصية الشهر'),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: FeaturedAuthorCard(
                    author: data.featuredAuthor!,
                    books: data.featuredAuthorBooks,
                    onBookTap: _openBook,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  void _showCategory(BookCategory category) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (sheetContext) => _CategorySheet(
        category: category,
        onBookTap: (book) {
          Navigator.of(sheetContext).pop();
          _openBook(book);
        },
      ),
    );
  }
}

class _CategorySheet extends StatelessWidget {
  const _CategorySheet({required this.category, required this.onBookTap});

  final BookCategory category;
  final ValueChanged<BookSummary> onBookTap;

  @override
  Widget build(BuildContext context) {
    final repository = RepositoryScope.of(context);
    return FractionallySizedBox(
      heightFactor: 0.75,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
            child: Text(
              category.label,
              style: Theme.of(context).textTheme.headlineMedium,
            ),
          ),
          Expanded(
            child: AsyncView<List<BookSummary>>(
              future: repository.getBooksByCategory(category.categoryId),
              isEmpty: (books) => books.isEmpty,
              emptyMessage: 'لا توجد كتب في هذا التصنيف',
              builder: (context, books) => ListView.builder(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                itemCount: books.length,
                itemBuilder: (context, index) => BookListTile(
                  book: books[index],
                  onTap: () => onBookTap(books[index]),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
