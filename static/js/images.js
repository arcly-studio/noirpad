/* images.js - NoirPad image handling */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* The +Img toolbar button blurs the editor before the file dialog
       opens, so window.getSelection() loses the cursor by the time
       onchange fires. Stash it on click via saveSelection() and apply
       it again when the upload resolves. */
    var savedRange = null;
    var savedMd = null;

    function inMarkdownMode() {
        return !!(NP.markdown && NP.markdown.isActive && NP.markdown.isActive());
    }

    /* Elements the click/wheel handlers must cover. #editor is the
       rich-text contenteditable (visible in non-MD mode); #md-preview
       is the rendered HTML pane (visible in MD mode). The hidden one
       just never fires events, so attaching to both is safe. */
    /* The <img> at/above *node* if it is a picture in the note's content,
       else null. Only those open the viewer or zoom with Ctrl+wheel: the
       welcome screen is rendered into #editor too, and logos and other UI
       images (.np-decorative) must never react. */
    function noteImage(node, host) {
        var img = node && node.closest ? node.closest("img") : null;
        if (!img || !host.contains(img)) return null;
        if (img.classList.contains("np-decorative") || img.closest(".welcome-wrap")) return null;
        if (host.id === "md-preview" && !img.classList.contains("md-image")) return null;
        return img;
    }

    function imageHostElements() {
        var out = [];
        var ed = document.getElementById("editor");
        if (ed) out.push(ed);
        var pv = document.getElementById("md-preview");
        if (pv) out.push(pv);
        return out;
    }

    NP.images = {
        init: function () {
            var editor = document.getElementById("editor");
            if (editor) {
                editor.addEventListener("paste", NP.images._onPasteEditor);
            }
            var ta = document.getElementById("editor-md");
            if (ta) {
                ta.addEventListener("paste", NP.images._onPasteTextarea);
            }
            NP.images._setupZoom();
            NP.images._setupClick();
        },

        saveSelection: function () {
            savedRange = null;
            savedMd = null;
            if (inMarkdownMode()) {
                var ta = document.getElementById("editor-md");
                if (ta) savedMd = { start: ta.selectionStart, end: ta.selectionEnd };
                return;
            }
            var editor = document.getElementById("editor");
            var sel = window.getSelection();
            if (sel && sel.rangeCount > 0 && editor && editor.contains(sel.anchorNode)) {
                savedRange = sel.getRangeAt(0).cloneRange();
            }
        },

        _onPasteEditor: function (e) {
            var file = NP.images._extractImageFile(e);
            if (!file) return;
            e.preventDefault();
            NP.images.saveSelection();
            NP.images._showPasteDialog(file);
        },

        _onPasteTextarea: function (e) {
            var file = NP.images._extractImageFile(e);
            if (!file) return;
            e.preventDefault();
            NP.images.saveSelection();
            NP.images._showPasteDialog(file);
        },

        _extractImageFile: function (e) {
            var items = e.clipboardData && e.clipboardData.items;
            if (!items) return null;
            for (var i = 0; i < items.length; i++) {
                if (items[i].type.indexOf("image/") === 0) {
                    return items[i].getAsFile();
                }
            }
            return null;
        },

        upload: function (file) {
            if (!NP.editor || !NP.editor._currentNoteId) {
                return Promise.resolve();
            }
            /* E5: the picture belongs to the note it was pasted into. */
            var noteId = NP.editor._currentNoteId;
            return NP.api.uploadImage(file).then(function (res) {
                var url = res && (res.url || res.path);
                var filename = res && res.filename;
                if (!url || !filename) return;
                if (NP.editor._currentNoteId !== noteId || NP.editor._loadedNoteId !== noteId) {
                    /* Another note is open by now: not into that one. The
                       unused file is cleaned up later (D14). */
                    if (NP.toast) NP.toast(NP.t("images.notInserted"));
                    return;
                }

                if (inMarkdownMode()) {
                    NP.images._insertMarkdown(url);
                } else {
                    NP.images._insertImage(url, filename);
                }
                if (NP.encryption) NP.encryption.noteImageAdded();

                /* Persist immediately — autosave is 30s and the user
                   may switch notes or refresh before then. */
                if (NP.editor && NP.editor.save) NP.editor.save(true);
            }).catch(function (err) {
                console.error("Image upload failed:", err);
                NP.dialog.alert(NP.t("images.uploadFailed", { error: err && err.message ? err.message : err }));
            });
        },

        _insertImage: function (url, filename) {
            var editor = document.getElementById("editor");
            if (!editor || editor.contentEditable !== "true") return;

            var img = document.createElement("img");
            img.src = url;
            img.setAttribute("data-filename", filename);
            img.style.cssText = "max-width:100%;height:auto;display:block;margin:8px 0;";
            img.setAttribute("draggable", "false");

            editor.focus();
            var sel = window.getSelection();
            var range = null;

            if (savedRange && editor.contains(savedRange.startContainer)) {
                range = savedRange;
                sel.removeAllRanges();
                sel.addRange(range);
            } else if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
                range = sel.getRangeAt(0);
            }

            if (range) {
                range.deleteContents();
                range.insertNode(img);
                range.setStartAfter(img);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                editor.appendChild(img);
            }
            savedRange = null;
        },

        _insertMarkdown: function (url) {
            var ta = document.getElementById("editor-md");
            if (!ta) return;
            var snippet = "![](" + url + ")";
            var start = savedMd ? savedMd.start : ta.selectionStart;
            var end = savedMd ? savedMd.end : ta.selectionEnd;
            ta.value = ta.value.substring(0, start) + snippet + ta.value.substring(end);
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + snippet.length;
            /* Re-render the preview pane. */
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            savedMd = null;
        },

        /* Ctrl+V from clipboard offers a choice: full <img> vs a plain
           link to the uploaded file. The +Img toolbar button bypasses
           this dialog and goes straight through upload() — direct insert
           is the expected behavior for an explicit "insert image" click. */
        _showPasteDialog: function (file) {
            var savedRangeAtOpen = savedRange;
            var savedMdAtOpen = savedMd;

            var overlay = document.createElement("div");
            overlay.className = "paste-image-overlay";
            function tx(key) { return NP.escapeHtml(NP.t(key)); }
            overlay.innerHTML =
                '<div class="paste-image-modal">' +
                    '<h3>' + tx("images.pasteDialog.title") + '</h3>' +
                    '<p>' + tx("images.pasteDialog.message") + '</p>' +
                    '<div class="paste-image-buttons">' +
                        '<button id="paste-as-image">' + tx("images.pasteDialog.asImage") + '</button>' +
                        '<button id="paste-as-link">' + tx("images.pasteDialog.asLink") + '</button>' +
                        '<button id="paste-cancel">' + tx("images.pasteDialog.cancel") + '</button>' +
                    '</div>' +
                '</div>';
            document.body.appendChild(overlay);

            function close() {
                document.removeEventListener("keydown", onKey);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
            function onKey(e) {
                if (e.key === "Escape") close();
            }
            document.addEventListener("keydown", onKey);

            overlay.querySelector("#paste-as-image").addEventListener("click", function () {
                close();
                /* upload() reads savedRange/savedMd — restore them in case
                   anything cleared them while the modal was up. */
                savedRange = savedRangeAtOpen;
                savedMd = savedMdAtOpen;
                NP.images.upload(file);
            });
            overlay.querySelector("#paste-as-link").addEventListener("click", function () {
                close();
                savedRange = savedRangeAtOpen;
                savedMd = savedMdAtOpen;
                NP.images._uploadAsLink(file);
            });
            overlay.querySelector("#paste-cancel").addEventListener("click", close);
            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) close();
            });
        },

        _uploadAsLink: function (file) {
            if (!NP.editor || !NP.editor._currentNoteId) {
                return Promise.resolve();
            }
            return NP.api.uploadImage(file).then(function (res) {
                var url = res && (res.url || res.path);
                if (!url) return;

                if (inMarkdownMode()) {
                    NP.images._insertMarkdownLink(url);
                } else {
                    NP.images._insertLink(url);
                }
                if (NP.encryption) NP.encryption.noteImageAdded();
                if (NP.editor && NP.editor.save) NP.editor.save(true);
            }).catch(function (err) {
                console.error("Image upload failed:", err);
                NP.dialog.alert(NP.t("images.uploadFailed", { error: err && err.message ? err.message : err }));
            });
        },

        _insertLink: function (url) {
            var editor = document.getElementById("editor");
            if (!editor || editor.contentEditable !== "true") return;

            var a = document.createElement("a");
            a.href = url;
            a.textContent = url;
            a.target = "_blank";
            a.rel = "noopener";

            editor.focus();
            var sel = window.getSelection();
            var range = null;

            if (savedRange && editor.contains(savedRange.startContainer)) {
                range = savedRange;
                sel.removeAllRanges();
                sel.addRange(range);
            } else if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
                range = sel.getRangeAt(0);
            }

            if (range) {
                range.deleteContents();
                range.insertNode(a);
                range.setStartAfter(a);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                editor.appendChild(a);
            }
            savedRange = null;
        },

        _insertMarkdownLink: function (url) {
            var ta = document.getElementById("editor-md");
            if (!ta) return;
            var snippet = "[" + NP.t("images.linkLabel") + "](" + url + ")";
            var start = savedMd ? savedMd.start : ta.selectionStart;
            var end = savedMd ? savedMd.end : ta.selectionEnd;
            ta.value = ta.value.substring(0, start) + snippet + ta.value.substring(end);
            ta.focus();
            ta.selectionStart = ta.selectionEnd = start + snippet.length;
            ta.dispatchEvent(new Event("input", { bubbles: true }));
            savedMd = null;
        },

        _setupZoom: function () {
            imageHostElements().forEach(function (host) {
                /* passive:false is REQUIRED for preventDefault() — without
                   it Chrome ignores the call and zooms the whole page. */
                host.addEventListener("wheel", function (e) {
                    if (!e.ctrlKey && !e.metaKey) return;
                    var target = noteImage(e.target, host);
                    if (!target) return;

                    e.preventDefault();
                    e.stopPropagation();

                    var current = parseFloat(target.style.width);
                    if (!current || isNaN(current)) {
                        current = parseFloat(target.dataset.w);
                    }
                    if (!current || isNaN(current)) current = target.offsetWidth || 300;

                    var factor = e.deltaY < 0 ? 1.1 : 0.9;
                    var next = Math.round(Math.max(50, Math.min(2000, current * factor)));

                    target.style.width = next + "px";
                    target.style.maxWidth = next + "px";
                    target.style.height = "auto";
                    target.dataset.w = String(next);

                    /* Persistence only matters for the rich-text editor —
                       the MD preview re-renders from textarea on next
                       keystroke, where width is not part of the source. */
                    if (host.id === "editor" && NP.editor && NP.editor.save) {
                        NP.editor.save(true);
                    }
                }, { passive: false });
            });
        },

        isNoteImage: function (img, host) { return noteImage(img, host) === img; },

        _setupClick: function () {
            imageHostElements().forEach(function (host) {
                host.addEventListener("click", NP.images._onHostClick);
            });
        },

        _onHostClick: function (e) {
            /* Modifier-clicks reserved: Ctrl/Cmd for zoom-grip, Shift for
               cursor placement / text selection by the user. Links are
               handled globally by links.js. */
            if (e.ctrlKey || e.metaKey || e.shiftKey) return;

            var img = noteImage(e.target, e.currentTarget);
            if (img) {
                e.preventDefault();
                NP.images._openViewer(img.src);
            }
        },

        _openViewer: function (url) {
            /* Idempotent — second invocation replaces the first. */
            var existing = document.getElementById("image-viewer-overlay");
            if (existing && existing.parentNode) {
                existing.parentNode.removeChild(existing);
            }

            var overlay = document.createElement("div");
            overlay.id = "image-viewer-overlay";
            overlay.className = "image-viewer-overlay";
            overlay.innerHTML =
                '<button class="image-viewer-close" aria-label="' + NP.escapeHtml(NP.t("images.viewer.close")) + '">&times;</button>' +
                '<img class="image-viewer-img" alt="' + NP.escapeHtml(NP.t("images.viewer.alt")) + '">';
            overlay.querySelector(".image-viewer-img").src = url;
            document.body.appendChild(overlay);

            function close() {
                document.removeEventListener("keydown", onKey);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }
            function onKey(e) {
                if (e.key === "Escape") close();
            }
            document.addEventListener("keydown", onKey);

            overlay.querySelector(".image-viewer-close")
                .addEventListener("click", close);
            overlay.addEventListener("click", function (e) {
                /* Click on the dark backdrop closes; click on the image
                   itself doesn't. */
                if (e.target === overlay) close();
            });
        }
    };

})(window.NP);
