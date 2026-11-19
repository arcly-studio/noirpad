/* topbar.js - the one-row top bar (NOIRPAD · open notes · tool icons),
   the shared popup menu and the icon helper.

   Icons come from static/vendor/lucide/sprite.svg (tools/vendor.mjs):
       NP.icon("star")  →  <svg class="np-icon"><use href="…#i-star"></use></svg>

   Tool buttons carry data-label (i18n key) and optionally data-shortcut
   (shortcut registry id); the tooltip "Label (Ctrl+M)" is built when the
   pointer or focus reaches the button, so a remapped shortcut or a new
   UI language always shows up. aria-label is the plain label (i18n.js).

   NP.menu.open(anchor, items) is the popup used by Export, ⋯ and the
   context menus: arrow keys / Home / End move, Enter or Space runs,
   Escape closes and gives focus back to the anchor. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var SPRITE = "/static/vendor/lucide/sprite.svg";
    var SVG_NS = "http://www.w3.org/2000/svg";

    NP.icon = function (name, extraClass) {
        var svg = document.createElementNS(SVG_NS, "svg");
        svg.setAttribute("class", "np-icon" + (extraClass ? " " + extraClass : ""));
        svg.setAttribute("aria-hidden", "true");
        var use = document.createElementNS(SVG_NS, "use");
        use.setAttribute("href", SPRITE + "#i-" + name);
        svg.appendChild(use);
        return svg;
    };

    function setIcon(btn, name) {
        var use = btn && btn.querySelector("use");
        if (use) use.setAttribute("href", SPRITE + "#i-" + name);
    }

    /* "Ctrl+M" for a registry id, "" when unbound. */
    function shortcutOf(id) {
        return (id && NP.shortcuts && NP.shortcuts.getCurrent && NP.shortcuts.getCurrent(id)) || "";
    }

    function withShortcut(label, keys) {
        return keys ? label + " (" + keys + ")" : label;
    }

    /* ---------------- Popup menu ---------------- */

    var openMenu = null;   /* { el, anchor, onClose } */

    function closeMenu(restoreFocus) {
        if (!openMenu) return;
        var m = openMenu;
        openMenu = null;
        if (m.el.parentNode) m.el.parentNode.removeChild(m.el);
        document.removeEventListener("mousedown", m.away, true);
        document.removeEventListener("keydown", m.escape, true);
        window.removeEventListener("blur", m.blur);
        window.removeEventListener("resize", m.blur);
        if (m.anchor && m.anchor.setAttribute) m.anchor.setAttribute("aria-expanded", "false");
        if (restoreFocus && m.returnFocus) m.returnFocus();
        else if (restoreFocus && m.anchor && m.anchor.focus) m.anchor.focus();
        if (m.onClose) m.onClose();
    }

    function menuItems(el) {
        return Array.prototype.slice.call(el.querySelectorAll(".np-menu-item:not([disabled])"));
    }

    NP.menu = {
        /* anchor: an element (the menu opens under it, right-aligned when
           it would leave the window) or {x, y} (context menus).
           items: [{label, keys, icon, run, danger, disabled, checked}] or
           "-" for a separator. opts: {keepFocus, onClose, label, footer,
           returnFocus}: returnFocus() replaces "focus back to the anchor"
           (the Format menu gives the editor its selection back). */
        open: function (anchor, items, opts) {
            opts = opts || {};
            closeMenu(false);

            var el = document.createElement("div");
            el.className = "np-menu";
            el.setAttribute("role", "menu");
            if (opts.label) el.setAttribute("aria-label", opts.label);

            items.forEach(function (it) {
                if (it === "-") {
                    var sep = document.createElement("div");
                    sep.className = "np-menu-sep";
                    sep.setAttribute("role", "separator");
                    el.appendChild(sep);
                    return;
                }
                var b = document.createElement("button");
                b.type = "button";
                b.className = "np-menu-item" + (it.danger ? " np-menu-item--danger" : "");
                b.setAttribute("role", it.checked === undefined ? "menuitem" : "menuitemcheckbox");
                if (it.checked !== undefined) b.setAttribute("aria-checked", it.checked ? "true" : "false");
                if (it.disabled) b.disabled = true;
                if (it.id) b.setAttribute("data-id", it.id);
                b.tabIndex = -1;
                var icon = it.icon ? NP.icon(it.icon) : document.createElement("span");
                if (!it.icon) icon.className = "np-icon np-icon--blank";
                b.appendChild(icon);
                var label = document.createElement("span");
                label.className = "np-menu-label";
                label.textContent = it.label;
                b.appendChild(label);
                if (it.keys) {
                    var k = document.createElement("span");
                    k.className = "np-menu-keys";
                    k.textContent = it.keys;
                    b.appendChild(k);
                }
                /* Context menus over the editor keep its selection. */
                if (opts.keepFocus) {
                    b.addEventListener("mousedown", function (e) { e.preventDefault(); });
                }
                b.addEventListener("click", function (e) {
                    e.stopPropagation();
                    closeMenu(!opts.keepFocus);
                    if (it.run) it.run();
                });
                el.appendChild(b);
            });

            if (opts.footer) {
                var foot = document.createElement("div");
                foot.className = "np-menu-footer";
                foot.textContent = opts.footer;
                el.appendChild(foot);
            }

            el.addEventListener("keydown", function (e) {
                var list = menuItems(el);
                var i = list.indexOf(document.activeElement);
                var to = null;
                if (e.key === "ArrowDown") to = list[(i + 1) % list.length];
                else if (e.key === "ArrowUp") to = list[(i - 1 + list.length) % list.length];
                else if (e.key === "Home") to = list[0];
                else if (e.key === "End") to = list[list.length - 1];
                else if (e.key === "Tab") { e.preventDefault(); closeMenu(true); return; }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
                else return;
                e.preventDefault();
                if (to) to.focus();
            });

            document.body.appendChild(el);

            /* Position: under the anchor, or at the pointer. */
            var x, y;
            if (anchor && anchor.getBoundingClientRect) {
                var r = anchor.getBoundingClientRect();
                x = r.left;
                y = r.bottom + 4;
                anchor.setAttribute("aria-expanded", "true");
            } else {
                x = (anchor && anchor.x) || 0;
                y = (anchor && anchor.y) || 0;
            }
            el.style.left = x + "px";
            el.style.top = y + "px";
            var box = el.getBoundingClientRect();
            if (box.right > window.innerWidth - 4) {
                var right = anchor && anchor.getBoundingClientRect
                    ? anchor.getBoundingClientRect().right : window.innerWidth - 4;
                el.style.left = Math.max(4, right - box.width) + "px";
            }
            if (box.bottom > window.innerHeight - 4) {
                el.style.top = Math.max(4, window.innerHeight - box.height - 4) + "px";
            }

            var state = {
                el: el,
                anchor: anchor && anchor.setAttribute ? anchor : null,
                onClose: opts.onClose,
                returnFocus: opts.returnFocus,
                away: function (e) {
                    if (el.contains(e.target)) return;
                    /* A click on the anchor itself closes (and the anchor's
                       click handler must not reopen it). */
                    if (state.anchor && state.anchor.contains(e.target)) {
                        var a = state.anchor;
                        a._npJustClosed = true;
                        /* Pressed and dragged away: no click follows. */
                        setTimeout(function () { a._npJustClosed = false; }, 400);
                    }
                    closeMenu(false);
                },
                blur: function () { closeMenu(false); },
                /* Escape works even when no item has focus (all disabled,
                   or a context menu that keeps the editor's focus). */
                escape: function (e) {
                    /* A context menu over the editor (keepFocus) goes away
                       as soon as the user types on. */
                    if (e.key !== "Escape") {
                        if (opts.keepFocus && !/^(Shift|Control|Alt|Meta|ContextMenu)$/.test(e.key)) closeMenu(false);
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    closeMenu(!opts.keepFocus);
                }
            };
            openMenu = state;
            setTimeout(function () {
                if (openMenu !== state) return;
                document.addEventListener("mousedown", state.away, true);
                document.addEventListener("keydown", state.escape, true);
                window.addEventListener("blur", state.blur);
                window.addEventListener("resize", state.blur);
            }, 0);
            if (!opts.keepFocus) {
                var first = menuItems(el)[0];
                if (first) first.focus();
            }
            return el;
        },

        close: function () { closeMenu(false); },
        isOpen: function () { return !!openMenu; }
    };

    /* An anchor button toggles its menu. */
    function toggleMenu(btn, build, label) {
        if (btn._npJustClosed) { btn._npJustClosed = false; return; }
        if (openMenu && openMenu.anchor === btn) { closeMenu(true); return; }
        NP.menu.open(btn, build(), { label: label });
    }

    /* ---------------- Menus ---------------- */

    function hasNote() {
        return !!(NP.state && NP.state.currentNoteId && NP.editor && NP.editor._loadedNoteId);
    }

    function exportItems() {
        var none = !hasNote();
        return [
            { id: "txt", icon: "file-text", label: NP.t("ui.topBar.exportTxt"), disabled: none,
                run: function () { NP.export.txt(); } },
            { id: "html", icon: "file-code", label: NP.t("ui.topBar.exportHtml"), disabled: none,
                run: function () { NP.export.html(); } },
            { id: "pdf", icon: "download", label: NP.t("ui.topBar.exportPdf"), disabled: none,
                run: function () { if (NP.print) NP.print.exportCurrentNote(); } },
            { id: "md", icon: "file-code", label: NP.t("ui.topBar.exportMd"), disabled: none,
                run: function () { NP.export.md(); } }
        ];
    }

    function moreItems() {
        return [
            { id: "commands", icon: "keyboard", label: NP.t("ui.topBar.commands"),
                keys: shortcutOf("open-command-palette"),
                run: function () { if (NP.commandBar) NP.commandBar.open(); } },
            { id: "focus", icon: "panel-left", label: NP.t("ui.topBar.focusMode"),
                keys: shortcutOf("toggle-sidebar"),
                run: function () { if (NP.focusMode) NP.focusMode.toggle(); } },
            { id: "fullscreen", icon: "maximize-2", label: NP.t("ui.topBar.fullscreen"),
                keys: shortcutOf("fullscreen"),
                run: function () { if (NP.fullscreen) NP.fullscreen.toggle(); } },
            { id: "font", icon: "type", label: NP.t("ui.topBar.font"),
                keys: shortcutOf("open-font-picker"),
                run: function () { if (NP.fontPicker) NP.fontPicker.show(); } },
            "-",
            { id: "backup", icon: "archive", label: NP.t("ui.topBar.backup"),
                run: function () { if (NP.backup) NP.backup.download(); } },
            "-",
            { id: "shortcuts", icon: "keyboard", label: NP.t("ui.topBar.shortcuts"),
                run: function () { if (NP.shortcutsManager) NP.shortcutsManager.open(); } },
            { id: "settings", icon: "settings", label: NP.t("ui.topBar.settings"),
                keys: shortcutOf("open-settings"),
                run: function () { if (NP.settings) NP.settings.open(); } },
            { id: "help", icon: "circle-question-mark", label: NP.t("ui.topBar.help"),
                keys: shortcutOf("open-help"),
                run: function () { if (NP.help) NP.help.show(); } }
        ];
    }

    /* ---------------- State ---------------- */

    function mdActive() {
        return !!(NP.markdown && NP.markdown.isActive && NP.markdown.isActive());
    }

    function splitOn() {
        return !(NP.state && NP.state.data && NP.state.data.md_split === false);
    }

    function setPressed(btn, on) {
        if (!btn) return;
        btn.classList.toggle("active", !!on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
    }

    NP.topbar = {
        init: function () {
            var tools = document.getElementById("top-tools");
            if (!tools || tools._npBound) return;
            tools._npBound = true;

            /* Tooltips with the live shortcut. */
            function title(e) {
                var b = e.target.closest ? e.target.closest(".tb-btn") : null;
                if (!b) return;
                var label = b.getAttribute("data-title-key") || b.getAttribute("data-label");
                b.title = withShortcut(NP.t(label), shortcutOf(b.getAttribute("data-shortcut")));
            }
            tools.addEventListener("mouseover", title);
            tools.addEventListener("focusin", title);

            var exp = document.getElementById("btn-export");
            if (exp) exp.addEventListener("click", function () {
                toggleMenu(exp, exportItems, NP.t("ui.topBar.export"));
            });
            var more = document.getElementById("btn-more");
            if (more) more.addEventListener("click", function () {
                toggleMenu(more, moreItems, NP.t("ui.topBar.more"));
            });
            var split = document.getElementById("btn-split");
            if (split) split.addEventListener("click", NP.topbar.toggleSplit);
            /* Format menu (format.js): every format the open note's editor has. */
            var fmt = document.getElementById("btn-format");
            if (fmt) fmt.addEventListener("click", function () {
                if (fmt._npJustClosed) { fmt._npJustClosed = false; return; }
                if (openMenu && openMenu.anchor === fmt) { closeMenu(true); return; }
                if (NP.format) NP.format.openMenu(fmt);
            });

            /* The tab strip scrolls sideways with the mouse wheel. */
            var strip = document.getElementById("tab-bar");
            if (strip) strip.addEventListener("wheel", function (e) {
                if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && strip.scrollWidth > strip.clientWidth) {
                    strip.scrollLeft += e.deltaY;
                    e.preventDefault();
                }
            }, { passive: false });

            NP.topbar.applySplit();
            NP.topbar.refresh();
        },

        /* Markdown: preview next to the source, or the source alone. */
        toggleSplit: function () {
            if (!mdActive()) return;
            var on = !splitOn();
            if (NP.state && NP.state.data) NP.state.data.md_split = on;
            if (NP.api && NP.api.saveSettings) {
                Promise.resolve(NP.api.saveSettings({ md_split: on })).catch(function (err) {
                    if (NP.dialog && NP.dialog.failed) NP.dialog.failed(err);
                });
            }
            NP.topbar.applySplit();
            NP.topbar.refresh();
        },

        applySplit: function () {
            document.body.classList.toggle("md-no-preview", !splitOn());
        },

        /* Pressed / disabled state of the tools for the open note. */
        refresh: function () {
            var id = NP.state && NP.state.currentNoteId;
            var md = mdActive();
            setPressed(document.getElementById("btn-md-toggle"), md);

            var fmt = document.getElementById("btn-format");
            if (fmt) fmt.disabled = !(NP.format && NP.format.canFormat());

            var split = document.getElementById("btn-split");
            if (split) {
                setPressed(split, md && splitOn());
                split.disabled = !md;
                split.setAttribute("data-title-key", md ? "ui.topBar.split" : "ui.topBar.splitMdOnly");
            }

            var fav = document.getElementById("btn-favorite");
            setPressed(fav, !!(id && NP.favorites && NP.favorites.isFavorite(id)));
            /* A note shown from the trash: no star (T9). */
            if (fav) fav.disabled = !!(id && NP.editor && NP.editor._trashedId === id);

            var lock = document.getElementById("btn-lock");
            var ed = NP.editor;
            if (lock) {
                var encrypted = !!(ed && ed._currentNoteId && ed._currentNoteEncrypted);
                var unlocked = encrypted && !!ed._unlockToken;
                setPressed(lock, encrypted);
                setIcon(lock, unlocked ? "lock-open" : "lock");
                var key = !encrypted ? "ui.topBar.lock"
                    : unlocked ? "ui.topBar.removeLock" : "ui.topBar.unlock";
                lock.setAttribute("data-title-key", key);
                lock.setAttribute("aria-label", NP.t(key));
                lock.title = withShortcut(NP.t(key), shortcutOf("toggle-lock"));
            }
        }
    };

})(window.NP);
