/* format.js - formatting of the open note.

   One set of actions for both kinds of note, by shortcut id:
     md-bold, md-italic, fmt-underline, md-strikethrough, md-link
   In a rich-text note they format the selection (the browser's editing
   commands, so Ctrl+Z undoes them; the result is <b>/<i>/<u>/<strike>/<a>,
   which editor.js _extractFormats saves as today: no new data format).
   In a Markdown note they write the syntax with markdown.js NP.markdown.edit.

   The link window (NP.format.linkWindow) is NoirPad's own: address with
   https://, http:// or mailto: only, an offer to add https:// to a bare
   address, edit and remove an existing link.

   The same actions fill the Format menu (top bar, #btn-format, with the
   current keys) and the formatting part of the context menus: rich text
   in paste.js, the Markdown source here.

   Links in a rich-text note: a tooltip with the address and "Ctrl+click
   opens the link" (pointer over the link, or the caret in it), the hand
   cursor while Ctrl is held, and Open / Edit / Remove in the context menu.
   Ctrl+click itself is links.js (https, http and mailto only). */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Rich-text formats: editing command, the tag of the fallback (used
       where the browser has no editing commands, e.g. tests), the tags and
       inline styles that mean "on". */
    var RICH = {
        "md-bold": { cmd: "bold", tag: "b", tags: ["B", "STRONG"],
            css: function (s) { return s.fontWeight === "bold" || parseInt(s.fontWeight, 10) >= 600; } },
        "md-italic": { cmd: "italic", tag: "i", tags: ["I", "EM"],
            css: function (s) { return s.fontStyle === "italic"; } },
        "fmt-underline": { cmd: "underline", tag: "u", tags: ["U"],
            css: function (s) { return /underline/.test(s.textDecoration || "") || /underline/.test(s.textDecorationLine || ""); } },
        "md-strikethrough": { cmd: "strikeThrough", tag: "strike", tags: ["S", "STRIKE", "DEL"],
            css: function (s) { return /line-through/.test(s.textDecoration || "") || /line-through/.test(s.textDecorationLine || ""); } }
    };

    function editorEl() { return document.getElementById("editor"); }

    function mdOn() { return !!(NP.markdown && NP.markdown.isActive && NP.markdown.isActive()); }

    /* The rich-text editor while it can be edited (an open, unlocked note). */
    function richEditor() {
        var ed = editorEl();
        if (!ed || mdOn()) return null;
        if (ed.contentEditable !== "true" && ed.getAttribute("contenteditable") !== "true") return null;
        return ed;
    }

    function mdTextarea() {
        return NP.markdown && NP.markdown.textarea ? NP.markdown.textarea() : null;
    }

    /* The selection as a Range when it is inside the rich-text editor. */
    function richRange() {
        var ed = richEditor();
        var sel = window.getSelection();
        if (!ed || !sel || !sel.rangeCount) return null;
        var r = sel.getRangeAt(0);
        return ed.contains(r.commonAncestorContainer) ? r : null;
    }

    function selectRange(r) {
        var ed = richEditor();
        if (!ed || !r || !ed.contains(r.commonAncestorContainer)) return null;
        if (document.activeElement !== ed) {
            try { ed.focus({ preventScroll: true }); } catch (e) { ed.focus(); }
        }
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return sel.getRangeAt(0);
    }

    function fireInput() {
        var ed = editorEl();
        if (ed) ed.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /* The browser's editing command; false where there is none. */
    function exec(cmd, value) {
        if (typeof document.execCommand !== "function") return false;
        try {
            document.execCommand("styleWithCSS", false, false);
            return document.execCommand(cmd, false, value === undefined ? null : value) === true;
        } catch (e) {
            return false;
        }
    }

    /* The closest element from *node* up to the editor that has *def*. */
    function holder(node, def) {
        var ed = editorEl();
        for (var n = node; n && n !== ed; n = n.parentNode) {
            if (n.nodeType !== 1) continue;
            if (def.tags.indexOf(n.nodeName) !== -1) return n;
            if (n.style && def.css(n.style)) return n;
        }
        return null;
    }

    /* The node where the selection's text starts (not the element around
       a selection that begins at the end of a text node). */
    function startNode(r) {
        var n = r.startContainer;
        if (n.nodeType === 1 && n.childNodes[r.startOffset]) n = n.childNodes[r.startOffset];
        else if (n.nodeType === 3 && !r.collapsed && r.startOffset === n.length && n.nextSibling) n = n.nextSibling;
        return n;
    }

    function linkAt(r) {
        var ed = editorEl();
        var nodes = [startNode(r), r.endContainer];
        for (var i = 0; i < nodes.length; i++) {
            for (var n = nodes[i]; n && n !== ed; n = n.parentNode) {
                if (n.nodeName === "A" && NP.linkKind(n.getAttribute("href")) === "external") return n;
            }
        }
        return null;
    }

    function unwrap(el) {
        var parent = el.parentNode;
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
    }

    function wrapRange(r, el) {
        el.appendChild(r.extractContents());
        r.insertNode(el);
        var sel = window.getSelection();
        var nr = document.createRange();
        nr.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(nr);
    }

    function selectContents(el) {
        var r = document.createRange();
        r.selectNodeContents(el);
        return selectRange(r);
    }

    /* Which formats the selection has: {id: true|false} (Format menu). */
    function richState(r) {
        var out = {};
        var n = r ? startNode(r) : null;
        Object.keys(RICH).forEach(function (id) { out[id] = !!(n && holder(n, RICH[id])); });
        out["md-link"] = !!(r && linkAt(r));
        return out;
    }

    function toggleRich(id) {
        var def = RICH[id];
        var r = richRange();
        if (!def || !r) return;
        var on = !!holder(startNode(r), def);
        if (exec(def.cmd)) return;
        if (on) {
            unwrap(holder(startNode(r), def));
        } else if (!r.collapsed) {
            wrapRange(r, document.createElement(def.tag));
        } else {
            return;
        }
        fireInput();
    }

    /* ---------------- Link window ---------------- */

    var MAX_URL = 2000;

    /* {url} when *value* is a usable address, else {error, fix?}. */
    function checkUrl(value) {
        var v = String(value || "").trim();
        if (!v) return { error: NP.t("format.link.errorEmpty") };
        if (v.length > MAX_URL) return { error: NP.t("format.link.errorTooLong", { n: MAX_URL }) };
        if (/\s/.test(v)) return { error: NP.t("format.link.errorInvalid") };
        if (/^https?:\/\//i.test(v)) {
            var host = "";
            try { host = new URL(v).hostname; } catch (e) { host = ""; }
            return host ? { url: v } : { error: NP.t("format.link.errorInvalid") };
        }
        if (/^mailto:/i.test(v)) {
            return /^mailto:[^@]+@[^@]+$/i.test(v) ? { url: v } : { error: NP.t("format.link.errorInvalid") };
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^:]+:\d/.test(v)) {
            return { error: NP.t("format.link.errorScheme") };
        }
        if (/^[^@/]+@[^@/]+\.[^@/]+$/.test(v)) {
            return { error: NP.t("format.link.errorScheme"), fix: "mailto:" + v };
        }
        if (/^[^./][^/]*\.[^/]/.test(v)) {
            return { error: NP.t("format.link.errorScheme"), fix: "https://" + v };
        }
        return { error: NP.t("format.link.errorScheme") };
    }

    var openWindow = null;

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    /* opts: {value, canRemove}. Resolves {url} | {remove: true} | null. */
    function linkWindow(opts) {
        opts = opts || {};
        if (openWindow) openWindow.cancel();
        return new Promise(function (resolve) {
            var overlay = el("div", "dialog-overlay visible np-dialog np-link-dialog");  // i18n-ignore (CSS classes)
            var box = el("form", "dialog-box");
            box.setAttribute("novalidate", "");
            var title = el("div", "dialog-title", NP.t(opts.canRemove ? "format.link.editTitle" : "format.link.title"));
            title.id = "np-link-title";
            box.appendChild(title);

            var label = el("label", "np-link-label", NP.t("format.link.address"));
            label.setAttribute("for", "np-link-url");
            box.appendChild(label);
            var input = el("input", "dialog-input");
            input.id = "np-link-url";
            input.type = "text";
            input.value = opts.value || "";
            input.placeholder = NP.t("format.link.placeholder");
            input.setAttribute("maxlength", String(MAX_URL));
            input.setAttribute("spellcheck", "false");
            input.setAttribute("autocomplete", "off");
            input.setAttribute("aria-describedby", "np-link-error");
            box.appendChild(input);

            var error = el("div", "np-link-error");
            error.id = "np-link-error";
            error.setAttribute("role", "alert");
            box.appendChild(error);

            var buttons = el("div", "dialog-buttons");
            var remove = null;
            if (opts.canRemove) {
                remove = el("button", "dialog-btn danger np-link-remove", NP.t("format.link.remove"));
                remove.type = "button";
                buttons.appendChild(remove);
            }
            var cancel = el("button", "dialog-btn", NP.t("common.cancel"));
            cancel.type = "button";
            buttons.appendChild(cancel);
            var ok = el("button", "dialog-btn primary", NP.t("format.link.save"));
            ok.type = "submit";
            buttons.appendChild(ok);
            box.appendChild(buttons);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            function close(result) {
                if (openWindow !== state) return;
                openWindow = null;
                overlay.removeEventListener("keydown", onKey);
                if (NP.modal) NP.modal.close(overlay);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                resolve(result);
            }

            function showError(res) {
                error.replaceChildren(el("span", null, res.error));
                input.setAttribute("aria-invalid", "true");
                if (res.fix) {
                    var fix = el("button", "np-link-fix", NP.t("format.link.useFix", { url: res.fix }));
                    fix.type = "button";
                    fix.addEventListener("click", function () {
                        input.value = res.fix;
                        clearError();
                        input.focus();
                    });
                    error.appendChild(fix);
                }
            }

            function clearError() {
                error.replaceChildren();
                input.removeAttribute("aria-invalid");
            }

            function submit() {
                var res = checkUrl(input.value);
                if (res.error) {
                    showError(res);
                    input.focus();
                    return;
                }
                close({ url: res.url });
            }

            function onKey(e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close(null);
                }
            }

            box.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
            cancel.addEventListener("click", function () { close(null); });
            if (remove) remove.addEventListener("click", function () { close({ remove: true }); });
            input.addEventListener("input", clearError);
            overlay.addEventListener("keydown", onKey);

            var state = { cancel: function () { close(null); } };
            openWindow = state;
            if (NP.modal) NP.modal.open(overlay, { labelledBy: title.id, initialFocus: "#np-link-url" });
            else input.focus();
            input.select();
        });
    }

    /* Ctrl+K / "Link…" in a rich-text note: the window for the selection
       or the link the caret is in. */
    function richLink() {
        var r = richRange();
        if (!r) return Promise.resolve(false);
        var existing = linkAt(r);
        if (r.collapsed && !existing) {
            if (NP.toast) NP.toast(NP.t("format.link.noSelection"), { timeout: 3000 });
            return Promise.resolve(false);
        }
        var saved = r.cloneRange();
        return linkWindow({ value: existing ? existing.getAttribute("href") : "", canRemove: !!existing })
            .then(function (res) {
                if (!selectRange(saved) || !res) return false;
                if (existing && !existing.isConnected) existing = linkAt(saved);
                if (res.remove) {
                    if (!existing) return false;
                    selectContents(existing);
                    if (!exec("unlink")) { unwrap(existing); fireInput(); }
                    return true;
                }
                if (existing) {
                    selectContents(existing);
                    if (!exec("createLink", res.url)) { existing.setAttribute("href", res.url); fireInput(); }
                    return true;
                }
                if (!exec("createLink", res.url)) {
                    var a = document.createElement("a");
                    a.setAttribute("href", res.url);
                    wrapRange(window.getSelection().getRangeAt(0), a);
                    fireInput();
                }
                return true;
            });
    }

    /* ---------------- Clear formatting ---------------- */

    /* Everything "Clear formatting" removes: the text formats, links and
       styled runs (colour, background, font, size). A span with a class
       belongs to something else (code block, image) and stays. */
    var CLEAR_TAGS = /^(B|STRONG|I|EM|U|S|STRIKE|DEL|INS|A|FONT|SPAN|SUB|SUP|MARK)$/;

    function inCode(n) {
        var el = n.nodeType === 1 ? n : n.parentNode;
        return !!(el && el.closest && el.closest("pre"));
    }

    function isFormatEl(n) {
        return n.nodeType === 1 && CLEAR_TAGS.test(n.nodeName) && !inCode(n) &&
            !(n.nodeName === "SPAN" && n.className);
    }

    /* The outermost formatting element around *node* inside the editor. */
    function topFormat(node) {
        var ed = editorEl(), top = null;
        for (var n = node; n && n !== ed; n = n.parentNode) {
            if (isFormatEl(n)) top = n;
        }
        return top;
    }

    function hasContent(n) {
        return n.textContent !== "" || !!(n.querySelector && n.querySelector("img,br,pre"));
    }

    /* Text nodes with at least one character inside *r*. */
    function selectedTexts(r) {
        var root = r.commonAncestorContainer;
        if (root.nodeType === 3) return r.collapsed ? [] : [root];
        var out = [];
        var walker = document.createTreeWalker(root, 4);
        for (var t = walker.nextNode(); t; t = walker.nextNode()) {
            if (!r.intersectsNode(t)) continue;
            if (t === r.startContainer && r.startOffset >= t.length) continue;
            if (t === r.endContainer && r.endOffset === 0) continue;
            if (t.length) out.push(t);
        }
        return out;
    }

    function formattedText(r) {
        return selectedTexts(r).some(function (t) { return !inCode(t) && !!topFormat(t.parentNode); });
    }

    /* Unwrap every formatting element under *root* (code blocks untouched). */
    function stripFormats(root) {
        var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (var i = all.length - 1; i >= 0; i--) {
            if (isFormatEl(all[i])) unwrap(all[i]);
        }
    }

    /* Formatting elements left empty by splitting a run at the edges. */
    function dropEmpty(root) {
        var all = root.querySelectorAll("*");
        for (var i = all.length - 1; i >= 0; i--) {
            if (isFormatEl(all[i]) && !hasContent(all[i]) && all[i].parentNode) {
                all[i].parentNode.removeChild(all[i]);
            }
        }
    }

    /* Without the browser's editing commands (tests) or where they left a
       format: split the runs at the selection's edges, unwrap everything
       in between, select the same text again. */
    function clearDom(r) {
        var ed = editorEl();
        var first, last;
        var outer = topFormat(r.commonAncestorContainer);
        if (outer) {
            /* The selection is inside one run: cut off the parts before and
               after it as copies of the run, then unwrap the run. */
            var before = document.createRange();
            before.setStart(outer, 0);
            before.setEnd(r.startContainer, r.startOffset);
            var head = before.extractContents();
            if (hasContent(head)) {
                var h = outer.cloneNode(false);
                h.appendChild(head);
                outer.parentNode.insertBefore(h, outer);
            }
            var after = document.createRange();
            after.setStart(r.endContainer, r.endOffset);
            after.setEnd(outer, outer.childNodes.length);
            var tail = after.extractContents();
            if (hasContent(tail)) {
                var t = outer.cloneNode(false);
                t.appendChild(tail);
                outer.parentNode.insertBefore(t, outer.nextSibling);
            }
            stripFormats(outer);
            first = outer.firstChild;
            last = outer.lastChild;
            unwrap(outer);
        } else {
            /* Partly selected runs are split by extractContents. */
            var box = document.createElement("div");
            box.appendChild(r.extractContents());
            stripFormats(box);
            first = box.firstChild;
            last = box.lastChild;
            var frag = document.createDocumentFragment();
            while (box.firstChild) frag.appendChild(box.firstChild);
            r.insertNode(frag);
        }
        dropEmpty(ed);
        if (first && last && ed.contains(first) && ed.contains(last)) {
            var nr = document.createRange();
            nr.setStartBefore(first);
            nr.setEndAfter(last);
            selectRange(nr);
        }
        fireInput();
    }

    /* Clear formatting of *r* (already the editor's selection): bold,
       italic, underline, strike, links, colour, background, font and size.
       The browser's commands first (Ctrl+Z undoes them), the DOM for what
       they leave. */
    function clearRange(r) {
        if (!r || r.collapsed) return false;
        selectRange(r);
        var done = exec("removeFormat");
        if (done) exec("unlink");
        var cur = richRange() || r;
        if (!cur.collapsed && formattedText(cur)) clearDom(cur);
        return true;
    }

    /* ---------------- Links in a rich-text note ---------------- */

    /* The external link around *node* in the editable note, or null. */
    function linkFrom(node) {
        var ed = richEditor();
        if (!ed || !node) return null;
        for (var n = node; n && n !== ed; n = n.parentNode) {
            if (n.nodeName === "A" && NP.linkKind(n.getAttribute("href")) === "external") {
                return ed.contains(n) ? n : null;
            }
        }
        return null;
    }

    function hrefOf(a) { return (a.getAttribute("href") || "").trim(); }

    /* Only https, http and mailto (NP.linkKind), never in the app window. */
    function openLink(a) {
        hideTip();
        var href = hrefOf(a);
        if (NP.linkKind(href) !== "external") return false;
        window.open(href, "_blank", "noopener,noreferrer");
        return true;
    }

    function editLink(a) {
        hideTip();
        if (!selectContents(a)) return Promise.resolve(false);
        return richLink();
    }

    function removeLink(a) {
        hideTip();
        if (!selectContents(a)) return false;
        if (!exec("unlink")) { unwrap(a); fireInput(); }
        return true;
    }

    /* Context menu over a link (paste.js). */
    function linkItems(a) {
        return [
            { id: "link-open", icon: "external-link", label: NP.t("format.link.open"),
                keys: NP.t("format.link.openKeys"), run: function () { openLink(a); } },
            { id: "link-edit", icon: "pencil", label: NP.t("format.link.edit"),
                keys: (NP.shortcuts && NP.shortcuts.getCurrent("md-link")) || "",
                run: function () { editLink(a); } },
            { id: "link-remove", icon: "unlink", label: NP.t("format.link.remove"),
                run: function () { removeLink(a); } }
        ];
    }

    /* Tooltip: the address (as text) and how to open it. */
    var TIP_DELAY = 400;
    var tip = null, tipLink = null, tipTimer = null;

    function shortUrl(u) {
        return u.length > 64 ? u.slice(0, 44) + "\u2026" + u.slice(-16) : u;
    }

    function hideTip() {
        clearTimeout(tipTimer);
        tipTimer = null;
        tipLink = null;
        if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
        tip = null;
    }

    function showTip(a) {
        hideTip();
        /* Never under an open menu (a right-click also moves the caret in). */
        if (!a || !a.isConnected || (NP.menu && NP.menu.isOpen && NP.menu.isOpen())) return;
        tipLink = a;
        tip = document.createElement("div");
        tip.className = "np-link-tip";
        tip.id = "np-link-tip";
        tip.setAttribute("role", "tooltip");
        var url = document.createElement("div");
        url.className = "np-link-tip-url";
        url.textContent = shortUrl(hrefOf(a));
        var hint = document.createElement("div");
        hint.className = "np-link-tip-hint";
        hint.textContent = NP.t("format.link.tipHint");
        tip.appendChild(url);
        tip.appendChild(hint);
        document.body.appendChild(tip);
        var r = a.getBoundingClientRect();
        var box = tip.getBoundingClientRect();
        var x = Math.max(4, Math.min(r.left, window.innerWidth - box.width - 4));
        var y = r.bottom + 6;
        if (y + box.height > window.innerHeight - 4) y = Math.max(4, r.top - box.height - 6);
        tip.style.left = x + "px";
        tip.style.top = y + "px";
    }

    function tipLater(a) {
        if (a === tipLink && tip) return;
        clearTimeout(tipTimer);
        tipTimer = setTimeout(function () { showTip(a); }, TIP_DELAY);
    }

    function onLinkOver(e) {
        var a = linkFrom(e.target);
        if (a) tipLater(a);
    }

    function onLinkOut(e) {
        var a = linkFrom(e.target);
        if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
        /* The caret may still be in this link: then the tip stays. */
        var r = richRange();
        if (r && r.collapsed && linkFrom(r.startContainer) === a) return;
        hideTip();
    }

    /* The caret moved: a tip for the link it is in (keyboard users). */
    function onCaret() {
        var r = richRange();
        var a = r && r.collapsed && document.activeElement === editorEl() ? linkFrom(r.startContainer) : null;
        if (a) tipLater(a);
        else if (tip || tipTimer) hideTip();
    }

    /* Hand cursor over links while Ctrl is held. */
    function onCtrl(e) {
        var on = e.type === "keydown" ? (e.key === "Control" || e.ctrlKey) : (e.ctrlKey && e.key !== "Control");
        if (e.type === "blur") on = false;
        document.body.classList.toggle("np-ctrl-down", !!on);
    }

    function bindLinks(ed) {
        if (ed._npLinkTips) return;
        ed._npLinkTips = true;
        ed.addEventListener("mouseover", onLinkOver);
        ed.addEventListener("mouseout", onLinkOut);
        ed.addEventListener("mousedown", hideTip);
        ed.addEventListener("input", hideTip);
        document.addEventListener("selectionchange", onCaret);
        document.addEventListener("scroll", hideTip, true);
        document.addEventListener("keydown", onCtrl, true);
        document.addEventListener("keyup", onCtrl, true);
        window.addEventListener("blur", function (e) { hideTip(); onCtrl(e); });
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape" && tip) hideTip();
        }, true);
    }

    /* ---------------- Actions ---------------- */

    var SHARED = ["md-bold", "md-italic", "fmt-underline", "md-strikethrough", "md-link"];

    /* Run *id* on the open note. Rich text: on the current selection;
       Markdown: in the source. Returns false when it does not apply. */
    function apply(id) {
        var ta = mdTextarea();
        if (ta) {
            var fn = NP.markdown.edit && NP.markdown.edit[id];
            if (!fn) return false;
            fn(ta);
            return true;
        }
        if (!richRange()) return false;
        if (id === "md-link") { richLink(); return true; }
        if (RICH[id]) { toggleRich(id); return true; }
        if (id === "clear-formatting" && NP.paste) return NP.paste.clearFormatting();
        return false;
    }

    /* A shortcut works while a note's editor has the focus. */
    function editorFocused() {
        var a = document.activeElement;
        var ta = mdTextarea();
        if (ta) return a === ta ? "md" : null;
        var ed = richEditor();
        return ed && a === ed ? "rich" : null;
    }

    function registerShortcuts() {
        if (!NP.shortcuts || !NP.shortcuts.register) return;
        SHARED.forEach(function (id) {
            NP.shortcuts.register(id, function () {
                var where = editorFocused();
                if (!where) return false;
                /* No Markdown for underline: the key does nothing there
                   (and the browser's Ctrl+U never opens). */
                if (where === "md" && !(NP.markdown.edit && NP.markdown.edit[id])) return true;
                apply(id);
                return true;
            });
        });
    }

    /* ---------------- Format menu and context menus ---------------- */

    /* [id, icon, label key]; "-" = separator. The key shown next to an
       item is the one set in the shortcut list (none = nothing shown). */
    var RICH_ITEMS = [
        ["md-bold", "bold", "format.items.bold"],
        ["md-italic", "italic", "format.items.italic"],
        ["fmt-underline", "underline", "format.items.underline"],
        ["md-strikethrough", "strikethrough", "format.items.strike"],
        "-",
        ["md-link", "link", "format.items.link"],
        "-",
        ["clear-formatting", "eraser", "format.items.clear"]
    ];
    var MD_ITEMS = [
        ["md-bold", "bold", "format.items.bold"],
        ["md-italic", "italic", "format.items.italic"],
        ["md-strikethrough", "strikethrough", "format.items.strike"],
        ["md-code-inline", "code", "format.items.code"],
        "-",
        ["md-link", "link", "format.items.link"],
        ["md-image", "image", "format.items.image"],
        "-",
        ["md-h1", "heading-1", "format.items.h1"],
        ["md-h2", "heading-2", "format.items.h2"],
        ["md-h3", "heading-3", "format.items.h3"],
        ["md-quote", "text-quote", "format.items.quote"],
        ["md-list-bullet", "list", "format.items.bullets"],
        ["md-list-numbered", "list-ordered", "format.items.numbered"],
        ["md-task", "list-todo", "format.items.task"],
        ["md-code-block", "square-code", "format.items.codeBlock"],
        ["md-horizontal-rule", "minus", "format.items.rule"]
    ];
    /* Context menus: the inline formats only (lines and blocks stay in
       the Format menu). */
    var MD_CONTEXT = ["md-bold", "md-italic", "md-strikethrough", "md-code-inline", "-", "md-link"];
    var RICH_CONTEXT = ["md-bold", "md-italic", "fmt-underline", "md-strikethrough", "-", "md-link"];

    function keysOf(id) {
        return (NP.shortcuts && NP.shortcuts.getCurrent && NP.shortcuts.getCurrent(id)) || "";
    }

    /* Menu items for the open note; *only* limits them to those ids.
       Rich text: a format needs selected text (a link also works with the
       caret in a link); the formats the selection has are checked. */
    function buildItems(only, range) {
        var md = !!mdTextarea();
        var list = md ? MD_ITEMS : RICH_ITEMS;
        if (only) {
            list = only.map(function (id) {
                if (id === "-") return "-";
                return list.filter(function (it) { return it !== "-" && it[0] === id; })[0];
            }).filter(Boolean);
        }
        var r = md ? null : (range || richRange());
        var state = md ? {} : richState(r);
        var selected = !!(r && !r.collapsed);
        return list.map(function (it) {
            if (it === "-") return "-";
            var id = it[0];
            var item = { id: id, icon: it[1], label: NP.t(it[2]), keys: keysOf(id),
                run: function () { apply(id); } };
            if (!md) {
                if (RICH[id] || id === "md-link") item.checked = !!state[id];
                item.disabled = id === "md-link" ? !(selected || state["md-link"]) : !selected;
            }
            return item;
        });
    }

    /* The selection to give back to the editor when the menu closes
       (Escape, Tab or an item): the menu takes the focus meanwhile. */
    function rememberSelection(range) {
        var ta = mdTextarea();
        if (ta) {
            var s = ta.selectionStart, e = ta.selectionEnd;
            return function () {
                try { ta.focus({ preventScroll: true }); } catch (err) { ta.focus(); }
                ta.setSelectionRange(s, e);
            };
        }
        var saved = range ? range.cloneRange() : null;
        return function () {
            if (saved) selectRange(saved);
            else if (richEditor()) richEditor().focus();
        };
    }

    function canFormat() {
        return !!(mdTextarea() || richEditor());
    }

    /* The editor's last selection: a click or Tab onto the Format button
       may take it from the document before the menu opens. */
    var lastRange = null;

    function trackSelection() {
        var r = richRange();
        if (r) lastRange = r.cloneRange();
    }

    function menuRange() {
        var r = richRange();
        if (r) return r;
        var ed = richEditor();
        return lastRange && ed && ed.contains(lastRange.commonAncestorContainer) ? lastRange : null;
    }

    /* The Format button in the top bar. */
    function openMenu(anchor) {
        if (!NP.menu || !canFormat()) return null;
        var r = mdTextarea() ? null : menuRange();
        return NP.menu.open(anchor, buildItems(null, r), {
            label: NP.t("format.menu"),
            returnFocus: rememberSelection(r)
        });
    }

    /* Right-click on selected Markdown source: cut / copy / paste and the
       inline formats. Shift+right-click: the system menu. */
    function onSourceContextMenu(e) {
        var ta = mdTextarea();
        if (!ta || e.target !== ta || e.shiftKey || !NP.menu) return;
        if (ta.selectionStart === ta.selectionEnd) return;
        e.preventDefault();
        var items = [
            { id: "cut", label: NP.t("editor.menu.cut"), keys: "Ctrl+X",
                run: function () { document.execCommand("cut"); } },
            { id: "copy", label: NP.t("editor.menu.copy"), keys: "Ctrl+C",
                run: function () { document.execCommand("copy"); } },
            { id: "paste", label: NP.t("editor.menu.paste"), keys: "Ctrl+V",
                run: function () { pasteIntoSource(ta); } },
            "-"
        ].concat(buildItems(MD_CONTEXT));
        NP.menu.open({ x: e.clientX, y: e.clientY }, items,
            { keepFocus: true, label: NP.t("format.menu"), footer: NP.t("editor.menu.systemHint") });
    }

    function pasteIntoSource(ta) {
        var s = ta.selectionStart, e = ta.selectionEnd;
        var cb = navigator.clipboard;
        function fail() {
            if (NP.toast) NP.toast(NP.t("editor.menu.pasteBlocked"), { timeout: 4000 });
        }
        if (!cb || !cb.readText) { fail(); return; }
        cb.readText().then(function (text) {
            if (!text) return;
            ta.focus();
            ta.setRangeText(text, s, e, "end");
            ta.dispatchEvent(new Event("input", { bubbles: true }));
        }).catch(fail);
    }

    function init() {
        registerShortcuts();
        var ed = editorEl();
        if (ed && !ed._npFormatTrack) {
            ed._npFormatTrack = true;
            document.addEventListener("selectionchange", trackSelection);
            ed.addEventListener("focusout", trackSelection);
            ed.addEventListener("keyup", trackSelection);
            ed.addEventListener("mouseup", trackSelection);
        }
        if (ed) bindLinks(ed);
        var ta = document.getElementById("editor-md");
        if (ta && !ta._npFormatMenu) {
            ta._npFormatMenu = true;
            ta.addEventListener("contextmenu", onSourceContextMenu);
        }
    }

    NP.format = {
        RICH: RICH,
        apply: apply,
        checkUrl: checkUrl,
        linkWindow: linkWindow,
        richState: function () { return richState(richRange()); },
        richRange: richRange,
        clearRange: clearRange,
        /* Links in a rich-text note (paste.js context menu). */
        linkFrom: linkFrom,
        linkItems: linkItems,
        openLink: openLink,
        hideTip: hideTip,
        selectRange: selectRange,
        canFormat: canFormat,
        menuItems: buildItems,
        /* The formats for the rich-text context menu (paste.js). */
        contextItems: function () { return buildItems(mdTextarea() ? MD_CONTEXT : RICH_CONTEXT); },
        openMenu: openMenu,
        init: init
    };

})(window.NP);
