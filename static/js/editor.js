/* editor.js - NoirPad rich text editor */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Marker grammar:
         <<IMG:filename>>              — plain image
         <<IMG:filename|w=NNN>>        — image with persisted zoom width
       The width capture is optional (Ctrl+wheel zoom feature). */
    var IMG_MARKER_RE = /<<IMG:([^|>]+)(?:\|w=(\d+))?>>/g;

    function findItemById(tree, id) {
        for (var i = 0; i < tree.length; i++) {
            if (tree[i].id === id) return tree[i];
            if (tree[i].children) {
                var found = findItemById(tree[i].children, id);
                if (found) return found;
            }
        }
        return null;
    }

    function countAllItems(tree, type) {
        var count = 0;
        for (var i = 0; i < tree.length; i++) {
            if (!type || tree[i].type === type) count++;
            if (tree[i].children) count += countAllItems(tree[i].children, type);
        }
        return count;
    }

    NP.editor = {
        el: null,
        _autosaveTimer: null,
        /* id + text + formats of the last successful save: a silent save
           of an unchanged note is skipped (no file write, no new data
           version for other windows to reload). */
        _lastSavedKey: null,
        _currentNoteId: null,
        /* Whether the note currently loaded in the editor is stored
           encrypted on the server. Derived from the FRESHLY fetched
           content in loadNote (NP.state.data is only refreshed by the
           5s poll, so it can't be trusted right after encrypt/decrypt).
           Combined with _unlockToken this gives the 3 lock
           states: plain / encrypted+unlocked / encrypted+locked. */
        _currentNoteEncrypted: false,

        /* Unlock token of the open encrypted note (see encryption.js).
           The password itself is never kept in the page. */
        _unlockToken: null,
        _lastSave: null,

        /* Leaving an unlocked note: tell the server to forget its key —
           after the last save, so the save doesn't race the lock. */
        _forgetUnlock: function () {
            var token = NP.editor._unlockToken;
            if (!token) return;
            NP.editor._unlockToken = null;
            Promise.resolve(NP.editor._lastSave).catch(function () {}).then(function () {
                return NP.api.lock(token);
            }).catch(function () { /* key expires on its own */ });
        },

        /* Re-sync the #btn-lock label/title with the current note's
           lock state. Safe to call before encryption.js is wired. */
        _refreshLockButton: function () {
            if (NP.encryption && NP.encryption.updateLockButtonState) {
                NP.encryption.updateLockButtonState();
            }
        },

        init: function () {
            NP.editor.el = NP.$("#editor");
            if (!NP.editor.el) return;

            /* Typing = "not saved" until the next save. */
            NP.editor.el.addEventListener("input", function () {
                NP.editor._setSaveStatus("dirty");
            });

            /* Input event for char count */
            NP.editor.el.addEventListener("input", NP.debounce(function () {
                NP.editor.updateCharCount();
            }, 300));

            /* Save shortly after typing stops, like the Markdown textarea
               below. The unload flush (keepalive) cannot carry more than
               64 kB, so a long note must not wait for it (K5). */
            NP.editor.el.addEventListener("input", NP.debounce(function () {
                NP.editor.save(true);
            }, 1000));

            /* Glitch typing — fires CSS RGB-shift on rapid input */
            NP.editor.el.addEventListener("input", function () {
                if (NP.effects && NP.effects.onEditorInput) NP.effects.onEditorInput();
            });

            /* MD textarea: dirty-flag + per-keystroke autosave debounce.
               The 30s interval autosave was the only safety net; if the
               user typed and closed the tab within that window, the
               textarea contents never reached the backend. */
            var ta = document.getElementById("editor-md");
            if (ta) {
                ta.addEventListener("input", function () {
                    if (NP.markdown && NP.markdown.isActive && NP.markdown.isActive()) {
                        NP.editor._setSaveStatus("dirty");
                    }
                });
                ta.addEventListener("input", NP.debounce(function () {
                    if (NP.markdown && NP.markdown.isActive &&
                        NP.markdown.isActive()) {
                        NP.editor.save(true);
                    }
                }, 800));
                ta.addEventListener("input", NP.debounce(function () {
                    NP.editor.updateCharCount();
                }, 300));
            }

            /* Flush the in-flight note on tab close / navigation.
               pagehide fires reliably on mobile + desktop; keepalive
               keeps the request alive after unload. Leaving the page
               also makes the server forget an unlocked note's key. */
            window.addEventListener("pagehide", function () {
                NP.editor._flushBeacon(true);
            });
            /* visibilitychange → hidden also catches mobile background
               switches where pagehide may be delayed. */
            document.addEventListener("visibilitychange", function () {
                if (document.visibilityState === "hidden") {
                    NP.editor._flushBeacon(false);
                }
            });

            /* Keyboard shortcuts (Ctrl+S/I/U) are handled globally in app.js;
               attaching them here too caused double-fire (save twice, format toggled twice). */

            /* Paste-to-upload is handled in images.js. */
        },

        /* Best-effort persist on unload. An unlocked encrypted note is
           saved with its unlock token (lock_after when the page is going
           away); a locked one is never written.

           Uses fetch(..., {keepalive:true}) instead of sendBeacon
           because sendBeacon can't send the API headers and is POST-only.
           keepalive has the same ~64KB body limit. */
        _flushBeacon: function (leaving) {
            var id = NP.editor._currentNoteId;
            if (!id || NP.editor._loadedNoteId !== id) return;
            /* Only hidden, and a save is on its way: that one stores it. */
            if (!leaving && NP.editor._saving) return;
            var token = NP.editor._unlockToken;
            if (NP.editor._currentNoteEncrypted && !token) return;
            var mdActive = NP.markdown && NP.markdown.isActive &&
                NP.markdown.isActive();
            var text;
            var formats;
            if (mdActive) {
                text = NP.markdown.getRawText();
                formats = [];
            } else {
                if (!NP.editor.el || NP.editor.el.contentEditable !== "true") {
                    return;
                }
                text = NP.editor._htmlToTextWithImages().text;
                formats = NP.editor._extractFormats();
            }
            var plainKey = id + "\u0000" + text + "\u0000" + JSON.stringify(formats);
            /* Nothing typed since the last save: nothing to write (E8) —
               and a hidden window never puts back an older text (R6). A
               locked note still goes: lock_after makes the server forget its key. */
            if (!NP.editor._currentNoteEncrypted && plainKey === NP.editor._lastSavedKey) return;
            try {
                var url = "/api/note/" + encodeURIComponent(id);
                var method = "PUT";
                var payload = { content: text, formats: formats };
                /* R6: changed elsewhere meanwhile → 409, never overwritten. */
                if (NP.editor._rev) payload.base_rev = NP.editor._rev;
                if (NP.editor._currentNoteEncrypted) {
                    url = "/api/save-encrypted";
                    method = "POST";
                    payload = { id: id, unlock_token: token, content: text,
                        formats: formats, lock_after: !!leaving };
                    if (leaving) NP.editor._unlockToken = null;
                }
                NP.api.fetch(url, {
                    method: method,
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                    keepalive: true
                }).then(function (res) {
                    /* The page is still here (only hidden): this is what is
                       stored now. */
                    if (!res || !res.ok || method !== "PUT") return;
                    return res.json().then(function (j) {
                        if (NP.editor._currentNoteId !== id) return;
                        if (j && j.rev) NP.editor._rev = j.rev;
                        NP.editor._lastSavedKey = plainKey;
                    });
                }).catch(function () {
                    /* unload — request may or may not have left;
                       nothing to do either way. */
                });
            } catch (e) { /* unload — nothing we can do */ }
        },

        /* Desktop app: desktop.py calls this when the window is closed and
           waits for it, so even a note above the 64 kB keepalive limit is
           stored (K5). Resolves "close" once the note is stored (or the
           user chose to discard what could not be saved), "stay" when the
           user keeps the window open (R2). While this runs, _closeBusy
           tells desktop.py not to give up waiting. */
        _closeBusy: false,

        flushForClose: function () {
            NP.editor._closeBusy = "saving";
            return NP.editor.leave().then(function (go) {
                NP.editor._closeBusy = false;
                return go ? "close" : "stay";
            }, function () {
                NP.editor._closeBusy = false;
                return "close";
            });
        },

        /* ---- Note loading ---- */

        /* Back to the text of the open note (Markdown: its source). */
        focusText: function () {
            var md = NP.markdown && NP.markdown.isActive && NP.markdown.isActive();
            var target = md ? document.getElementById("editor-md") : NP.editor.el;
            if (target && target.focus) target.focus();
        },

        /* opts.focus === false: the keyboard stays where it is (T4). */
        loadNote: function (id, opts) {
            var focus = !(opts && opts.focus === false);
            /* A rename typed into the title belongs to the note being left. */
            var title = NP.$("#note-title-input");
            if (title && document.activeElement === title) title.blur();

            /* Stop the previous note's autosave FIRST. Without this,
               a timer fire after _currentNoteId is reassigned but
               before the fetch resolves would save the previous
               note's textarea content under the NEW note's id. */
            NP.editor.stopAutosave();
            NP.editor._forgetUnlock();

            NP.editor._currentNoteId = id;
            NP.editor._trashedId = null;
            NP.editor._rev = null;
            NP.editor._conflictHold = null;
            document.body.classList.remove("np-no-note");
            NP.state.currentNoteId = id;
            /* Until this note's content is in the editor, the editor still
               shows the previous note: nothing may be saved (K1). */
            NP.editor._loadedNoteId = null;

            /* Sidebar highlight follows whichever note is open,
               regardless of how it was opened (tree click, tab,
               +Note, command bar). Single funnel here keeps the
               selection in sync without sprinkling calls into
               every caller. */
            if (NP.tree && NP.tree.setSelected) {
                NP.tree.setSelected(id);
            }

            /* Set title from tree data */
            var titleInput = NP.$("#note-title-input");
            if (titleInput) {
                var item = NP.editor._findItemInTree(NP.state.data.tree, id);
                titleInput.value = item ? item.name : "";
                titleInput.readOnly = false;
            }

            return NP.api.getNote(id).then(function (data) {
                /* The user opened another note meanwhile: this answer is stale. */
                if (!NP.editor.el || NP.editor._currentNoteId !== id) return;

                var content = data.content || "";
                var formats = data.formats || [];
                NP.editor._rev = data.rev || null;      /* R6 */

                /* Mirror the server's mode into state so toggles + the MD
                   button stay in sync without a separate fetch. */
                if (data.mode !== undefined &&
                    NP.state && NP.state.data) {
                    NP.state.data.note_modes = NP.state.data.note_modes || {};
                    if (data.mode === "markdown") {
                        NP.state.data.note_modes[id] = "markdown";
                    } else {
                        delete NP.state.data.note_modes[id];
                    }
                }

                /* Check if note is encrypted */
                var isEncrypted = NP.isEncryptedEnvelope(content);

                NP.editor._currentNoteEncrypted = isEncrypted;

                /* A note in the trash: shown read-only, never saved (D8). */
                if (data.trashed) {
                    NP.editor._showTrashed(id, isEncrypted ? null : content);
                    return;
                }

                if (isEncrypted) {
                    NP.editor.stopAutosave();
                    /* Show the lock screen while the password dialog is
                       up, so the previous note never stays visible. */
                    NP.editor._showLockScreen();
                    NP.editor._refreshLockButton();
                    /* Unlock for viewing (file stays encrypted). The page
                       keeps only the unlock token, never the password. */
                    return NP.encryption.askAndUnlock(id).then(function (decData) {
                        if (!decData) return;  /* cancelled — STATE C */
                        if (!NP.editor.el || NP.editor._currentNoteId !== id) {
                            /* User moved on meanwhile: don't keep the key. */
                            NP.api.lock(decData.unlock_token).catch(function () {});
                            return;
                        }
                        NP.editor._unlockToken = decData.unlock_token;
                        if (NP.welcome) NP.welcome.noteOpened(id);   /* RECENT, only once unlocked */

                        var decContent = decData.content || "";
                        var decFormats = decData.formats || [];
                        if (NP.encryption.noteOpened) NP.encryption.noteOpened(id, decContent);

                        NP.editor.el.contentEditable = "true";
                        NP.editor.el.style.opacity = "1";
                        NP.editor.renderContent(NP.editor.el, decContent, decFormats);
                        if (focus) NP.editor.el.focus();
                        NP.editor.updateCharCount();
                        NP.editor.startAutosave();
                        if (NP.tags && NP.tags.render) NP.tags.render();
                        /* STATE B: encrypted + unlocked */
                        NP.editor._refreshLockButton();
                        if (NP.markdown && NP.markdown.applyForLoadedNote) {
                            NP.markdown.applyForLoadedNote(id, decContent);
                        }
                        NP.editor._loadedNoteId = id;
                        NP.editor._lastSavedKey = NP.editor._contentKey();   /* E8, see below */
                        NP.editor._saveState = null;      /* just loaded = saved */
                        NP.editor.updateCharCount();   /* Markdown: count the source (D1) */
                    }).catch(function (err) {
                        NP.dialog.alert(NP.t("editor.unlockFailed", {
                            error: err && err.message ? err.message : err }));
                        NP.editor._showLockScreen();
                        /* STATE C: encrypted + locked */
                        NP.editor._refreshLockButton();
                    });
                }

                NP.editor.el.contentEditable = "true";
                NP.editor.el.style.opacity = "1";

                NP.editor.renderContent(NP.editor.el, content, formats);
                if (focus) NP.editor.el.focus();
                NP.editor.updateCharCount();
                NP.editor.startAutosave();

                /* Update tags if available */
                if (NP.tags && NP.tags.render) NP.tags.render();

                /* STATE A: plain note */
                if (NP.welcome) NP.welcome.noteOpened(id);   /* the start page's RECENT */
                NP.editor._refreshLockButton();
                if (NP.markdown && NP.markdown.applyForLoadedNote) {
                    NP.markdown.applyForLoadedNote(id, content);
                }
                NP.editor._loadedNoteId = id;
                /* What the editor holds now is what is stored: an untouched
                   note is never written again (E8), and a broken network
                   never asks about it on the way out (E2). */
                NP.editor._lastSavedKey = NP.editor._contentKey();
                NP.editor._saveState = null;      /* just loaded = saved */
                NP.editor.updateCharCount();   /* Markdown: count the source (D1) */
            }).catch(function (err) {
                console.error("loadNote error:", err);
                /* Nothing is open: no star, save or lock may act on this id (D8). */
                if (NP.editor._currentNoteId === id) {
                    NP.editor._currentNoteId = null;
                    if (NP.state.currentNoteId === id) NP.state.currentNoteId = null;
                }
                if (NP.editor.el) {
                    NP.editor.el.innerHTML =
                        "<p style='color:var(--fg-dim);'>" +
                        NP.escapeHtml(NP.t("editor.loadError", { error: err.message })) + "</p>";
                }
            });
        },

        /* Read-only view of a note in the trash (content null: a locked
           one, which cannot be opened there). Offers "Restore". */
        _trashedId: null,     /* the note on screen is one from the trash */

        _showTrashed: function (id, content) {
            NP.editor._trashedId = id;
            NP.editor.stopAutosave();
            if (NP.markdown && NP.markdown.leaveForLoad) NP.markdown.leaveForLoad();
            if (content === null) {
                NP.editor._showLockScreen();
            } else {
                NP.editor.renderContent(NP.editor.el, content, []);
                NP.editor.el.contentEditable = "false";
                NP.editor.el.style.opacity = "0.75";
                NP.editor.updateCharCount();
            }
            /* T9: its name comes from the trash (it is not in the tree). */
            var titleInput = NP.$("#note-title-input");
            if (titleInput) {
                var trashed = NP.editor._findItemInTree(
                    (NP.state.data && NP.state.data.trash && NP.state.data.trash.tree) || [], id);
                if (trashed) titleInput.value = trashed.name;
                titleInput.readOnly = true;
            }
            if (NP.tags && NP.tags.render) NP.tags.render();
            if (NP.topbar && NP.topbar.refresh) NP.topbar.refresh();
            NP.editor._refreshLockButton();
            if (NP.toast) {
                NP.toast(NP.t("editor.trashedNote"), {
                    actionLabel: NP.t("common.restore"),
                    action: function () {
                        if (!NP.trash || !NP.trash.restore) return;
                        NP.trash.restore(id).then(function () {
                            if (NP.editor._currentNoteId === id) NP.editor.loadNote(id);
                        });
                    }
                });
            }
        },

        _showLockScreen: function () {
            if (!NP.editor.el) return;
            /* In Markdown mode the source and the preview are what is on
               screen, not #editor: they must go too (K3). */
            if (NP.markdown && NP.markdown.leaveForLoad) NP.markdown.leaveForLoad();
            NP.editor._loadedNoteId = null;
            NP.editor.el.contentEditable = "false";
            NP.editor.el.innerHTML =
                "<div style='text-align:center;padding:80px 20px;'>" +
                "<div style='font-size:48px;margin-bottom:16px;'>&#x1F512;</div>" +
                "<div style='font-size:16px;color:var(--fg);margin-bottom:8px;'>" + NP.escapeHtml(NP.t("editor.lockScreen.title")) + "</div>" +
                "<div style='font-size:12px;color:var(--fg-dim);'>" + NP.escapeHtml(NP.t("editor.lockScreen.hint")) + "</div>" +
                "</div>";
            NP.editor.updateCharCount();
        },

        _findItemInTree: function (tree, id) {
            if (!tree) return null;
            for (var i = 0; i < tree.length; i++) {
                if (tree[i].id === id) return tree[i];
                if (tree[i].children) {
                    var found = NP.editor._findItemInTree(tree[i].children, id);
                    if (found) return found;
                }
            }
            return null;
        },

        /* opts.focus: put the keyboard on the first row (start-up, last tab
           closed) - not after e.g. a delete from the tree. */
        showWelcome: function (opts) {
            if (!NP.editor.el) return;
            document.body.classList.add("np-no-note");    /* no "> name" header */

            /* A Markdown note was open: its source/preview would cover the
               start page (the editor itself is hidden in Markdown mode). */
            if (NP.markdown && NP.markdown.isActive && NP.markdown.isActive()) {
                NP.markdown.leaveForLoad();
            }

            NP.editor.stopAutosave();
            NP.editor._currentNoteId = null;
            NP.editor._trashedId = null;
            NP.editor._forgetUnlock();
            NP.editor._currentNoteEncrypted = false;
            NP.editor.el.contentEditable = "false";
            NP.editor._refreshLockButton();

            /* The start page (welcome.js): DOM APIs only, note names are user data. */
            if (NP.welcome) NP.welcome.render(NP.editor.el, opts);
            else NP.editor.el.replaceChildren();
            NP.editor.updateCharCount();
        },

        showOverview: function (item) {
            if (!NP.editor.el) return;
            document.body.classList.add("np-no-note");

            NP.editor.stopAutosave();
            NP.editor._currentNoteId = null;
            NP.editor._forgetUnlock();
            NP.editor._currentNoteEncrypted = false;
            NP.editor.el.contentEditable = "false";
            NP.editor._refreshLockButton();

            var childCount = item.children ? item.children.length : 0;
            var totalCount = countAllItems(item.children || [], null);

            var html = "";
            html += "<div style='padding:40px;max-width:600px;margin:0 auto;'>";
            html += "<h2 style='color:var(--fg-bright);margin:0 0 8px 0;'>&#128193; " + NP.escapeHtml(item.name) + "</h2>";
            html += "<p style='color:var(--fg-dim);margin:0 0 24px 0;'>" + NP.escapeHtml(NP.t("editor.overview.summary", {
                direct: NP.t("editor.overview.directItems", { n: childCount }),
                total: NP.t("editor.overview.totalItems", { n: totalCount })
            })) + "</p>";

            if (item.children && item.children.length > 0) {
                html += "<div>";
                for (var i = 0; i < item.children.length; i++) {
                    var child = item.children[i];
                    var icon = child.type === "folder" ? "&#128193;" : "\u25c6";
                    var color = child.type === "folder" ? "var(--fg-bright)" : "var(--fg-dim)";
                    html += "<div style='padding:4px 0;color:" + color + ";'>" + icon + " " + NP.escapeHtml(child.name) + "</div>";
                }
                html += "</div>";
            }

            html += "</div>";
            NP.editor.el.innerHTML = html;
        },

        /* ---- Content conversion ---- */

        /* Render stored note content (rich-text mode) into *el*. Built
           with DOM APIs only — note text never goes through innerHTML. */
        renderContent: function (el, text, formats) {
            el.replaceChildren(NP.editor._buildRichContent(text || "", formats));
        },

        htmlToContent: function () {
            if (!NP.editor.el) return { text: "", formats: [] };

            var result = NP.editor._htmlToTextWithImages();
            var text = result.text;
            var formats = NP.editor._extractFormats();

            return { text: text, formats: formats };
        },

        _extractFormats: function () {
            if (!NP.editor.el) return [];

            var formats = [];
            var offset = 0;
            var fullText = "";

            function walkNode(node) {
                if (node.nodeType === 3) {
                    /* Text node */
                    fullText += node.textContent;
                    offset += node.textContent.length;
                } else if (node.nodeName === "BR") {
                    fullText += "\n";
                    offset += 1;
                } else if (node.nodeName === "IMG") {
                    var fname = node.getAttribute("data-filename") || "";
                    if (!fname && node.src) {
                        var parts = node.src.split("/");
                        fname = parts[parts.length - 1];
                    }
                    var marker = "<<IMG:" + fname + NP.editor._imgWidthSuffix(node) + ">>";
                    fullText += marker;
                    offset += marker.length;
                } else if (node.nodeName === "PRE" && node.classList && node.classList.contains("np-code")) {
                    /* Code blocks contribute their raw ```lang\n...\n``` form to the
                       text stream but never produce format spans. */
                    var rawCode = node.getAttribute("data-code");
                    if (rawCode !== null && rawCode !== undefined) {
                        try { rawCode = decodeURIComponent(rawCode); }
                        catch (e) { rawCode = node.textContent || ""; }
                    } else {
                        rawCode = node.textContent || "";
                    }
                    var codeLang = node.getAttribute("data-lang") || "";
                    var codeMarker = "```" + codeLang + "\n" + rawCode + "\n```";
                    fullText += codeMarker;
                    offset += codeMarker.length;
                } else if (node.nodeType === 1) {
                    /* Element node */
                    var startOff = offset;
                    var children = node.childNodes;
                    for (var i = 0; i < children.length; i++) {
                        walkNode(children[i]);
                    }
                    var endOff = offset;

                    if (endOff > startOff) {
                        var fmt = {};
                        var hasFormat = false;

                        var tag = node.nodeName;
                        if (tag === "EM" || tag === "I") {
                            fmt.italic = true;
                            hasFormat = true;
                        }
                        if (tag === "U") {
                            fmt.underline = true;
                            hasFormat = true;
                        }
                        if (tag === "B" || tag === "STRONG") {
                            fmt.bold = true;
                            hasFormat = true;
                        }
                        if (tag === "S" || tag === "STRIKE" || tag === "DEL") {
                            fmt.strike = true;
                            hasFormat = true;
                        }
                        if (tag === "A" && NP.linkKind(node.getAttribute("href")) === "external") {
                            fmt.link = node.getAttribute("href").trim();
                            hasFormat = true;
                        }
                        if (tag === "SPAN" || tag === "DIV" || tag === "P") {
                            var style = node.style;
                            if (style.fontFamily) {
                                fmt.font = style.fontFamily.replace(/['"]/g, "");
                                hasFormat = true;
                            }
                            if (style.fontSize) {
                                fmt.size = parseInt(style.fontSize, 10);
                                hasFormat = true;
                            }
                            if (style.color) {
                                fmt.color = style.color;
                                hasFormat = true;
                            }
                            if (style.fontStyle === "italic") {
                                fmt.italic = true;
                                hasFormat = true;
                            }
                            if (style.textDecoration && style.textDecoration.indexOf("underline") !== -1) {
                                fmt.underline = true;
                                hasFormat = true;
                            }
                        }

                        if (hasFormat) {
                            fmt.start = NP.offsetToLineCol(fullText, startOff);
                            fmt.end = NP.offsetToLineCol(fullText, endOff);
                            formats.push(fmt);
                        }
                    }

                    /* Handle block elements adding newlines */
                    if ((tag === "DIV" || tag === "P") && endOff > startOff) {
                        /* Check if the next sibling exists, add newline separation */
                        if (node.nextSibling) {
                            fullText += "\n";
                            offset += 1;
                        }
                    }
                }
            }

            var children = NP.editor.el.childNodes;
            for (var i = 0; i < children.length; i++) {
                walkNode(children[i]);
            }

            return formats;
        },

        /* ---- Images ---- */

        _imgWidthSuffix: function (node) {
            var w = node.getAttribute("data-w");
            if (!w && node.style && node.style.width) {
                var parsed = parseInt(node.style.width, 10);
                if (parsed) w = String(parsed);
            }
            return w ? "|w=" + w : "";
        },

        /* Stored rich-text content → DocumentFragment.
             ```lang\n…```           → <pre class="np-code"> (read-only)
             <<IMG:name|w=NNN>>      → <img>, only for valid uuid names;
                                       anything else stays visible text
             formats [{start,end,…}] → <span style> / <em> / <u> /
                                       <strong> / <s> / <a href> (http,
                                       https, mailto only)
           Format offsets are positions in the full stored text (that is
           how _extractFormats records them). */
        _buildRichContent: function (text, formats) {
            var frag = document.createDocumentFragment();
            var marks = NP.editor._formatMarks(text, formats);
            var re = /```([^\n`]*)\n([\s\S]*?)```|<<IMG:([^|>\n]*)(?:\|w=(\d+))?>>/g;
            var pos = 0;
            var m;
            while ((m = re.exec(text)) !== null) {
                NP.editor._appendFormatted(frag, text, pos, m.index, marks);
                if (m[2] !== undefined) {
                    /* The newline before the closing fence belongs to the
                       fence, not the code (N2: it used to pile up). */
                    frag.appendChild(NP.editor._renderCodeBlock(
                        m[2].replace(/\n$/, ""), m[1].trim()));
                } else if (NP.isImageName(m[3])) {
                    frag.appendChild(NP.editor._makeImage(m[3], m[4]));
                } else {
                    NP.editor._appendFormatted(frag, text, m.index, re.lastIndex, marks);
                }
                pos = re.lastIndex;
            }
            NP.editor._appendFormatted(frag, text, pos, text.length, marks);
            return frag;
        },

        /* formats → [{start, end, fmt}] in absolute offsets, sorted. */
        _formatMarks: function (text, formats) {
            var marks = [];
            (formats || []).forEach(function (fmt) {
                if (!fmt || typeof fmt !== "object") return;
                var start = fmt.start, end = fmt.end;
                if (typeof start === "string" && start.indexOf(".") !== -1) {
                    start = NP.lineColToOffset(text, start);
                    end = NP.lineColToOffset(text, String(end));
                }
                start = Number(start);
                end = Number(end);
                if (isFinite(start) && isFinite(end) && end > start) {
                    marks.push({ start: start, end: end, fmt: fmt });
                }
            });
            marks.sort(function (a, b) { return a.start - b.start; });
            return marks;
        },

        /* Append text[start:end) to *parent*, splitting at format
           boundaries and turning \n into <br>. */
        _appendFormatted: function (parent, text, start, end, marks) {
            if (end <= start) return;
            /* R3: one sweep over the cuts (marks are sorted by start), not
               every mark for every cut — 6 000 formats took seconds. */
            var local = marks.filter(function (mk) { return mk.end > start && mk.start < end; });
            var cuts = [start, end];
            local.forEach(function (mk) {
                if (mk.start > start) cuts.push(mk.start);
                if (mk.end < end) cuts.push(mk.end);
            });
            cuts.sort(function (a, b) { return a - b; });
            var active = [];
            var next = 0;
            for (var i = 0; i < cuts.length - 1; i++) {
                var a = cuts[i], b = cuts[i + 1];
                if (b <= a) continue;
                while (next < local.length && local[next].start <= a) active.push(local[next++]);
                if (active.some(function (mk) { return mk.end <= a; })) {
                    active = active.filter(function (mk) { return mk.end > a; });
                }
                parent.appendChild(NP.editor._styledRun(text.substring(a, b), active));
            }
        },

        _styledRun: function (str, active) {
            var leaf = document.createDocumentFragment();
            str.split("\n").forEach(function (line, i) {
                if (i > 0) leaf.appendChild(document.createElement("br"));
                if (line) leaf.appendChild(document.createTextNode(line));
            });
            if (!active.length) return leaf;

            var italic = false, underline = false, bold = false, strike = false, link = null;
            var font = null, size = null, color = null;
            active.forEach(function (mk) {
                var f = mk.fmt;
                if (f.style === "italic" || f.italic) italic = true;
                if (f.style === "underline" || f.underline) underline = true;
                if (f.bold === true) bold = true;
                if (f.strike === true) strike = true;
                if (NP.linkKind(f.link) === "external") link = f.link.trim();
                if (typeof f.font === "string" && f.font) font = f.font;
                if (f.size !== undefined && f.size !== null) size = parseInt(f.size, 10);
                if (typeof f.color === "string" && f.color) color = f.color;
            });

            var node = leaf;
            if (underline) { var u = document.createElement("u"); u.appendChild(node); node = u; }
            if (italic) { var em = document.createElement("em"); em.appendChild(node); node = em; }
            if (bold) { var b = document.createElement("strong"); b.appendChild(node); node = b; }
            if (strike) { var s = document.createElement("s"); s.appendChild(node); node = s; }
            if (font || size || color) {
                var span = document.createElement("span");
                /* setProperty drops values that aren't valid CSS for that
                   property, so nothing can leak into other declarations. */
                if (font) span.style.setProperty("font-family", font);
                if (size && size >= 6 && size <= 200) span.style.setProperty("font-size", size + "px");
                if (color) span.style.setProperty("color", color);
                span.appendChild(node);
                node = span;
            }
            if (link) {
                var a = document.createElement("a");
                a.setAttribute("href", link);
                a.appendChild(node);
                node = a;
            }
            return node;
        },

        _makeImage: function (filename, width) {
            var img = document.createElement("img");
            img.setAttribute("src", "/images/" + filename);
            img.setAttribute("data-filename", filename);
            var w = width ? parseInt(width, 10) : 0;
            if (w) {
                img.setAttribute("data-w", String(w));
                img.style.width = w + "px";
                img.style.maxWidth = w + "px";
            } else {
                img.style.maxWidth = "100%";
            }
            img.style.display = "block";
            img.style.margin = "8px 0";
            return img;
        },

        _renderCodeBlock: function (code, lang) {
            var langSafe = (lang || "").replace(/[^a-zA-Z0-9_+\-]/g, "");
            var pre = document.createElement("pre");
            pre.className = "np-code";
            pre.setAttribute("contenteditable", "false");
            pre.setAttribute("data-code", encodeURIComponent(code));
            pre.setAttribute("data-lang", langSafe);
            if (langSafe) {
                var tag = document.createElement("span");
                tag.className = "tok-lang";
                tag.textContent = langSafe;
                pre.appendChild(tag);
            }
            var body = document.createElement("code");
            if (NP.highlight) NP.highlight.into(body, code, langSafe);
            else body.textContent = code;
            pre.appendChild(body);
            return pre;
        },

        _htmlToTextWithImages: function () {
            if (!NP.editor.el) return { text: "" };

            var text = "";

            function walkNode(node) {
                if (node.nodeType === 3) {
                    text += node.textContent;
                } else if (node.nodeName === "BR") {
                    text += "\n";
                } else if (node.nodeName === "IMG") {
                    var fname = node.getAttribute("data-filename") || "";
                    if (!fname && node.src) {
                        var parts = node.src.split("/");
                        fname = parts[parts.length - 1];
                    }
                    text += "<<IMG:" + fname + NP.editor._imgWidthSuffix(node) + ">>";
                } else if (node.nodeName === "PRE" && node.classList && node.classList.contains("np-code")) {
                    /* Round-trip code block back to ```lang\n...\n``` form */
                    var raw = node.getAttribute("data-code");
                    if (raw !== null && raw !== undefined) {
                        try { raw = decodeURIComponent(raw); }
                        catch (e) { raw = node.textContent || ""; }
                    } else {
                        raw = node.textContent || "";
                    }
                    var lang = node.getAttribute("data-lang") || "";
                    text += "```" + lang + "\n" + raw + "\n```";
                } else if (node.nodeType === 1) {
                    var children = node.childNodes;
                    for (var i = 0; i < children.length; i++) {
                        walkNode(children[i]);
                    }
                    var tag = node.nodeName;
                    if ((tag === "DIV" || tag === "P") && node.nextSibling) {
                        text += "\n";
                    }
                }
            }

            var children = NP.editor.el.childNodes;
            for (var i = 0; i < children.length; i++) {
                walkNode(children[i]);
            }

            return { text: text };
        },

        /* ---- Formatting commands ---- */

        toggleItalic: function () {
            document.execCommand("italic", false, null);
        },

        toggleUnderline: function () {
            document.execCommand("underline", false, null);
        },

        /* ---- Save ---- */

        /* One save at a time: two overlapping ones (autosave + a tab click,
           Ctrl+S…) would carry the same old rev — a false "changed in
           another window" (R6) — and could arrive out of order (the server
           handles requests in threads). The next save starts when the one
           before is done and stores what is in the editor by then. */
        _saving: null,

        save: function (silent) {
            var run = function () { return NP.editor._saveNow(silent); };
            var prev = NP.editor._saving;
            var p = prev ? prev.then(run, run) : run();
            NP.editor._saving = p;
            p.then(function () { if (NP.editor._saving === p) NP.editor._saving = null; });
            return p;
        },

        /* Resolves true when the open note is stored (or there is nothing
           to store), false when the save failed (E2). Never rejects. */
        _saveNow: function (silent) {
            var id = NP.editor._currentNoteId;
            if (!id || !NP.editor.el || NP.editor._loadedNoteId !== id) {
                /* Nothing open, or the editor still holds another note. */
                return Promise.resolve(true);
            }

            /* Markdown mode: textarea is the source of truth. Skip
               the rich-text walker entirely — its output would be
               whatever HTML the hidden #editor still holds (stale or
               empty), not the user's actual markdown. */
            var mdActive = NP.markdown && NP.markdown.isActive &&
                NP.markdown.isActive();
            var text;
            var formats;
            if (mdActive) {
                text = NP.markdown.getRawText();
                formats = [];
            } else {
                if (NP.editor.el.contentEditable !== "true") {
                    return Promise.resolve(true);
                }
                text = NP.editor._htmlToTextWithImages().text;
                formats = NP.editor._extractFormats();
            }

            var key = id + "\u0000" + text + "\u0000" + JSON.stringify(formats);
            if (silent && key === NP.editor._lastSavedKey) {
                /* Typed and undid it (or a failed save's text is back to what
                   is stored): nothing to write, and it is saved. */
                if (NP.editor._saveState) NP.editor._setSaveStatus(null);
                return Promise.resolve(true);
            }

            var savePromise;
            var savedLocked = !!NP.editor._currentNoteEncrypted;
            if (savedLocked) {
                var token = NP.editor._unlockToken;
                if (!token) return Promise.resolve(true);  /* locked: nothing editable */
                /* Re-encrypt on the server with the remembered key. A 401
                   means the key expired: ask for the password and retry,
                   so the user's edits are not lost. */
                savePromise = NP.api.saveEncrypted(id, token, text, formats).catch(function (err) {
                    if (!(err && err.status === 401 && NP.encryption && NP.encryption.reunlock)) throw err;
                    return NP.encryption.reunlock(id).then(function (newToken) {
                        if (!newToken) throw new Error(NP.t("editor.lockedNotSaved"));
                        return NP.api.saveEncrypted(id, newToken, text, formats);
                    });
                });
            } else {
                /* R6: after "keep mine, don't save" the autosave does not
                   ask again every second; Ctrl+S or leaving the note does. */
                if (silent && NP.editor._conflictHold === id) {
                    NP.editor._setSaveStatus(new Error(NP.t("errors.note_changed_elsewhere")));
                    return Promise.resolve(false);
                }
                savePromise = NP.api.saveNote(id, text, formats, { baseRev: NP.editor._rev }).catch(function (err) {
                    if (!(err && err.code === "note_changed_elsewhere")) throw err;
                    return NP.editor._resolveConflict(id, text, formats);
                });
            }
            NP.editor._lastSave = savePromise;

            return savePromise.then(function (res) {
                if (res && res.rev && NP.editor._currentNoteId === id) NP.editor._rev = res.rev;
                NP.editor._lastSavedKey = key;
                if (savedLocked && NP.editor._currentNoteId === id && NP.encryption && NP.encryption.noteSaved) {
                    NP.encryption.noteSaved(id, text);
                }
                /* Typing during the request keeps it "not saved". */
                if (NP.editor._currentNoteId === id) NP.editor._setSaveStatus(
                    NP.editor._saveState === "dirty" && !NP.editor._sameAsSaved(key) ? "dirty" : null);
                if (!silent) {
                    NP.editor._showSaveFlash();
                }
                return true;
            }).catch(function (err) {
                /* Never silent (D3): Ctrl+S explains why; an autosave marks
                   the status until a save succeeds again. */
                console.error("Save failed:", err);
                if (NP.editor._currentNoteId === id) NP.editor._setSaveStatus(err);
                if (!silent && !(err && err.answered) && NP.dialog && NP.dialog.failed) NP.dialog.failed(err);
                return false;
            });
        },

        /* R6 (NoirPad-web, two windows): the note was saved elsewhere since
           this window loaded it. The user decides: overwrite it with this
           text, or keep this text unsaved (nothing is lost either way). */
        _rev: null,
        _conflictHold: null,
        _conflictAsking: false,

        _resolveConflict: function (id, text, formats) {
            var err = new Error(NP.t("errors.note_changed_elsewhere"));
            err.code = "note_changed_elsewhere";
            if (NP.editor._conflictAsking || !NP.dialog || !NP.dialog.confirm) return Promise.reject(err);
            NP.editor._conflictAsking = true;
            if (NP.editor._closeBusy) NP.editor._closeBusy = "asking";
            var item = NP.editor._findItemInTree((NP.state.data || {}).tree || [], id);
            return NP.dialog.confirm(NP.t("editor.conflict", { name: item ? item.name : "" }), {
                title: NP.t("editor.conflictTitle"),
                okLabel: NP.t("editor.conflictOverwrite"),
                cancelLabel: NP.t("editor.conflictKeep")
            }).then(function (overwrite) {
                NP.editor._conflictAsking = false;
                if (!overwrite) {
                    NP.editor._conflictHold = id;
                    err.answered = true;
                    throw err;
                }
                NP.editor._conflictHold = null;
                return NP.api.saveNote(id, text, formats);
            });
        },

        /* Before the open note makes way for another one (tab switch, tab
           close, a trashed note, the start page): its last typing is
           saved first. If that fails, the user decides — stay (the text
           remains in the editor, nothing is lost) or discard it. Resolves
           true = go ahead (E2). */
        leave: function () {
            var id = NP.editor._currentNoteId;
            /* Typing while the save was on its way: save once more. */
            return NP.editor.save(true).then(function (ok) {
                return ok && NP.editor._saveState === "dirty" ? NP.editor.save(true) : ok;
            }).then(function (ok) {
                if (ok || NP.editor._currentNoteId !== id) return true;
                var err = NP.editor._saveState;
                var item = NP.editor._findItemInTree((NP.state.data || {}).tree || [], id);
                if (!NP.dialog || !NP.dialog.confirm) return false;
                if (NP.editor._closeBusy) NP.editor._closeBusy = "asking";
                return NP.dialog.confirm(NP.t("editor.leaveUnsaved", {
                    name: item ? item.name : "",
                    error: err && err.message ? err.message : String(err || "")
                }), {
                    title: NP.t("editor.leaveUnsavedTitle"),
                    okLabel: NP.t("editor.discardChanges"),
                    cancelLabel: NP.t("editor.stayOnNote"),
                    danger: true
                }).then(function (discard) { return !!discard; });
            });
        },

        /* Status bar: "● saved" / "○ not saved" for the open note.
           state: null = saved, "dirty" = typed since the last save, an
           Error = the last save failed (stays until a save succeeds; the
           reason is the tooltip). Hidden while no note is open. */
        _saveState: null,

        _setSaveStatus: function (state) {
            var prev = NP.editor._saveState;
            if (state === "dirty" && prev && prev !== "dirty") return;   /* an error stays */
            NP.editor._saveState = state || null;
            NP.editor._renderStatus();
        },

        _renderStatus: function () {
            var el = document.getElementById("status-label");
            if (el) {
                var st = NP.editor._saveState;
                var failed = !!st && st !== "dirty";
                var open = !!(NP.editor._currentNoteId && NP.editor._loadedNoteId === NP.editor._currentNoteId);
                el.hidden = !open && !failed;
                el.classList.toggle("status-error", failed);
                el.classList.toggle("status-dirty", st === "dirty");
                var text = el.querySelector(".status-text") || el;
                text.textContent = NP.t(st ? "editor.status.unsaved" : "editor.status.saved");
                if (failed) el.title = st.message || String(st);
                else el.removeAttribute("title");
            }
            var mode = document.getElementById("mode-label");
            if (mode) {
                var md = NP.markdown && NP.markdown.isActive && NP.markdown.isActive();
                mode.textContent = NP.editor._loadedNoteId ? NP.t(md ? "editor.mode.markdown" : "editor.mode.text") : "";
            }
        },

        /* Does the editor still hold exactly what *key* describes? */
        _sameAsSaved: function (key) {
            return key === NP.editor._contentKey();
        },

        /* The open note's text + formats, as save() compares them. */
        _contentKey: function () {
            var id = NP.editor._currentNoteId;
            var md = NP.markdown && NP.markdown.isActive && NP.markdown.isActive();
            var text = md ? NP.markdown.getRawText() : NP.editor._htmlToTextWithImages().text;
            var formats = md ? [] : NP.editor._extractFormats();
            return id + "\u0000" + text + "\u0000" + JSON.stringify(formats);
        },

        _showSaveFlash: function () {
            var wrap = document.getElementById("editor-wrapper");
            if (!wrap) return;
            wrap.classList.remove("saved-pulse");
            /* Force reflow so the animation restarts on rapid saves */
            void wrap.offsetWidth;
            wrap.classList.add("saved-pulse");
            setTimeout(function () {
                wrap.classList.remove("saved-pulse");
            }, 650);
        },

        /* ---- Character count ---- */

        updateCharCount: function () {
            var charEl = NP.$("#char-count");
            var wordEl = NP.$("#word-count");
            NP.editor._renderStatus();

            /* Markdown mode: the source in the textarea is the note (D1). */
            var mdActive = NP.markdown && NP.markdown.isActive && NP.markdown.isActive();
            if (!mdActive && (!NP.editor.el || NP.editor.el.contentEditable !== "true")) {
                if (charEl) charEl.textContent = NP.t("editor.count.chars", { n: 0 });
                if (wordEl) wordEl.textContent = NP.t("editor.count.words", { n: 0 });
                return;
            }

            var text = mdActive ? NP.markdown.getRawText() : NP.editor._htmlToTextWithImages().text;
            var chars = text.length;
            var words = text.trim() ? text.trim().split(/\s+/).length : 0;

            if (charEl) charEl.textContent = NP.t("editor.count.chars", { n: chars });
            if (wordEl) wordEl.textContent = NP.t("editor.count.words", { n: words });
        },

        /* ---- Auto-save ---- */

        /* Autosave on: every `autosave_interval` seconds (Settings).
           Off: a 30 s safety net, so a crash never costs more than half a
           minute of typing. Unchanged notes are not rewritten either way. */
        startAutosave: function () {
            NP.editor.stopAutosave();
            var data = (NP.state && NP.state.data) || {};
            var seconds = data.autosave ? parseInt(data.autosave_interval, 10) : 30;
            if (!(seconds >= 5)) seconds = 30;
            NP.editor._autosaveTimer = setInterval(function () {
                NP.editor.save(true);
            }, seconds * 1000);
        },

        stopAutosave: function () {
            if (NP.editor._autosaveTimer) {
                clearInterval(NP.editor._autosaveTimer);
                NP.editor._autosaveTimer = null;
            }
        }
    };

})(window.NP);
