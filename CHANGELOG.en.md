# Changelog

> This file is the **source** of the release notes: both the site's `/releases`
> page and the GitHub Release body are derived from it. Section headings are
> fixed keys — `added`, `changed`, `fixed`, `removed`, `security` — translated
> at render time. Every version must appear in all three files with the same
> date, or the build fails.

## [0.5.2] — 2026-08-03

### changed
- On phones the downloads table now reads as cards, with the book's status first: its seven columns wanted 880 points of width, and you had to scroll the table sideways past six of them to learn whether you already had the book. Nobody makes that gesture.

### fixed
- The interface ran off the screen on phones: on browse and on downloads the page slid sideways and part of the header stayed out of view. Two distinct causes — a box that switched to a column while still allowed to wrap, and a search field with a fixed width that grew wider than the screen as soon as the system text size was enlarged. In right-to-left writing this overflow runs into negative values and so shows up in no width measurement: which is why it lived on without any check going red.
- Bulk actions were cut down to two-letter stumps. "Clear selection" becomes a cross — it is a way out of the mode, not an action — and the two remaining actions keep their whole word; if room runs short the row moves below the count instead of abbreviating.
- The bulk action bar placed the system's side inset on the wrong side in right-to-left writing.

## [0.5.1] — 2026-08-03

### added
- Settings now end with the app version, the platform and the engine, next to what the library holds. These are the first three lines of any bug report.
- The downloads table says at a glance whether you already have a book: a mark at the start of the row, and a badge that carries a drawing as well as its word — a tick for present, a dash for absent. Absence gets its own outline rather than the neutral badge, which read the same as "unknown".

### changed
- The bulk action bars now float above the screen instead of scrolling away with the page: you tick a book at the fortieth row and the actions are still under your thumb. This applies to the downloads table and to composing a collection, where "Done" used to sit in the header.

### fixed
- The Android app announced version "1.0 (1)" — the template written once by the build tooling, which nobody was updating since the native project is regenerated. The version now comes from the project itself, and both apps carry the same number.

## [0.5.0] — 2026-08-03

### added
- Continuous scrolling returns alongside paged reading: pages follow one another in a single column, and you move between them by scrolling. The choice is made once, in settings, and applies to every book. The column only mounts a window of pages around the one being read — the largest titles in the corpus run past a thousand pages.
- Footnote markers are now tappable and lead to their note, whether they are tagged or written plainly in the middle of a paragraph. A number is only marked when a note answers it: "(3)" is just as likely a verse number.
- Reopening a book returns to the exact spot you left, not to the top of the page. On a phone, a page of the corpus commonly runs three to six screens.
- A very large book says so before making you wait, instead of spinning without a word.
- Opening a chapter from the table of contents, a search result or an annotation leaves a pill to return to where you were reading.
- On Android, the back gesture closes one layer at a time — the note, the selection, the panel, full screen — instead of leaving the book outright.
- The Android app has its own icon and splash screen: the symbol on cream, growing into place.

### changed
- The table of contents opens on the chapter being read rather than at the start of the book; it arrives after the first page instead of holding it up, and can be filtered by title.
- The reading slider announces its destination while dragged and only travels on release; until now it loaded a page per notch.
- Downloads keep what they have just installed on screen, instead of watching it vanish from the queue.
- The home screen tightens its density: the installed-book count and the link to the whole library share one row, which otherwise pushed the curricula below the fold.

### fixed
- Writing a note on a passage no longer tints it before you confirm: "Cancel" used to leave an orphan highlight, with nothing on screen to say so.

### removed
- The setting that stood the pagination ribbon against the edge of the screen. It said "horizontal / vertical" one line away from the reading mode, which says the same thing about something else: you thought you were choosing how to read and you were moving the bar.

## [0.4.1] — 2026-08-03

### added
- Pinching the page with two fingers grows or shrinks the book text: the lines reflow instead of spilling off the screen, and the size you land on is the one in the settings.
- The sides of the page, which turn it on a tap, can now be switched off in the settings: the hand holding the device brushes the edge, and this is the one reader gesture you trigger without meaning to. Swiping, the chevrons and the arrow keys still turn the page.

### changed
- The download button on the home page now leads straight to the file that suits the visitor — the APK on an Android phone, the installer on Windows — instead of announcing Windows to everyone.

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
