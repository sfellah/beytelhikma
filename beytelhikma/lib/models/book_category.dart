/// Discipline du catalogue (التفسير، الحديث…).
class BookCategory {
  const BookCategory({
    required this.categoryId,
    required this.label,
    this.parentId,
    this.sortOrder = 0,
    this.bookCount = 0,
  });

  final int categoryId;
  final String label;
  final int? parentId;
  final int sortOrder;
  final int bookCount;

  factory BookCategory.fromMap(Map<String, Object?> map) => BookCategory(
    categoryId: map['category_id']! as int,
    label: map['label_ar']! as String,
    parentId: map['parent_id'] as int?,
    sortOrder: (map['sort_order'] as int?) ?? 0,
    bookCount: (map['book_count'] as int?) ?? 0,
  );

  Map<String, Object?> toJson() => {
    'category_id': categoryId,
    'label_ar': label,
    'parent_id': parentId,
    'sort_order': sortOrder,
    'book_count': bookCount,
  };
}
