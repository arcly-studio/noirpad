/* command-bar.js - NoirPad command palette (Ctrl+Shift+P) */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* hint / desc hold translation keys, resolved with NP.t when shown
       (this table is built before the dictionaries load). */
    var COMMANDS = [
        { cmd: ":search", hint: "commands.hints.text", desc: "commands.desc.search" },
        { cmd: ":new note", hint: "commands.hints.name", desc: "commands.desc.newNote" },  // i18n-ignore (command syntax)
        { cmd: ":new folder", hint: "commands.hints.name", desc: "commands.desc.newFolder" },  // i18n-ignore (command syntax)
        { cmd: ":theme", hint: "commands.hints.name", desc: "commands.desc.theme" },
        { cmd: ":encrypt", hint: "", desc: "commands.desc.encrypt" },
        { cmd: ":decrypt", hint: "", desc: "commands.desc.decrypt" },
        { cmd: ":fullscreen", hint: "", desc: "commands.desc.fullscreen" },
        { cmd: ":autosave", hint: "", desc: "commands.desc.autosave" },
        { cmd: ":export", hint: "", desc: "commands.desc.export" },
        { cmd: ":exportpdf", hint: "", desc: "commands.desc.exportpdf" },
        { cmd: ":exporthtml", hint: "", desc: "commands.desc.exporthtml" },
        { cmd: ":focus", hint: "", desc: "commands.desc.focus" },
        { cmd: ":tag", hint: "commands.hints.name", desc: "commands.desc.tag" },
        { cmd: ":tags", hint: "", desc: "commands.desc.tags" },
        { cmd: ":fontsize", hint: "commands.hints.number", desc: "commands.desc.fontsize" },
        { cmd: ":font", hint: "", desc: "commands.desc.font" },
        { cmd: ":backup", hint: "", desc: "commands.desc.backup" },
        { cmd: ":import", hint: "", desc: "commands.desc.import" },
        { cmd: ":fav", hint: "", desc: "commands.desc.fav" },
        { cmd: ":emptytrash", hint: "", desc: "commands.desc.emptytrash" },
        { cmd: ":orientation", hint: "", desc: "commands.desc.orientation" },
        { cmd: ":rain", hint: "", desc: "commands.desc.matrix" },   /* :matrix = hidden alias */
        { cmd: ":help", hint: "", desc: "commands.desc.help" },
        { cmd: ":closetab", hint: "", desc: "commands.desc.closetab" },
        { cmd: ":closeall", hint: "", desc: "commands.desc.closeall" },
        { cmd: ":crt", hint: "", desc: "commands.desc.crt" },
        { cmd: ":settings", hint: "", desc: "commands.desc.settings" },
        { cmd: ":findall", hint: "commands.hints.text", desc: "commands.desc.findall" },
        { cmd: ":clearformat", hint: "", desc: "commands.desc.clearformat" }
    ];

    var overlay = null;
    var input = null;
    var dropdown = null;
    var selectedIdx = -1;

    function ensureDOM() {
        if (overlay) return;

        /* Looks: .np-command-* in noirpad.css. */
        overlay = document.createElement("div");
        overlay.className = "np-command-overlay";
        overlay.style.display = "none";

        var bar = document.createElement("div");
        bar.className = "np-command-bar";

        input = document.createElement("input");
        input.type = "text";
        input.className = "np-command-input";
        input.placeholder = NP.t("commands.placeholder");
        input.setAttribute("aria-label", NP.t("commands.placeholder"));
        input.spellcheck = false;

        dropdown = document.createElement("div");
        dropdown.className = "np-command-dropdown";
        dropdown.style.display = "none";

        bar.appendChild(input);
        bar.appendChild(dropdown);
        overlay.appendChild(bar);
        document.body.appendChild(overlay);

        input.addEventListener("input", onInput);
        input.addEventListener("keydown", onKeydown);
        overlay.addEventListener("mousedown", function (e) {
            if (e.target === overlay) NP.commandBar.close();
        });

        /* Force reflow then animate in */
        overlay._bar = bar;
    }

    function onInput() {
        var val = input.value.trim().toLowerCase();
        selectedIdx = -1;
        if (!val) {
            dropdown.style.display = "none";
            return;
        }
        var folded = NP.searchFold(val);   /* Czech descriptions match without diacritics */
        var matches = COMMANDS.filter(function (c) {
            return c.cmd.indexOf(val) !== -1 ||
                NP.searchFold(NP.t(c.desc)).indexOf(folded) !== -1;
        });
        /* Also check theme names: only the shown :theme names, the old
           ids are hidden aliases (N1.6). */
        if (NP.THEME_SLUGS) {
            Object.keys(NP.THEME_SLUGS).forEach(function (id) {
                var slug = NP.THEME_SLUGS[id];
                if (slug.indexOf(val) !== -1) {
                    matches.push({ cmd: slug, hint: "", desc: "commands.applyTheme" });
                }
            });
        }
        renderDropdown(matches);
    }

    function renderDropdown(matches) {
        if (!matches.length) {
            dropdown.style.display = "none";
            return;
        }
        dropdown.innerHTML = "";
        dropdown.style.display = "block";
        matches.forEach(function (m, i) {
            var item = document.createElement("div");
            item.className = "np-command-item";
            item.style.cssText = /* layout only; colours from CSS */
                "padding:6px 10px;cursor:pointer;font-family:var(--font-mono,'Consolas',monospace);" +
                "font-size:13px;color:var(--fg,#00ff41);border-radius:3px;";
            item.textContent = m.cmd + (m.hint ? " " + NP.t(m.hint) : "") +
                "  \u2014 " + NP.t(m.desc);
            item.addEventListener("mouseenter", function () {
                highlightItem(i);
            });
            item.addEventListener("click", function () {
                input.value = m.cmd + " ";
                input.focus();
                if (!m.hint) {
                    NP.commandBar.execute(m.cmd);
                }
            });
            dropdown.appendChild(item);
        });
    }

    function highlightItem(idx) {
        var items = dropdown.children;
        for (var i = 0; i < items.length; i++) {
            items[i].style.background = i === idx ? "var(--hover-bg)" : "transparent";
        }
        selectedIdx = idx;
    }

    function onKeydown(e) {
        var items = dropdown.children;
        if (e.key === "Escape") {
            e.preventDefault();
            NP.commandBar.close();
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            if (items.length) {
                selectedIdx = (selectedIdx + 1) % items.length;
                highlightItem(selectedIdx);
            }
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            if (items.length) {
                selectedIdx = selectedIdx <= 0 ? items.length - 1 : selectedIdx - 1;
                highlightItem(selectedIdx);
            }
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            if (selectedIdx >= 0 && items.length) {
                items[selectedIdx].click();
                return;
            }
            var val = input.value.trim();
            if (!val) {
                NP.commandBar.close();
                return;
            }
            NP.commandBar.execute(val);
            return;
        }
    }

    function getSelectedFolderId() {
        if (NP.state && NP.state.currentNoteId && NP.state.data) {
            /* Walk tree to find parent folder */
            return NP.tree && NP.tree.getParentId
                ? NP.tree.getParentId(NP.state.currentNoteId)
                : null;
        }
        return null;
    }

    NP.commandBar = {
        visible: false,

        open: function () {
            ensureDOM();
            clearTimeout(overlay._hideTimer);     /* reopened during the fade-out */
            overlay.style.display = "block";
            NP.commandBar.visible = true;
            input.value = "";
            dropdown.style.display = "none";
            selectedIdx = -1;
            /* Trigger slide-in */
            requestAnimationFrame(function () {
                overlay._bar.classList.add("open");
            });
            setTimeout(function () { input.focus(); }, 50);
        },

        close: function () {
            if (!overlay) return;
            NP.commandBar.visible = false;
            overlay._bar.classList.remove("open");
            clearTimeout(overlay._hideTimer);
            overlay._hideTimer = setTimeout(function () {
                overlay.style.display = "none";
            }, 200);
        },

        toggle: function () {
            if (NP.commandBar.visible) {
                NP.commandBar.close();
            } else {
                NP.commandBar.open();
            }
        },

        execute: function (cmd) {
            cmd = cmd.trim();
            var lower = cmd.toLowerCase();

            /* Theme name without colon */
            var themeId = NP.themeId ? NP.themeId(lower) : null;
            if (themeId) {
                NP.themes.apply(themeId);
                NP.commandBar.close();
                return;
            }

            /* Commands with arguments */
            if (lower.indexOf(":search ") === 0) {
                var q = cmd.substring(8).trim();
                if (q && NP.search) NP.search.find(q);
            } else if (lower.indexOf(":new note ") === 0) {  // i18n-ignore (command syntax)
                var noteName = cmd.substring(10).trim();
                if (noteName && NP.api) NP.api.newNote(getSelectedFolderId(), noteName).then(function () {
                    if (NP.state) NP.state.poll();
                    if (NP.tree) NP.tree.render();
                });
            } else if (lower.indexOf(":new folder ") === 0) {  // i18n-ignore (command syntax)
                var folderName = cmd.substring(12).trim();
                if (folderName && NP.api) NP.api.newFolder(getSelectedFolderId(), folderName).then(function () {
                    if (NP.state) NP.state.poll();
                    if (NP.tree) NP.tree.render();
                });
            } else if (lower.indexOf(":theme ") === 0) {
                var theme = cmd.substring(7).trim().toLowerCase();
                if (NP.themes) NP.themes.apply(theme);
            } else if (lower === ":encrypt") {
                if (NP.encryption) NP.encryption.encrypt();
            } else if (lower === ":decrypt") {
                if (NP.encryption) NP.encryption.decrypt();
            } else if (lower === ":fullscreen") {
                NP.fullscreen.toggle();
            } else if (lower === ":autosave") {
                if (NP.state && NP.state.data) {
                    NP.state.data.autosave = !NP.state.data.autosave;
                    if (NP.api) NP.api.saveSettings({ autosave: NP.state.data.autosave });
                    if (NP.editor && NP.editor._currentNoteId) NP.editor.startAutosave();
                }
            } else if (lower === ":export") {
                if (NP.export) NP.export.txt();
            } else if (lower === ":exportpdf") {
                if (NP.print) NP.print.exportCurrentNote();
            } else if (lower === ":exporthtml") {
                if (NP.export) NP.export.html();
            } else if (lower === ":focus") {
                if (NP.focusMode && NP.focusMode.toggle) NP.focusMode.toggle();
                else if (NP.focus && NP.focus.toggle) NP.focus.toggle();
            } else if (lower.indexOf(":tag ") === 0) {
                var tag = cmd.substring(5).trim();
                if (tag && NP.tags) NP.tags.addTag(tag);
            } else if (lower === ":tags") {
                if (NP.tags) NP.tags.showAll();
            } else if (lower.indexOf(":fontsize ") === 0) {
                var size = parseInt(cmd.substring(10).trim(), 10);
                if (size >= 6 && size <= 72) {
                    var editor = document.getElementById("editor");
                    if (editor) editor.style.fontSize = size + "px";
                    if (NP.api) NP.api.saveSettings({ font_size: size });
                    if (NP.state && NP.state.data) NP.state.data.font_size = size;
                }
            } else if (lower === ":font") {
                if (NP.fontPicker && NP.fontPicker.show) NP.fontPicker.show();
            } else if (lower === ":backup") {
                if (NP.backup) NP.backup.download();
            } else if (lower === ":import") {
                if (NP.backup) NP.backup.import();
            } else if (lower === ":fav") {
                if (NP.favorites) NP.favorites.toggle();
            } else if (lower === ":emptytrash") {
                if (NP.trash) NP.trash.empty();
            } else if (lower === ":orientation") {
                if (NP.settings && NP.settings.toggleOrientation) NP.settings.toggleOrientation();
            } else if (lower === ":rain" || lower === ":matrix") {   /* :matrix: hidden alias */
                if (NP.matrixRain && NP.matrixRain.toggle) NP.matrixRain.toggle();
            } else if (lower === ":help") {
                if (NP.help && NP.help.show) NP.help.show();
            } else if (lower === ":closetab") {
                if (NP.tabs && NP.tabs.closeCurrent) NP.tabs.closeCurrent();
            } else if (lower === ":closeall") {
                if (NP.tabs && NP.tabs.closeAll) NP.tabs.closeAll();
            } else if (lower === ":crt") {
                if (NP.effects && NP.effects.crtToggle) NP.effects.crtToggle();
            } else if (lower === ":settings") {
                if (NP.settings && NP.settings.open) NP.settings.open();
            } else if (lower.indexOf(":findall ") === 0) {
                var fq = cmd.substring(9).trim();
                if (fq && NP.findAll && NP.findAll.show) NP.findAll.show(fq);
            } else if (lower === ":findall") {
                if (NP.findAll && NP.findAll.show) NP.findAll.show("");
            } else if (lower === ":clearformat") {
                /* The palette took focus; paste.js puts the editor
                   selection back before clearing. */
                NP.commandBar.close();
                if (NP.paste && NP.paste.clearFormatting) NP.paste.clearFormatting();
                return;
            }

            NP.commandBar.close();
        }
    };

})(window.NP);
