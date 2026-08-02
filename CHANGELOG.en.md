# Changelog

> This file is the **source** of the release notes: both the site's `/releases`
> page and the GitHub Release body are derived from it. Section headings are
> fixed keys — `added`, `changed`, `fixed`, `removed`, `security` — translated
> at render time. Every version must appear in all three files with the same
> date, or the build fails.

## [0.4.0] — 2026-08-02

### added
- Turning a page now works three ways: tap the third of the screen where the line starts to go back, the third where it ends to go forward, and on touch or stylus, swipe in the direction the text flows.
- The Android app now ships the book catalogue inside the APK and offers to update it at startup — the first launch no longer needs a cable.
- Android now has its place on the download page and the home screen, next to Windows and Linux, with a notice that the APK carries a debug signature until a publisher key exists.

### removed
- The continuous-scroll reading mode is gone: the corpus is paginated end to end — printed footer, pager fraction, annotation anchors, the `?page=` link — and a scrolling thread has to give up those landmarks one by one. Reading keeps a single mode: the printed page.

## [0.3.1] — 2026-08-01

### fixed
- Under an English interface the reader pointed the wrong way: the exit button and both paging chevrons showed the opposite of what they did. They now follow the direction of the interface.
- The reading gauge filled from the wrong edge in English: the handle moved right while the colour rose from the left.
- Arrow keys turned pages backwards in English, and the shortcuts card named the wrong key.
- Book text now carries its own direction: an Arabic page stays right-to-left under an English interface — justification, chapter headings, table of contents and search results alike.
- The page-turn animation and the chapter chevron on a book's page were oriented for Arabic only.

## [0.3.0] — 2026-08-01

### added
- First public release, for Windows and Linux.
- A catalogue of 8,568 editions ships with the application: browsing, searching and reading need no connection.
- Resumable book downloads, verified by SHA-256 checksum before installation.
- A reader with two modes — printed page and continuous scroll — with table of contents, in-book search and keyboard shortcuts.
- Annotations: bookmarks, four highlight tints and notes, anchored to the text rather than to a page number.
- Three moods — paper, white and night — applied across the whole application.
- Arabic and English interface, with a choice of interface font and reading font.
- Explore, collections, cross-library search and download management screens.

### changed
- The catalogue updates itself from the distribution source: the update is offered, never forced, and a refusal is remembered version by version.
