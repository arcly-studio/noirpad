/* help.js - Built-in help window (F1) */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* The table holds i18n KEYS, not texts: dictionaries load after this
       script is parsed, so NP.t() is called when a section is rendered.
       Key caps, commands and "raw" bullets (theme names) stay as they are.
       A shortcut row may name its NP.shortcuts id (third item): the key
       shown is then the one currently set, also after remapping (U10). */
    var HELP_SECTIONS = [
        {
            title: "help.overview.title",
            content: [
                { type: "text", value: "help.overview.p1" },
                { type: "text", value: "help.overview.p2" }
            ]
        },
        {
            title: "help.keys.title",
            content: [
                { type: "header", value: "help.keys.basic" },
                { type: "shortcuts", value: [
                    ["Ctrl+S", "help.keys.save", "save"],
                    ["Ctrl+F", "help.keys.find", "find"],
                    ["Ctrl+B", "help.keys.focus", "toggle-sidebar"],
                    ["Ctrl+L", "help.keys.orientation", "toggle-orientation"],
                    ["Ctrl+I", "help.keys.italic"],
                    ["Ctrl+U", "help.keys.underline"],
                    ["Ctrl+Z", "help.keys.undo"],
                    ["Ctrl+Y", "help.keys.redo"],
                    ["Ctrl+V", "help.keys.paste"],
                    ["Ctrl+Shift+V", "help.keys.pastePlain"],
                    ["Ctrl+Space", "help.keys.clearFormatting", "clear-formatting"],
                    ["Ctrl+Click", "help.keys.linkOpen"],
                    ["Ctrl+Shift+P", "help.keys.commandBar", "open-command-palette"],
                    ["Ctrl+Shift+K", "help.keys.findAll", "find-all"],
                    ["Ctrl+M", "shortcuts.labels.toggleMarkdown", "toggle-markdown"],
                    ["Ctrl+D", "shortcuts.labels.toggleFavorite", "toggle-favorite"],
                    ["Ctrl+Shift+L", "shortcuts.labels.toggleLock", "toggle-lock"],
                    ["Ctrl+Shift+N", "shortcuts.labels.newNote", "new-note"],
                    ["Ctrl+Shift+F", "shortcuts.labels.newFolder", "new-folder"],
                    ["Ctrl+Shift+I", "shortcuts.labels.insertImage", "insert-image"],
                    ["Ctrl+Shift+T", "shortcuts.labels.openFontPicker", "open-font-picker"],
                    ["Ctrl+,", "shortcuts.labels.openSettings", "open-settings"],
                    ["Ctrl+=", "shortcuts.labels.zoomIn", "zoom-in"],
                    ["Ctrl+-", "shortcuts.labels.zoomOut", "zoom-out"],
                    ["Ctrl+0", "shortcuts.labels.zoomReset", "zoom-reset"],
                    ["Ctrl+Tab", "help.keys.nextTab", "next-tab"],
                    ["Ctrl+Shift+Tab", "help.keys.prevTab", "prev-tab"],
                    ["Ctrl+W", "help.keys.closeTab", "close-tab"]
                ]},
                { type: "header", value: "help.keys.function" },
                { type: "shortcuts", value: [
                    ["F1", "help.keys.help", "open-help"],
                    ["F2", "help.keys.rename", "rename"],
                    ["F3", "help.keys.findNext", "find-next"],
                    ["Shift+F3", "help.keys.findPrev", "find-prev"],
                    ["F11", "help.keys.fullscreen", "fullscreen"],
                    ["Delete", "help.keys.delete", "delete"],
                    ["Escape", "help.keys.closeOverlay"]
                ]}
            ]
        },
        {
            title: "help.commands.title",
            content: [
                { type: "text", value: "help.commands.intro" },
                { type: "header", value: "help.commands.available" },
                { type: "commands", value: [
                    [":search", "help.commands.search"],
                    [":new note", "help.commands.newNote"],   // i18n-ignore (command)
                    [":new folder", "help.commands.newFolder"],   // i18n-ignore (command)
                    [":theme", "help.commands.theme"],
                    [":encrypt", "help.commands.encrypt"],
                    [":decrypt", "help.commands.decrypt"],
                    [":fullscreen", "help.commands.fullscreen"],
                    [":autosave", "help.commands.autosave"],
                    [":export", "help.commands.export"],
                    [":exportpdf", "help.commands.exportPdf"],
                    [":exporthtml", "help.commands.exportHtml"],
                    [":focus", "help.commands.focus"],
                    [":tag", "help.commands.tag"],
                    [":tags", "help.commands.tags"],
                    [":fontsize", "help.commands.fontSize"],
                    [":font", "help.commands.font"],
                    [":backup", "help.commands.backup"],
                    [":import", "help.commands.import"],
                    [":fav", "help.commands.fav"],
                    [":emptytrash", "help.commands.emptyTrash"],
                    [":orientation", "help.commands.orientation"],
                    [":rain", "help.commands.matrix"],
                    [":help", "help.commands.help"],
                    [":findall", "commands.desc.findall"],
                    [":clearformat", "commands.desc.clearformat"],
                    [":crt", "commands.desc.crt"],
                    [":settings", "commands.desc.settings"],
                    [":closetab", "commands.desc.closetab"],
                    [":closeall", "commands.desc.closeall"]
                ]}
            ]
        },
        {
            title: "help.notes.title",
            content: [
                { type: "bullets", value: [
                    "help.notes.tree",
                    "help.notes.drag",
                    "help.notes.contextMenu",
                    "help.notes.rename",
                    "help.notes.delete"
                ]}
            ]
        },
        {
            title: "help.editor.title",
            content: [
                { type: "bullets", value: [
                    "help.editor.monospace",
                    "help.editor.formatting",
                    "help.editor.undo",
                    "help.editor.orientation"
                ]}
            ]
        },
        {
            title: "help.encryption.title",
            content: [
                { type: "text", value: "help.encryption.intro" },
                { type: "bullets", value: [
                    "help.encryption.encrypt",
                    "help.encryption.decrypt",
                    "help.encryption.notEncrypted",
                    "help.encryption.password"
                ]}
            ]
        },
        {
            title: "help.images.title",
            content: [
                { type: "bullets", value: [
                    "help.images.paste",
                    "help.images.folder",
                    "help.images.zoom",
                    "help.images.viewer"
                ]}
            ]
        },
        {
            title: "help.export.title",
            content: [
                { type: "bullets", value: [
                    "help.export.text",
                    "help.export.pdf",
                    "help.export.html",
                    "help.export.all"
                ]}
            ]
        },
        {
            title: "help.tags.title",
            content: [
                { type: "bullets", value: [
                    "help.tags.tag",
                    "help.tags.tags",
                    "help.tags.fav",
                    "help.tags.sorting"
                ]}
            ]
        },
        {
            title: "help.themes.title",
            content: [
                { type: "text", value: "help.themes.intro" },
                { type: "bullets", raw: true, value: [
                    /* :theme names (N1.6); the old ids are hidden aliases */
                    "phosphor, amber, cyan, red, purple, blue",
                    "pink, white, gold, lime, orange, ice",
                    "lavender, neon, slate, retro, midnight"
                ]}
            ]
        },
        {
            title: "help.backup.title",
            content: [
                { type: "bullets", value: [
                    "help.backup.backup",
                    "help.backup.import"
                ]}
            ]
        },
        {
            title: "help.effects.title",
            content: [
                { type: "bullets", value: [
                    "help.effects.matrix",
                    "help.effects.splash",
                    "help.effects.crt",
                    "help.effects.focus"
                ]}
            ]
        },
        {
            title: "help.md.title",
            content: [
                { type: "md-intro", value: "help.md.intro" },
                /* Item id -> <id>.syntax, <id>.desc and, with snippet: true,
                   <id>.snippet (the text copied); otherwise snippet = syntax. */
                { type: "md-category", title: "help.md.headings", items: [
                    { id: "help.md.h1" },
                    { id: "help.md.h2" },
                    { id: "help.md.h3" }
                ]},
                { type: "md-category", title: "help.md.textFormatting", items: [
                    { id: "help.md.bold" },
                    { id: "help.md.italic" },
                    { id: "help.md.strike" }
                ]},
                { type: "md-category", title: "help.md.lists", items: [
                    { id: "help.md.ul", snippet: true },
                    { id: "help.md.ol", snippet: true },
                    { id: "help.md.task", snippet: true }
                ]},
                { type: "md-category", title: "help.md.code", items: [
                    { id: "help.md.inlineCode" },
                    { id: "help.md.codeBlock", snippet: true }
                ]},
                { type: "md-note", value: "help.md.tipBacktick" },
                { type: "md-category", title: "help.md.links", items: [
                    { id: "help.md.link", snippet: true }
                ]},
                { type: "md-category", title: "help.md.images", items: [
                    { id: "help.md.image", snippet: true }
                ]},
                { type: "md-note", value: "help.md.tipImages" },
                { type: "md-category", title: "help.md.other", items: [
                    { id: "help.md.quote", snippet: true }
                ]},
                /* Row: [key cap, key of the markdown sample shown in <code>] */
                { type: "md-shortcuts", title: "help.md.shortcuts", items: [
                    ["Ctrl+B", "help.md.wrap.bold", "md-bold"],
                    ["Ctrl+I", "help.md.wrap.italic", "md-italic"],
                    ["Ctrl+E", "help.md.wrap.code", "md-code-inline"],
                    ["Ctrl+K", "help.md.wrap.link", "md-link"]
                ]}
            ]
        }
    ];

    var overlayEl = null;

    /* The key shown for a row: the current binding when the row names a
       shortcut id ("—" when the user removed it), else the fixed key. */
    function keyOf(row) {
        if (row[2] && NP.shortcuts && NP.shortcuts.getCurrent) {
            var current = NP.shortcuts.getCurrent(row[2]);
            if (current !== null && current !== undefined) return current || "—";
        }
        return row[0];
    }

    function el(tag, attrs, text) {
        var node = document.createElement(tag);
        Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
        if (text != null) node.textContent = text;
        return node;
    }

    /* The window in the shared G7 style (#help-overlay / #help-window in
       noirpad.css): sections on the left as a vertical tab list (↑ ↓ Home
       End, U2), the open section on the right. */
    function buildOverlay() {
        var overlay = el("div", { id: "help-overlay", "class": "visible np-modal" });  // i18n-ignore (CSS classes)
        var win = el("div", { id: "help-window" });
        var header = el("div", { id: "help-header" });
        header.appendChild(el("h2", { id: "help-title" }, NP.t("help.title")));
        var close = el("button", { id: "help-close", type: "button",
            title: NP.t("help.close"), "aria-label": NP.t("help.close") }, "×");
        header.appendChild(close);
        win.appendChild(header);

        var layout = el("div", { "class": "help-layout" });
        var nav = el("div", { id: "help-nav", role: "tablist", "aria-orientation": "vertical",
            "aria-labelledby": "help-title" });
        for (var i = 0; i < HELP_SECTIONS.length; i++) {
            nav.appendChild(el("button", { type: "button", role: "tab", "class": "help-nav-item",
                id: "help-tab-" + i, "data-idx": String(i), "aria-controls": "help-content",
                "aria-selected": "false", tabindex: "-1" }, NP.t(HELP_SECTIONS[i].title)));
        }
        layout.appendChild(nav);
        layout.appendChild(el("div", { id: "help-content", role: "tabpanel", tabindex: "0" }));
        win.appendChild(layout);
        overlay.appendChild(win);
        return overlay;
    }

    function renderSection(idx) {
        var section = HELP_SECTIONS[idx];
        if (!section) return "";

        var html = '<h3 class="help-section-title">' + NP.escapeHtml(NP.t(section.title)) + '</h3>';

        for (var i = 0; i < section.content.length; i++) {
            var block = section.content[i];
            switch (block.type) {
                case "text":
                    html += '<p style="margin:0 0 10px 0;">' + NP.escapeHtml(NP.t(block.value)) + '</p>';
                    break;
                case "header":
                    html += '<h3 style="margin:16px 0 8px 0;font-size:13px;color:var(--fg-bright, #4cff7a);">' +
                        NP.escapeHtml(NP.t(block.value)) + '</h3>';
                    break;
                case "bullets":
                    html += '<ul style="margin:0 0 10px 0;padding-left:20px;">';
                    for (var b = 0; b < block.value.length; b++) {
                        html += '<li style="margin:2px 0;color:var(--fg, #00ff41);">' +
                            NP.escapeHtml(block.raw ? block.value[b] : NP.t(block.value[b])) + '</li>';
                    }
                    html += '</ul>';
                    break;
                case "shortcuts":
                case "commands":
                    html += '<table style="border-collapse:collapse;margin:0 0 12px 0;width:100%;">';
                    for (var r = 0; r < block.value.length; r++) {
                        var row = block.value[r];
                        html += '<tr>';
                        html += '<td style="padding:3px 12px 3px 0;white-space:nowrap;color:var(--fg-bright, #4cff7a);' +
                            'font-weight:bold;font-size:12px;border-bottom:1px solid var(--border, #1a2e1a);">' +
                            NP.escapeHtml(keyOf(row)) + '</td>';
                        html += '<td style="padding:3px 0;color:var(--fg-dim, #00bf30);font-size:12px;' +
                            'border-bottom:1px solid var(--border, #1a2e1a);">' +
                            NP.escapeHtml(NP.t(row[1])) + '</td>';
                        html += '</tr>';
                    }
                    html += '</table>';
                    break;
                case "md-intro":
                    html += '<p class="help-section-intro">' + NP.escapeHtml(NP.t(block.value)) + '</p>';
                    break;
                case "md-category":
                    html += '<div class="md-help-category">';
                    html += '<h3 class="md-help-cat-title">' + NP.escapeHtml(NP.t(block.title)) + '</h3>';
                    html += '<div class="md-help-grid">';
                    for (var mi = 0; mi < block.items.length; mi++) {
                        var it = block.items[mi];
                        var syntax = NP.t(it.id + ".syntax");
                        var snippet = it.snippet ? NP.t(it.id + ".snippet") : syntax;
                        html += '<div class="md-help-item" data-snippet="' + NP.escapeHtml(snippet) + '">' +
                            '<code class="md-help-syntax">' + NP.escapeHtml(syntax) + '</code>' +
                            '<span class="md-help-desc">' + NP.escapeHtml(NP.t(it.id + ".desc")) + '</span>' +
                            '</div>';
                    }
                    html += '</div></div>';
                    break;
                case "md-note":
                    html += '<p class="md-help-note">' + NP.escapeHtml(NP.t(block.value)) + '</p>';
                    break;
                case "md-shortcuts":
                    html += '<div class="md-help-category">';
                    html += '<h3 class="md-help-cat-title">' + NP.escapeHtml(NP.t(block.title)) + '</h3>';
                    html += '<div class="md-help-shortcuts">';
                    for (var sr = 0; sr < block.items.length; sr++) {
                        var row2 = block.items[sr];
                        html += '<div class="md-help-shortcut-row">' +
                            '<kbd class="md-help-kbd">' + NP.escapeHtml(keyOf(row2)) + '</kbd>' +
                            '<span>' + NP.escapeHtml(NP.t("help.md.wrapSelection")) +
                            ' <code>' + NP.escapeHtml(NP.t(row2[1])) + '</code></span>' +
                            '</div>';
                    }
                    html += '</div></div>';
                    break;
            }
        }

        return html;
    }

    function copySnippet(text, sourceEl) {
        function done(ok) {
            if (ok) showCopiedFeedback(sourceEl);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () {
                done(true);
            }).catch(function () {
                done(fallbackCopy(text));
            });
            return;
        }
        done(fallbackCopy(text));
    }

    function fallbackCopy(text) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (e) {
            console.error("Copy failed:", e);
        }
        document.body.removeChild(ta);
        return ok;
    }

    function showCopiedFeedback(el) {
        if (!el) return;
        var descEl = el.querySelector(".md-help-desc");
        if (!descEl) return;
        if (!el.dataset.origDesc) {
            el.dataset.origDesc = descEl.textContent;
        }
        el.classList.add("md-help-copied");
        descEl.textContent = NP.t("help.copied");

        /* Cancel any pending revert so rapid clicks restart the timer. */
        if (el._revertTimer) clearTimeout(el._revertTimer);
        el._revertTimer = setTimeout(function () {
            el.classList.remove("md-help-copied");
            if (el.dataset.origDesc) descEl.textContent = el.dataset.origDesc;
            el._revertTimer = null;
        }, 1200);
    }

    NP.help = {

        show: function () {
            /* Already open: nothing to do */
            if (overlayEl) {
                return;
            }

            overlayEl = buildOverlay();
            document.body.appendChild(overlayEl);

            var contentEl = overlayEl.querySelector("#help-content");
            var navItems = overlayEl.querySelectorAll(".help-nav-item");

            function selectSection(idx, focus) {
                contentEl.innerHTML = renderSection(idx);   /* texts escaped in renderSection */
                contentEl.setAttribute("aria-labelledby", "help-tab-" + idx);
                for (var n = 0; n < navItems.length; n++) {
                    navItems[n].setAttribute("aria-selected", n === idx ? "true" : "false");
                    navItems[n].tabIndex = n === idx ? 0 : -1;
                }
                contentEl.scrollTop = 0;
                if (focus) navItems[idx].focus();
            }

            /* Sections: click, or ↑ ↓ Home End on the list (U2) */
            for (var i = 0; i < navItems.length; i++) {
                (function (idx) {
                    navItems[idx].addEventListener("click", function () {
                        selectSection(idx, true);
                    });
                })(i);
            }
            overlayEl.querySelector("#help-nav").addEventListener("keydown", function (e) {
                var at = Array.prototype.indexOf.call(navItems, document.activeElement);
                if (at === -1) return;
                var to = null;
                if (e.key === "ArrowDown") to = (at + 1) % navItems.length;
                else if (e.key === "ArrowUp") to = (at - 1 + navItems.length) % navItems.length;
                else if (e.key === "Home") to = 0;
                else if (e.key === "End") to = navItems.length - 1;
                else return;
                e.preventDefault();
                selectSection(to, true);
            });

            /* Delegated click-to-copy for any .md-help-item rendered into
               the content pane. Attached once on contentEl (which is
               stable across selectSection calls). */
            contentEl.addEventListener("click", function (e) {
                var item = e.target.closest && e.target.closest(".md-help-item");
                if (!item) return;
                var snippet = item.getAttribute("data-snippet");
                if (snippet == null) return;
                copySnippet(snippet, item);
            });

            /* Show first section */
            selectSection(0, false);

            /* Close button */
            overlayEl.querySelector("#help-close").addEventListener("click", function () { NP.help.hide(); });

            /* Click overlay backdrop to close */
            overlayEl.addEventListener("click", function (e) {
                if (e.target === overlayEl) {
                    NP.help.hide();
                }
            });

            /* Escape to close */
            var self = this;
            this._escHandler = function (e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    self.hide();
                }
            };
            document.addEventListener("keydown", this._escHandler, true);

            /* A window for the keyboard and screen readers (U1). */
            if (NP.modal) NP.modal.open(overlayEl, { labelledBy: "help-title", initialFocus: "#help-tab-0" });
        },

        hide: function () {
            if (this._escHandler) {
                document.removeEventListener("keydown", this._escHandler, true);
                this._escHandler = null;
            }
            var gone = overlayEl;
            if (overlayEl && overlayEl.parentNode) {
                overlayEl.parentNode.removeChild(overlayEl);
            }
            overlayEl = null;
            if (NP.modal && gone) NP.modal.close(gone);
        }
    };

})(window.NP);
