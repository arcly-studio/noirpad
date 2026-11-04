# Changelog

All notable changes to NoirPad. Versions follow [Semantic Versioning](https://semver.org/).

## [1.0.2] – Unreleased

Security update of the bundled libraries. No new features; your notes and settings stay as they are.

### Security
- Updated DOMPurify to 3.4.17 and markdown-it to 15.0.3. Among other fixes, a specially crafted
  note can no longer slow down Markdown rendering.
- Updated starlette to 1.3.1, python-multipart to 0.0.31, anyio to 4.14.2, idna to 3.15,
  cryptography to 50.0.0 and setuptools to 84.1.0.

## [1.0.1] – 2026-10-27

Fixes from a second full review: nothing you type should be lost, and the app is faster, safer and
easier to use with a keyboard or screen reader.

### Safety of your notes
- Deleting a folder or note that is open in a tab first saves what you were typing, then closes
  the tabs of every deleted note; if the open note was among them, the start page is shown. No
  zombie tabs and no lost text.
- Clicking an already open tab or note no longer reloads it (that used to drop the last second of
  typing).
- A failed save is never discarded silently when you switch or close a tab, or close the window:
  NoirPad asks whether to discard the changes or stay on the note. In the desktop app the window
  waits for a save in progress.
- Renaming in the title belongs to the right note even when you switch with Ctrl+Tab, Ctrl+W or a
  click in the tree. A tag or an image goes into the note it was meant for, not into the one you
  switched to meanwhile.
- Ctrl+M while a note is still loading no longer overwrites anything.
- Two windows of the web version no longer silently overwrite each other: if a note changed
  elsewhere, you choose "Overwrite with mine" or "Keep, don't save". A hidden window no longer
  brings back older text.
- A full disk gives a clear message, the data file stays unchanged and no leftover temporary file
  remains. A snapshot error never blocks saving.
- A data file saved with a BOM (Notepad, PowerShell 5.1) is no longer treated as damaged; a
  hand-broken structure is repaired in memory.
- A tag longer than 100 characters or a 51st tag is reported instead of vanishing; if the server
  fails, the text stays in the field.
- Notes deleted in another window close their tabs here, and renames are picked up.
- Locking from another window while you have unsaved text asks for the password instead of
  reloading the page.
- Untouched notes are no longer saved again after loading.

### Security and privacy
- Importing a foreign backup or Markdown file (or exporting HTML) can no longer make Windows
  connect to a foreign network server through a crafted image name (leaked credentials hash,
  ~20 s freeze).
- Importing a backup with non-text tags is refused instead of breaking the tag list.
- The log no longer contains your Windows user name: profile paths are written as `~`.
- Old accounts and password hashes left from a long-ago data conversion are removed from disk,
  including from the backup made by that conversion.
- Unexpected server errors now also carry the security headers and the usual error format.
- Exporting a locked note as TXT or HTML is refused (like Markdown) instead of returning the
  encrypted envelope.
- A second NoirPad instance is blocked before any data migration runs.

### Accessibility
- Settings, Help, Shortcuts and the font picker are real dialogs for keyboard and screen readers:
  named, focus moves in and stays inside, and returns on close. The font list is a listbox
  (arrow keys).
- Help was rebuilt in the common window style: sections are tabs controlled by arrow keys, the
  close button has a name, and the shortcuts shown are your actual (remapped) ones.
- Focus is visible everywhere; the six switches in Settings have names.
- Muted text and the red danger colour reach 4.5:1 contrast in all 17 themes; the outline of a
  switched-off toggle reaches 3:1.
- With "reduce motion" the Matrix rain is only a still image.
- The confirmation of a dangerous action starts focused on Cancel.
- Pressing Delete on a tab keeps focus in the tab bar.

### Speed
- Backup and exports: a backup with 200 images went from ~20 s to ~2 s, "export all" from ~19 s to
  under 1 s, and TXT export of a large note from ~11 s to instant.
- Export, backup and encryption no longer block other requests.
- Notes with thousands of formats: opening 4.5 s → 0.3 s, saving 7.9 s → 0.6 s (6000 formats).
- A Markdown paragraph with ~80 000 lines now opens; long Markdown sources are highlighted after
  a pause in typing.
- Search across all notes waits for a pause in typing.
- Saving your own note no longer makes the next sync download all data again; start-up no longer
  writes the settings needlessly.

### Other fixes
- Trash: a note opened from the trash shows its title, tags and star are disabled (they used to
  fail silently), and after Restore (↩) it is editable at once. Clicking a note in the trash saves
  the open note first.
- Removing the filtered tag from the last note turns the filter off (it used to show "no matches").
- Right arrow on an open empty folder stays on the folder.
- Clear formatting: a code block no longer merges with the neighbouring text, and a link around an
  image is kept.
- Pasting HTML from the web always goes through NoirPad's cleaning.
- Locking or switching a Markdown note also clears its coloured source copy; only one scrollbar in
  Markdown mode.
- The lock icon in the tree appears only for really locked notes; the "Autosave off" text now says
  what is true; without Glow the "Glitch effect" switch is off, with an explanation.
- Web version: New note, Font and Insert image use Alt+Shift+N / T / I, because the browser takes
  Ctrl+Shift+N / T / I. The desktop app keeps its defaults and allows assigning both.
- Installer: a silent install (`/VERYSILENT`, winget, Store) also installs WebView2; the text about
  a non-empty folder no longer asks you to pick a folder that cannot be picked; copyright in the
  exe and installer; the name in Apps has no version.

### New app icon
- New logo: a dark rounded tile with two glass sheets and a blue `>_`. It replaces the light sheet
  with a tab everywhere: exe and installer icon, installer wizard image, browser favicon, web app
  icon (Apple touch icon, manifest), start page, Settings → About, the login page of the
  self-hosted version, README and the demo GIF.
- Icon URLs carry the version, so the browser does not show the old icon from its cache. Windows
  may keep showing the old icon for a while (system icon cache); this is not an error.

## [1.0.0] – 2026-10-20

First public release.

### Highlights
- Windows installer (per-user, no admin rights) with a WebView2 check, and a self-hostable web
  version.
- Notes and folders with tabs, tags, favorites and trash; rich-text or Markdown per note with live
  preview, task lists and syntax highlighting; 17 themes; customizable shortcuts.
- Password-locked notes (Fernet, PBKDF2-SHA256 480 000 iterations). The password is sent once to
  unlock; only the derived key is kept in memory while the note is open.
- Optional app lock (scrypt hash only; the server refuses every request until unlocked).
- English and Czech user interface.
- Export everything as Markdown (folders, images in `assets/`) or HTML; import Markdown files or
  ZIPs; full ZIP backup and restore.
- No account, no cloud, no telemetry; all fonts and libraries are bundled.

### Security and reliability (since the internal builds)
- Safe Markdown/rich-text rendering (markdown-it + DOMPurify), link allowlist, strict
  Content-Security-Policy, uploads limited to real PNG/JPEG/GIF/WebP images.
- Host-header check (DNS rebinding), CSRF protection, a random per-launch token in the desktop app.
- Atomic saves with rotating snapshots; a damaged data file is kept aside and the newest good
  snapshot restored; a safety copy before every backup import; zip-bomb limits.
- One NoirPad per data folder (no lost writes from two instances).
- Unreferenced images are moved to `images/.trash` after 24 h and deleted after 30 days.
- A log file (`%LOCALAPPDATA%\NoirPad\logs\noirpad.log`) and clear messages instead of silent
  crashes at start-up.
- The local server uses fixed components (h11, no WebSockets) instead of uvicorn's "auto"
  detection; if it fails to start, NoirPad says so at once in a single message and exits.
- An upgrade replaces the whole program folder (`_internal`); files from an older build can no
  longer be picked up by the new one.
- Every build is smoke-tested: the packed `NoirPad.exe` must start and answer before an installer
  is made.

### From the release test of the installer
- Uninstalling removes the whole program folder. Before, an uninstall started while NoirPad was
  still shutting down (a few seconds after its window closed) could not delete the locked
  `NoirPad.exe`, `python314.dll` and libraries and left them behind. NoirPad now holds its
  installer mutex until the process has really ended, and Setup/Uninstall wait for (and, if
  needed, close) programs running from the install folder and NoirPad's WebView2 processes.
  Notes in `%LOCALAPPDATA%\NoirPad` are still deleted only when you answer Yes.
- The installer passes its language to NoirPad (`%LOCALAPPDATA%\NoirPad\install-language.txt`).
  It is used while Settings → Language is "Automatic" (the default, nothing picked); a language
  chosen in Settings always wins and is never overwritten.
- The minimum password length for the app lock and for locked notes is now 4 characters (was 8).
  When locking a note with fewer than 8 characters NoirPad shows a hint that short passwords are
  easy to crack; it does not block saving.
- NoirPad's own dialogs replace every browser `prompt()`, `confirm()` and `alert()` (no more
  "127.0.0.1 says", always in the UI language): Enter confirms, Escape cancels, the name field
  is focused and checked (not empty, at most 300 characters), and actions that cannot be undone
  get a red button. Rename starts with the current name.
- Note and folder names may contain any character. Exports fix up only the file names: the
  characters Windows forbids (`\ / : * ? " < > |`) become `-`, trailing dots and spaces are
  dropped and reserved names (CON, NUL, COM1 …) get a `-`, so "Re: porada?" is exported as
  `Re- porada-.md`.
- Trash in the sidebar: Restore (↩) and Delete permanently (×) are real buttons with a 32×32 px
  target, a tooltip and a screen-reader label; delete is red and asks first. The trash header
  has an "Empty trash" button (also with a confirmation).
- Favorites stay in their folder: inside every folder (and at the top level) the sidebar shows
  subfolders first, then favorite notes, then the other notes, each group in your own order. A
  favorite note no longer jumps above the folders. Favorite folders come first among folders.
- Desktop app: exports (Markdown ZIP, TXT, HTML, HTML ZIP) and the ZIP backup open a native
  "Save as" dialog with the file name filled in; NoirPad writes the file itself and shows "Saved"
  with an "Open folder" button. Edge's "Downloads" panel no longer appears; Cancel does nothing.
  The web/self-hosted version still downloads through the browser. PDF stays in the print dialog
  ("Save as PDF").
- Because uninstalling removes the whole install folder, Setup refuses an existing folder that
  already holds other files (empty folders and earlier NoirPad installs are fine).
- New logo (a dark page with a blue `>_` prompt) everywhere: the app and installer icon, the
  installer wizard, the browser tab (favicon, SVG icon, Apple touch icon, web manifest), the
  welcome screen, Settings → About, the password page of the self-hosted version and the README.
  The sources are in `docs/brand/`.
- The image viewer, Ctrl+wheel resizing and the picture styles apply only to pictures in a note;
  the logo and other interface images cannot be clicked, dragged or highlighted.

### From the deep review before release
- Switching notes quickly can no longer save one note's text under another note.
- Switching an unlocked locked note to Markdown (`Ctrl+M`) kept it encrypted only in memory and
  saved it as plain text; it now stays encrypted, and the server refuses to overwrite a locked
  note with plain text.
- Auto-lock and opening a locked note no longer leave Markdown text visible on screen.
- Emptying the trash no longer deletes an image that another note still shows.
- A long note typed into just before closing the window is saved (the desktop app saves first,
  then closes; text is also saved one second after you stop typing).
- The status bar counts characters and words in Markdown mode; a failed save is reported.
- Restoring a backup checks it first: malformed, damaged or password-protected archives and
  oversized images are refused without touching your notes.
- HTML exports include the note's images. A note in the trash can be opened read-only and
  restored from there; restored favorites keep their star.
- Search ignores accents and letter case (`cestina` finds `Čeština`).
- Readable secondary text in every theme, Matrix rain no longer runs under the note title, `F11`
  toggles full screen, guessing a note's password is rate-limited.
- Clicking anywhere on a folder row opens or closes it.
- Smaller fixes: shortcuts no longer act behind Settings or Help, `:matrix` really toggles,
  `Ctrl+Shift+E` wraps the selection in a code block, drag and drop refuses impossible targets,
  tags are de-duplicated, cut-off image uploads are refused.
- The installer always installs to `%LOCALAPPDATA%\Programs\NoirPad` (no folder page).

### From the manual test of the installer
- Pasting from a web page, Word or Google Docs into a formatted note keeps only the structure:
  paragraphs, headings, list items (as `•` / `1.` lines), bold, italic, underline, strike-through,
  links (http/https/mailto) and NoirPad's own pictures. Colours, backgrounds, fonts and sizes of
  the source are dropped, so pasted text no longer shows up black on white (invisible on dark
  themes). Text is bold only where the source marks it bold, not because of the page around it.
- Bold, strike-through and links now survive saving and reopening a formatted note. A link in a
  note opens with Ctrl+click; a plain click places the cursor.
- `Ctrl+Shift+V` pastes plain text.
- New "Clear formatting" (`Ctrl+Space`, `:clearformat`, right-click on a selection): removes
  colour, background, font and size from the selected text and keeps bold, italic, underline,
  strike-through and links. For notes that already contain pasted black text. Right-click on a
  selection opens NoirPad's menu (cut, copy, paste, paste as plain text, clear formatting);
  Shift+right-click, or right-click without a selection, keeps the system menu with spelling
  suggestions.
- Settings → Editor → Spellcheck (on by default) now covers the Markdown source too, not only the
  formatted editor.

### New look ("G – Noir čistý") and start page
- New start page (shown when no note is open): a narrow column with the logo, NOIRPAD,
  "your dark notebook · v<version>", the actions New note / New folder / Search notes / Commands
  with their shortcuts (remapped keys are shown as remapped), a RECENT list and an "F1 help"
  hint. Arrow keys move between the rows, Enter runs one.
- RECENT shows the last 3 opened notes (★ for favorites, a lock for locked notes, "today" /
  "yesterday" / date). It is stored in the new setting `recent_notes` (up to 10 entries) and
  survives "Reset settings".
- Search in all notes from the sidebar search box or `Ctrl+Shift+K`.
- Settings → Noir effects: glow, Matrix rain and CRT, each switchable. They are off by default;
  existing installs keep the look they had.
- Markdown source is coloured: plain text, with headings, markup and code in the accent colour.
- Single-row top bar (title, tabs, icon buttons) with Export and ⋯ menus (Export includes Markdown of just the current note).
- Right-click a note or folder to rename, move (Move to…) or delete it; the note tree and the tabs
  can be used from the keyboard (arrow keys, Enter).
- Sidebar split into NOTES and TAGS; TAGS shows the 6 most used tags plus "+ N more", can be
  collapsed by its heading (state is remembered) and always shows the active filter.
- Note title is renamed in place, tags sit under it; editor and preview have no frames; status bar
  shows saved / not saved.
- One window style for dialogs, menus, command bar, Settings, Help and toasts; the interface font
  (default JetBrains Mono) is also used for Settings selects and buttons.
- Switched-off toggles are neutral grey, switched-on ones use the accent colour.
- Text and icon contrast verified in all 17 themes (fixed muted text in Dracula, Nord and
  Tokyo Night).

### Fixes after the new look
- After closing the last tab with a Markdown note the source stayed visible instead of the start
  page.
- Unsaved typing in the last tab is saved when that tab is closed.
- Narrow window (up to 900 px): the saved / not saved dot stays visible, so a save error is not
  hidden.
- A backup restored after a damaged data file also gets the Noir effects migration.

### Project
- NoirPad is published by Arcly Studio: the repository moved to
  [github.com/arcly-studio/NoirPad](https://github.com/arcly-studio/NoirPad), the installer and
  `NoirPad.exe` name Arcly Studio as publisher, and the start page and About link to the project
  page ("by Arcly Studio").

[1.0.2]: https://github.com/arcly-studio/NoirPad/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/arcly-studio/NoirPad/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/arcly-studio/NoirPad/releases/tag/v1.0.0
