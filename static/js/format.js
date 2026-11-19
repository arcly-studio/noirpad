/* format.js - formatting of the open note.

   One set of actions for both kinds of note, by shortcut id:
     md-bold, md-italic, fmt-underline, md-strikethrough, md-link
   In a rich-text note they format the selection (the browser's editing
   commands, so Ctrl+Z undoes them; the result is <b>/<i>/<u>/<strike>/<a>,
   which editor.js _extractFormats saves as today: no new data format).
   In a Markdown note they write the syntax with markdown.js NP.markdown.edit.

   The link window (NP.format.linkWindow) is NoirPad's own: address with
   https://, http:// or mailto: only, an offer to add https:// to a bare
   address, edit and remove an existing link. */
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

    NP.format = {
        RICH: RICH,
        apply: apply,
        checkUrl: checkUrl,
        linkWindow: linkWindow,
        richState: function () { return richState(richRange()); },
        richRange: richRange,
        selectRange: selectRange,
        init: registerShortcuts
    };

})(window.NP);
