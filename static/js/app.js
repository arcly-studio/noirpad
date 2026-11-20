/* app.js - NoirPad main entry point */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* N1.11 test, finding 6: never "Loading..." without a word. After
       NP.app.slowStartMs the splash says that the start takes unusually
       long (the desktop window also ends a start that never finishes,
       desktop.py). */
    NP.app = {
        slowStartMs: 15000,

        init: function () {
            var slow = setTimeout(function () {
                var sub = document.getElementById("splash-subtitle");
                if (sub && document.getElementById("splash-overlay")) sub.textContent = NP.t("app.startSlow");
            }, NP.app.slowStartMs);
            /* Version + project URL for About / welcome (one source:
               noirpad/__version__.py). Not critical: start without it. */
            var info = NP.api.version().catch(function () { return {}; });
            return Promise.all([NP.state.init(), info]).then(function (res) {
                NP.appInfo = res[1] || {};
                NP.themes.apply(NP.state.data.theme || "matrix");

                /* Initialize modules */
                if (NP.settings && NP.settings.init) NP.settings.init();
                if (NP.appLock && NP.appLock.init) NP.appLock.init();
                /* Settings v2: apply persisted runtime state (matrix rain,
                   shortcut hints, spellcheck, page orientation) now that
                   NP.state.data is loaded. */
                if (NP.settings && NP.settings.applyRuntimeState) {
                    NP.settings.applyRuntimeState();
                }
                if (NP.editor && NP.editor.init) NP.editor.init();
                if (NP.images && NP.images.init) NP.images.init();
                /* After images.js: an image paste is taken there first. */
                if (NP.paste && NP.paste.init) NP.paste.init();
                if (NP.topbar && NP.topbar.init) NP.topbar.init();
                /* cursor.js disabled while debugging "dot" report */
                /* if (NP.cursor && NP.cursor.init) NP.cursor.init(); */

                if (NP.tree && NP.tree.render) {
                    NP.tree.render();
                }

                if (NP.splash && NP.splash.show) {
                    NP.splash.show();
                }

                NP.app.bindKeys();
                NP.app.bindButtons();
                /* Registrations done above; now load custom mappings
                   (state is loaded) and attach the single dispatcher. */
                if (NP.shortcuts && NP.shortcuts.init) NP.shortcuts.init();
                if (NP.tree && NP.tree.refreshSearchKeys) NP.tree.refreshSearchKeys();
                /* Manager UI — after core shortcuts (needs the registry). */
                if (NP.shortcutsManager && NP.shortcutsManager.init) {
                    NP.shortcutsManager.init();
                }
                /* Auto-lock: reads idle_lock_minutes + arms the timer. */
                if (NP.autoLock && NP.autoLock.init) NP.autoLock.init();
                NP.state.startPolling();

                if (NP.editor && NP.editor.showWelcome) {
                    NP.editor.showWelcome({ focus: true });
                }
                clearTimeout(slow);
                /* The desktop window waits for this (desktop.py _watch_start). */
                if (NP.api.pageReady) NP.api.pageReady();
            }).catch(function (err) {
                clearTimeout(slow);
                console.error("NoirPad init failed:", err);
                /* Hide splash and surface the error so the user isn't stuck on "Loading..." */
                var splash = document.getElementById("splash-overlay");
                if (splash) {
                    var sub = document.getElementById("splash-subtitle");
                    if (sub) sub.textContent = NP.t("app.startFailed", { error: err && err.message ? err.message : err });
                    setTimeout(function () {
                        if (splash.parentNode) splash.parentNode.removeChild(splash);
                    }, 3000);
                }
            });
        },

        bindKeys: function () {
            /* ---- Migrated to the central shortcut registry ----
               Behaviour-preserving: each handler does exactly what the
               old hardcoded branch did. The dispatcher (shortcuts.js)
               preventDefaults on a match unless the handler returns
               `false` (passthrough) — used by `delete` so typing still
               deletes text in the editor. */
            var S = NP.shortcuts;
            /* Bold, italic, underline, strikethrough, link: one key for
               rich-text and Markdown notes (format.js). */
            if (NP.format && NP.format.init) NP.format.init();
            if (S && S.register) {
                S.register("save", function () {
                    if (NP.editor && NP.editor.save) NP.editor.save();
                });
                S.register("find", function () {
                    if (NP.search && NP.search.toggle) NP.search.toggle();
                });
                S.register("find-next", function () {
                    if (NP.search && NP.search.next) NP.search.next();
                });
                S.register("find-prev", function () {
                    if (NP.search && NP.search.prev) NP.search.prev();
                });
                S.register("insert-image", function () {
                    var b = document.getElementById("btn-insert-image");
                    if (b) b.click();
                });
                S.register("clear-formatting", function () {
                    /* Only with the rich-text editor in use; else passthrough. */
                    if (!NP.paste || !NP.paste.clearFormatting) return false;
                    var a = document.activeElement;
                    if (!a || a.id !== "editor") return false;
                    return NP.paste.clearFormatting();
                });
                S.register("toggle-markdown", function () {
                    if (NP.markdown && NP.markdown.toggleForCurrentNote) {
                        NP.markdown.toggleForCurrentNote();
                    }
                });
                S.register("new-folder", function () {
                    var b = document.getElementById("btn-new-folder");
                    if (b) b.click();
                });
                S.register("new-note", function () {
                    var b = document.getElementById("btn-new-note");
                    if (b) b.click();
                });
                S.register("delete", function () {
                    /* Original guard: while an input/contenteditable is
                       focused, do nothing and let the browser delete text
                       (return false = no preventDefault / passthrough). */
                    var a = document.activeElement;
                    var isInput = a && (a.tagName === "INPUT" ||
                        a.tagName === "TEXTAREA" || a.isContentEditable);
                    if (isInput) return false;
                    /* A focused tab closes itself with Delete (tabs.js). */
                    if (a && a.closest && a.closest("#tab-bar")) return false;
                    if (NP.tree && NP.tree.deleteSelected) {
                        NP.tree.deleteSelected(NP.tree.focusedId());
                    }
                });
                S.register("rename", function () {
                    if (NP.tree && NP.tree.renameSelected) {
                        NP.tree.renameSelected(NP.tree.focusedId());
                    }
                });
                S.register("toggle-favorite", function () {
                    var b = document.getElementById("btn-favorite");
                    if (b) b.click();
                    else if (NP.favorites && NP.favorites.toggle) {
                        NP.favorites.toggle();
                    }
                });
                S.register("toggle-lock", function () {
                    var b = document.getElementById("btn-lock");
                    if (b) b.click();
                });
                S.register("toggle-sidebar", function () {
                    if (NP.focusMode && NP.focusMode.toggle) {
                        NP.focusMode.toggle();
                    }
                });
                S.register("toggle-orientation", function () {
                    if (NP.settings && NP.settings.toggleOrientation) {
                        NP.settings.toggleOrientation();
                    }
                });
                S.register("open-settings", function () {
                    if (NP.settings && NP.settings.open) NP.settings.open();
                });
                S.register("open-help", function () {
                    if (NP.help && NP.help.show) NP.help.show();
                });
                S.register("open-command-palette", function () {
                    if (NP.commandBar && NP.commandBar.toggle) {
                        NP.commandBar.toggle();
                    }
                });
                S.register("find-all", function () {
                    if (NP.findAll && NP.findAll.show) NP.findAll.show("");
                });
                S.register("open-font-picker", function () {
                    if (NP.fontPicker && NP.fontPicker.show) {
                        NP.fontPicker.show();
                    }
                });
                S.register("fullscreen", function () {
                    if (NP.fullscreen && NP.fullscreen.toggle) {
                        NP.fullscreen.toggle();
                    }
                });
                S.register("next-tab", function () {
                    if (NP.tabs && NP.tabs.next) NP.tabs.next();
                });
                S.register("prev-tab", function () {
                    if (NP.tabs && NP.tabs.prev) NP.tabs.prev();
                });
                S.register("close-tab", function () {
                    if (NP.tabs && NP.tabs.closeCurrent) {
                        NP.tabs.closeCurrent();
                    }
                });
            }

            /* NOT migrated (per spec): Escape overlay-close priority +
               undo/redo. These are not in the
               registry, so the central dispatcher ignores them and this
               (bubble-phase) listener handles them exactly as before. */
            document.addEventListener("keydown", function (e) {
                var key = e.key;
                var ctrl = e.ctrlKey || e.metaKey;
                var shift = e.shiftKey;

                if (key === "Escape") {
                    if (NP.commandBar && NP.commandBar.visible && NP.commandBar.close) {
                        NP.commandBar.close();
                    } else if (NP.search && NP.search.visible && NP.search.hide) {
                        NP.search.hide();
                    }
                    return;
                }

                if (ctrl && !shift && key === "z") {
                    if (NP.editor && NP.editor.undo) {
                        e.preventDefault();
                        NP.editor.undo();
                    }
                    return;
                }

                if (ctrl && !shift && key === "y") {
                    if (NP.editor && NP.editor.redo) {
                        e.preventDefault();
                        NP.editor.redo();
                    }
                    return;
                }
            });
        },

        /* Rename a note and update the tree and its tab. */
        renameNote: function (noteId, name) {
            return NP.api.rename(noteId, name).then(function () {
                var item = NP.editor._findItemInTree(NP.state.data.tree, noteId);
                if (item) item.name = name;
                var title = NP.$("#note-title-input");
                if (title && NP.state.currentNoteId === noteId && document.activeElement !== title) {
                    title.value = name;
                }
                var tabs = NP.state.openTabs || [];
                for (var i = 0; i < tabs.length; i++) {
                    if (tabs[i].id === noteId) tabs[i].name = name;
                }
                if (NP.tree && NP.tree.render) NP.tree.render();
                if (NP.tabs && NP.tabs.render) NP.tabs.render();
            });
        },

        bindButtons: function () {
            /* Title input — readonly until a note is selected. Click the
               name to rename it in place: Enter or leaving the field keeps
               it, Escape (or an empty name) goes back to the old one. */
            var titleInput = NP.$("#note-title-input");
            if (titleInput) {
                titleInput.readOnly = true;
                titleInput.addEventListener("focus", function () {
                    titleInput._npBefore = titleInput.value;
                    /* The rename belongs to this note, whatever is open by
                       the time the field loses focus (E3). */
                    titleInput._npNoteId = NP.state.currentNoteId;
                });
                titleInput.addEventListener("keydown", function (e) {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        titleInput.blur();
                    } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        titleInput.value = titleInput._npBefore;
                        titleInput.blur();
                    }
                });
                titleInput.addEventListener("blur", function () {
                    var before = titleInput._npBefore;
                    var name = titleInput.value.trim();
                    var noteId = titleInput._npNoteId;
                    titleInput._npNoteId = null;
                    if (noteId !== NP.state.currentNoteId) {
                        /* Another note is open already: rename the one the
                           text was typed for, the field shows the new note. */
                        if (name && name !== before && noteId && !titleInput.readOnly) {
                            NP.app.renameNote(noteId, name).catch(NP.dialog.failed);
                        }
                        return;
                    }
                    if (!name) titleInput.value = before || "";
                    if (!name || name === before || !noteId || titleInput.readOnly) return;
                    titleInput.value = name;
                    NP.app.renameNote(noteId, name).catch(function (err) {
                        if (NP.state.currentNoteId === noteId) titleInput.value = before;
                        NP.dialog.failed(err);
                    });
                });
            }

            /* Sidebar buttons */
            var btnNewFolder = NP.$("#btn-new-folder");
            if (btnNewFolder) {
                btnNewFolder.addEventListener("click", function () {
                    NP.dialog.prompt(NP.t("tree.promptFolderName"), {
                        title: NP.t("dialog.newFolderTitle"),
                        okLabel: NP.t("dialog.create")
                    }).then(function (name) {
                        if (!name) return;
                        if (NP.tree) NP.tree.tagFilter = null;    /* show the new folder */
                        return NP.api.newFolder(null, name).then(function () {
                            return NP.state.init();
                        }).then(function () {
                            NP.tree.render();
                        });
                    }).catch(NP.dialog.failed);
                });
            }

            var btnNewNote = NP.$("#btn-new-note");
            if (btnNewNote) {
                btnNewNote.addEventListener("click", function () {
                    /* The parent is decided now, before the dialog takes focus. */
                    var parentId = (NP.tree && NP.tree.getNewItemParentId)
                        ? NP.tree.getNewItemParentId() : null;
                    NP.dialog.prompt(NP.t("tree.promptNoteName"), {
                        title: NP.t("dialog.newNoteTitle"),
                        okLabel: NP.t("dialog.create")
                    }).then(function (name) {
                        if (!name) return;
                        if (NP.tree) NP.tree.tagFilter = null;    /* show the new note */
                        return NP.api.newNote(parentId, name).then(function (res) {
                            /* Make the new note visible inside its folder */
                            if (parentId && NP.state.setFolderOpenState) {
                                NP.state.setFolderOpenState(parentId, true);
                            }
                            return NP.state.init().then(function () {
                                NP.tree.render();
                                if (res && res.id) {
                                    /* Use tabs.add (which delegates to
                                       tabs.activate → save current →
                                       loadNote new). Calling
                                       editor.loadNote here too caused a
                                       race: it bumped _currentNoteId to
                                       the new id, then tabs.activate's
                                       save() wrote the PREVIOUS textarea
                                       content under the NEW id — content
                                       bleeding. */
                                    var loaded;
                                    if (NP.tabs) {
                                        /* Resolves once the new note is
                                           loaded (false: the user stayed
                                           on a note that could not be saved). */
                                        loaded = NP.tabs.add(res.id, name);
                                    } else {
                                        loaded = NP.editor.loadNote(res.id);
                                    }
                                    /* Settings v2: default_encrypted — after the
                                       note is loaded (so currentNoteId is set and
                                       editor state is ready), prompt to encrypt.
                                       Cancel inside NP.encryption.encrypt() leaves
                                       the note plain — we never delete it. */
                                    var defEnc = NP.state.data &&
                                        NP.state.data.default_encrypted === true;
                                    if (defEnc && NP.encryption && NP.encryption.encrypt) {
                                        var after = loaded && loaded.then
                                            ? loaded : Promise.resolve();
                                        after.then(function (opened) {
                                            if (opened === false || NP.state.currentNoteId !== res.id) return;
                                            NP.encryption.encrypt();
                                        });
                                    }
                                }
                            });
                        });
                    }).catch(NP.dialog.failed);
                });
            }

            /* Rename / delete / move: right-click in the tree (tree.js);
               backup: the ⋯ menu (topbar.js). */

            /* Search across all notes (the field above the tree). */
            var sideSearch = NP.$("#sidebar-search");
            if (sideSearch) {
                sideSearch.addEventListener("click", function () {
                    if (NP.findAll && NP.findAll.show) NP.findAll.show("");
                });
            }

            /* Top-bar tools (help, font, settings, focus mode and export
               live in the Export / ⋯ menus, topbar.js). */
            var btnFavorite = NP.$("#btn-favorite");
            if (btnFavorite) {
                btnFavorite.addEventListener("click", function () {
                    if (NP.favorites && NP.favorites.toggle) NP.favorites.toggle();
                });
            }

            var btnLock = NP.$("#btn-lock");
            if (btnLock) {
                btnLock.addEventListener("click", function () {
                    if (NP.encryption && NP.encryption.handleLockButtonClick) {
                        NP.encryption.handleLockButtonClick();
                    }
                });
            }

            var btnInsertImage = NP.$("#btn-insert-image");
            if (btnInsertImage) {
                btnInsertImage.addEventListener("click", function () {
                    /* Clicking the toolbar button blurs the editor, so
                       capture the cursor position before the dialog opens.
                       NP.images.upload restores it when inserting. */
                    if (NP.images && NP.images.saveSelection) {
                        NP.images.saveSelection();
                    }
                    var input = document.createElement("input");
                    input.type = "file";
                    input.accept = "image/*";
                    input.onchange = function () {
                        if (input.files[0] && NP.images && NP.images.upload) {
                            NP.images.upload(input.files[0]);
                        }
                    };
                    input.click();
                });
            }

            /* Autosave: Settings → Editor (and :autosave). */
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        // Auth gate runs first: it pings /api/auth/me, then either calls
        // NP.app.init() (already authed) or renders the login overlay
        // and calls NP.app.init() after a successful login.
        if (NP.auth && NP.auth.start) {
            NP.auth.start();
        } else {
            NP.app.init();
        }
    });

})(window.NP);
