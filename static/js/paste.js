/* paste.js - what goes into the rich-text editor from the clipboard.

   Pasted HTML keeps its structure, never its look:
     kept     <b>/<strong>, <i>/<em>, <u>, <s>/<del>, links (http/https/
              mailto, as everywhere else), lines of paragraphs, headings,
              list items and table rows, <br>, NoirPad's own images and
              code blocks
     dropped  colours, backgrounds, fonts, sizes, classes, <font>, any
              other element (its text stays)
   Bold comes only from <b>/<strong> or a font-weight >= 600 on an inline
   run (<span>), never from a block wrapper: browsers copy the page's
   inherited style onto the outer element, and Google Docs wraps the whole
   fragment in <b style="font-weight:normal">.

   The result is exactly what a note can store (editor.js: text + format
   runs), so it looks the same after a reload.

   Ctrl+Shift+V pastes plain text. "Clear formatting" (Ctrl+Space,
   command bar, editor context menu) runs the selection through the same
   cleaner: colours, backgrounds, fonts and sizes go, bold / italic /
   underline / strike / links stay. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var SKIP = /^(SCRIPT|STYLE|HEAD|TITLE|META|LINK|TEMPLATE|IFRAME|OBJECT|EMBED|SVG|MATH|NOSCRIPT|BUTTON|INPUT|SELECT|TEXTAREA|CANVAS|AUDIO|VIDEO|XML)$/;
    var BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|DL|DT|DD|TABLE|THEAD|TBODY|TFOOT|TR|TD|TH|CAPTION|BLOCKQUOTE|PRE|SECTION|ARTICLE|HEADER|FOOTER|MAIN|NAV|ASIDE|ADDRESS|FIGURE|FIGCAPTION|CENTER|HR|BODY|HTML|FORM|FIELDSET|DETAILS|SUMMARY)$/;
    var BULLET_CHARS = /^[\u00b7\u2022\u25aa\u25cf\u25e6\u2023\u2043\u2219o\u00a7\uf0a7\uf0b7-]$/;

    function styleAttr(el) {
        return el.getAttribute ? (el.getAttribute("style") || "") : "";
    }

    /* font-weight of the element itself → number, or null if not set. */
    function ownWeight(el) {
        var v = el.style && el.style.fontWeight;
        if (!v) return null;
        if (v === "bold" || v === "bolder") return 700;
        if (v === "normal" || v === "lighter") return 400;
        var n = parseInt(v, 10);
        return isFinite(n) ? n : null;
    }

    function decoLine(el) {
        if (!el.style) return "";
        return el.style.textDecorationLine || el.style.textDecoration || "";
    }

    /* Separation a block asks for: 2 = blank line (a paragraph with its
       margin), 1 = next line. */
    function blockGap(el) {
        var tag = el.tagName;
        if (/^H[1-6]$/.test(tag)) return 2;
        if (tag === "P") {
            if (/mso-list\s*:\s*l\d/i.test(styleAttr(el))) return 1;   /* Word list item */
            var mb = el.style && (el.style.marginBottom || "");
            return /^0(\.0+)?([a-z]+)?$/i.test(mb.trim()) ? 1 : 2;
        }
        return 1;
    }

    /* A NoirPad image (rich editor rules): <img data-filename> or an
       /images/<name> URL on this origin. Anything else is dropped. */
    function ownImage(img) {
        var name = img.getAttribute("data-filename") || "";
        var src = img.getAttribute("src") || "";
        if (!name && src) {
            try {
                var u = new URL(src, window.location.href);
                if (u.origin === window.location.origin && u.pathname.indexOf("/images/") === 0) {
                    name = u.pathname.slice(8);
                }
            } catch (e) { /* not a URL */ }
        }
        if (!NP.isImageName(name)) return null;
        var w = parseInt(img.getAttribute("data-w") || "", 10) ||
            (img.style && parseInt(img.style.width, 10)) || 0;
        return NP.editor._makeImage(name, w ? String(w) : null);
    }

    function ownCodeBlock(pre) {
        var raw = pre.getAttribute("data-code");
        if (raw === null) return null;
        try { raw = decodeURIComponent(raw); } catch (e) { return null; }
        return NP.editor._renderCodeBlock(raw, pre.getAttribute("data-lang") || "");
    }

    /* Source DOM (any document) → DocumentFragment of the editor's model.
       keepSpaces: the source is the note itself (white-space: pre-wrap),
       so its spaces and line breaks are content, not HTML source
       formatting: every <br> counts, a <div>/<p> ends a line only when
       something follows it (as in editor.js _htmlToTextWithImages), and
       breaks at the start or end are kept. */
    function clean(root, keepSpaces) {
        var doc = document;
        var out = doc.createDocumentFragment();
        var pending = 0;          /* line breaks owed before the next content */
        var started = false;      /* anything emitted yet */
        var lineStart = true;
        var lastText = null;      /* last emitted text node (for trimming) */
        var lastKey = null;       /* format key of lastText, for merging */
        var marker = null;        /* list prefix owed to the item's first content */

        function trimLastSpace() {
            if (lastText && / $/.test(lastText.data)) {
                lastText.data = lastText.data.replace(/ +$/, "");
            }
        }

        function flush() {
            if (!started && !keepSpaces) { pending = 0; return; }
            if (pending && !keepSpaces) trimLastSpace();
            for (; pending > 0; pending--) {
                out.appendChild(doc.createElement("br"));
                lineStart = true;
                lastKey = null;
            }
        }

        function wantBreak(n) {
            if (started) pending = Math.max(pending, n);
        }

        function wrap(node, st) {
            if (st.bold) { var b = doc.createElement("strong"); b.appendChild(node); node = b; }
            if (st.italic) { var i = doc.createElement("em"); i.appendChild(node); node = i; }
            if (st.underline) { var u = doc.createElement("u"); u.appendChild(node); node = u; }
            if (st.strike) { var s = doc.createElement("s"); s.appendChild(node); node = s; }
            if (st.href) {
                var a = doc.createElement("a");
                a.setAttribute("href", st.href);
                a.appendChild(node);
                node = a;
            }
            return node;
        }

        /* raw: list prefixes, cell separators and <pre> text keep their
           spaces; everything else collapses like HTML does. */
        function emitText(str, st, raw) {
            if (!raw) {
                str = str.replace(/[\t\n\r\f ]+/g, " ");
                if (lineStart) str = str.replace(/^ /, "");
                else if (lastText && / $/.test(lastText.data)) str = str.replace(/^ /, "");
                /* Source formatting between blocks, not content. */
                if (pending && str === " ") return;
            }
            str = str.replace(/\u00a0/g, " ");
            if (!str) return;
            flush();
            if (marker) {
                var m = marker;
                marker = null;
                emitText(m, {}, true);
            }
            var key = [st.bold, st.italic, st.underline, st.strike, st.href].join("|");
            if (lastText && key === lastKey) {
                lastText.data += str;
            } else {
                lastText = doc.createTextNode(str);
                out.appendChild(wrap(lastText, st));
                lastKey = key;
            }
            started = true;
            lineStart = false;
        }

        function emitNode(node) {
            flush();
            if (marker) {
                var m = marker;
                marker = null;
                emitText(m, {}, true);
            }
            out.appendChild(node);
            started = true;
            lineStart = false;
            lastText = null;
            lastKey = null;
        }

        function emitPre(text, st) {
            text.replace(/\r\n?/g, "\n").split("\n").forEach(function (line, i) {
                if (i > 0) {
                    if (started) pending += 1;
                    lineStart = true;
                }
                emitText(line, st, true);
            });
        }

        function walk(node, st, list) {
            if (node.nodeType === 3) {
                emitText(node.data, st, !!keepSpaces);
                return;
            }
            if (node.nodeType !== 1) return;
            var tag = node.tagName.toUpperCase();
            if (SKIP.test(tag)) return;
            if (node.style && node.style.display === "none") return;
            var css = styleAttr(node);

            if (tag === "BR") {
                if (started || keepSpaces) pending += 1;
                lineStart = true;
                return;
            }
            if (tag === "IMG") {
                var img = ownImage(node);
                if (img && st.href) {
                    /* E11: a linked picture keeps its link. */
                    var link = doc.createElement("a");
                    link.setAttribute("href", st.href);
                    link.appendChild(img);
                    img = link;
                }
                if (img) emitNode(img);
                return;
            }
            if (tag === "PRE" && node.classList && node.classList.contains("np-code")) {
                var code = ownCodeBlock(node);
                if (code) emitNode(code);
                return;
            }
            /* Word: the list marker of a list paragraph ("·", "o", "1."). */
            if (/mso-list\s*:\s*ignore/i.test(css)) {
                var sign = (node.textContent || "").replace(/[\s\u00a0]+/g, "");
                emitText(BULLET_CHARS.test(sign) ? "\u2022 " : sign + " ", {}, true);
                return;
            }

            var isBlock = BLOCK.test(tag);
            var s = {
                bold: st.bold, italic: st.italic, underline: st.underline,
                strike: st.strike, href: st.href
            };
            var w = ownWeight(node);
            if (/^H[1-6]$/.test(tag)) s.bold = w === null ? true : w >= 600;
            else if (tag === "B" || tag === "STRONG") s.bold = w === null ? true : w >= 600;
            else if (!isBlock && w !== null) s.bold = w >= 600;

            var fs = node.style && node.style.fontStyle;
            if (tag === "I" || tag === "EM" || tag === "CITE" || tag === "DFN" || tag === "VAR") s.italic = true;
            if (!isBlock && fs) s.italic = fs === "italic" || fs === "oblique";

            if (tag === "A") {
                var href = node.getAttribute("href");
                s.href = NP.linkKind(href) === "external" ? href.trim() : st.href;
            }
            var deco = isBlock ? "" : decoLine(node);
            if (tag === "U" || tag === "INS") s.underline = true;
            else if (deco.indexOf("underline") !== -1) s.underline = true;
            else if (deco === "none") s.underline = false;
            if (tag === "S" || tag === "STRIKE" || tag === "DEL") s.strike = true;
            else if (deco.indexOf("line-through") !== -1) s.strike = true;
            else if (deco === "none") s.strike = false;
            /* A link is underlined on screen anyway. */
            if (s.href) s.underline = false;

            var gap = isBlock && !keepSpaces ? blockGap(node) : 0;
            if (gap) wantBreak(gap);

            if (tag === "UL" || tag === "OL") {
                var start = parseInt(node.getAttribute("start") || "1", 10);
                list = { ordered: tag === "OL", n: isFinite(start) ? start : 1,
                    depth: list ? list.depth + 1 : 0 };
            } else if (tag === "LI") {
                var indent = list ? new Array(list.depth + 1).join("    ") : "";
                var prefix = list && list.ordered ? (list.n++) + ". " : "\u2022 ";
                marker = indent + prefix;
            } else if ((tag === "TD" || tag === "TH") && node.previousElementSibling) {
                pending = 0;
                emitText("\t", {}, true);
            }

            if (tag === "PRE") {
                emitPre(node.textContent || "", s);
            } else if (tag === "HR") {
                emitText("\u2014\u2014\u2014", {}, true);
            } else {
                for (var c = node.firstChild; c; c = c.nextSibling) walk(c, s, list);
            }

            if (tag === "LI") marker = null;   /* an empty item leaves no bullet behind */
            if (gap) wantBreak(gap);
            else if (keepSpaces && (tag === "DIV" || tag === "P") && node.nextSibling) pending += 1;
        }

        walk(root, {}, null);
        if (keepSpaces) flush();
        else trimLastSpace();
        return out;
    }

    function plainFragment(text) {
        var frag = document.createDocumentFragment();
        String(text || "").replace(/\r\n?/g, "\n").split("\n").forEach(function (line, i) {
            if (i > 0) frag.appendChild(document.createElement("br"));
            if (line) frag.appendChild(document.createTextNode(line));
        });
        return frag;
    }

    function fragmentHtml(frag) {
        var box = document.createElement("div");
        box.appendChild(frag);
        return box.innerHTML;
    }

    /* Pasted content may bring a NoirPad image along (another note's). */
    function insertPasted(frag) {
        var hasImage = !!frag.querySelector("img");
        insertFragment(frag);
        if (hasImage && NP.encryption) NP.encryption.noteImageAdded();
    }

    /* Replace the editor selection with *frag*. execCommand keeps the
       browser's undo (Ctrl+Z); jsdom and old engines take the Range path. */
    function insertFragment(frag) {
        var ed = document.getElementById("editor");
        var html = fragmentHtml(frag);
        var done = false;
        try { done = document.execCommand("insertHTML", false, html); } catch (e) { done = false; }
        if (!done) {
            var sel = window.getSelection();
            if (!sel || !sel.rangeCount) return;
            var range = sel.getRangeAt(0);
            range.deleteContents();
            var box = document.createElement("div");
            box.innerHTML = html;
            var last = box.lastChild;
            var tmp = document.createDocumentFragment();
            while (box.firstChild) tmp.appendChild(box.firstChild);
            range.insertNode(tmp);
            if (last) {
                range.setStartAfter(last);
                range.collapse(true);
                sel.removeAllRanges();
                sel.addRange(range);
            }
            if (ed) ed.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    function richEditorActive() {
        var ed = document.getElementById("editor");
        if (!ed || ed.getAttribute("contenteditable") !== "true") return false;
        return !(NP.markdown && NP.markdown.isActive && NP.markdown.isActive());
    }

    /* The editor's selection as a Range, or null when it is elsewhere. */
    function editorRange() {
        var ed = document.getElementById("editor");
        var sel = window.getSelection();
        if (!ed || !sel || !sel.rangeCount) return null;
        var r = sel.getRangeAt(0);
        return ed.contains(r.commonAncestorContainer) ? r : null;
    }

    var plainNext = false;
    var lastRange = null;     /* last non-empty editor selection */

    /* Put a saved selection back (the command bar or a menu took focus). */
    function restoreRange(r) {
        var ed = document.getElementById("editor");
        if (!r || !ed || !ed.contains(r.commonAncestorContainer)) return null;
        ed.focus();
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return sel.getRangeAt(0);
    }

    /* The first (or last) node a range edge touches. */
    function edgeNode(container, offset, atEnd) {
        if (container.nodeType !== 1) return container.parentNode;
        return container.childNodes[atEnd ? offset - 1 : offset] || container;
    }

    function isBr(n) { return !!n && n.nodeType === 1 && n.tagName === "BR"; }

    /* A selection reaching into (or starting / ending right at) a read-only
       code block covers the whole block, so the block is never cut in half
       or duplicated. E7: with the line break next to it — Chrome drops a
       <br> at the edge of an insertHTML, gluing the fence to the text. */
    function wholeCodeBlocks(r) {
        var a = edgeNode(r.startContainer, r.startOffset, false);
        var b = edgeNode(r.endContainer, r.endOffset, true);
        var preA = a && a.closest ? a.closest("pre.np-code") : null;
        var preB = b && b.closest ? b.closest("pre.np-code") : null;
        if (preA) {
            r.setStartBefore(isBr(preA.previousSibling) ? preA.previousSibling : preA);
        }
        if (preB) {
            r.setEndAfter(isBr(preB.nextSibling) ? preB.nextSibling : preB);
        }
    }

    /* Context-menu Paste: the async clipboard API (may be refused). */
    function pasteFromClipboard(plain) {
        var saved = lastRange;
        function fail() {
            if (NP.toast) NP.toast(NP.t("editor.menu.pasteBlocked"), { timeout: 4000 });
        }
        var cb = navigator.clipboard;
        if (!cb || !cb.readText) { fail(); return; }
        var read = (!plain && cb.read) ? cb.read().then(function (items) {
            var html = items.filter(function (it) { return it.types.indexOf("text/html") !== -1; })[0];
            if (!html) return cb.readText().then(function (t) { return { text: t }; });
            return html.getType("text/html").then(function (blob) { return blob.text(); })
                .then(function (h) { return { html: h }; });
        }) : cb.readText().then(function (t) { return { text: t }; });
        read.then(function (data) {
            var frag = data.html ? NP.paste.cleanHtml(data.html) : null;
            if (!frag || !frag.childNodes.length) {
                if (!data.text) return;
                frag = plainFragment(data.text);
            }
            if (!editorRange()) restoreRange(saved);
            insertPasted(frag);
        }).catch(fail);
    }

    NP.paste = {
        /* HTML string → model fragment (exported for tests). */
        cleanHtml: function (html) {
            var src = new DOMParser().parseFromString(String(html || ""), "text/html");
            return clean(src.body || src.documentElement);
        },

        cleanNode: clean,
        plainFragment: plainFragment,

        init: function () {
            var ed = document.getElementById("editor");
            if (!ed) return;
            ed.addEventListener("keydown", function (e) {
                /* Ctrl+Shift+V: the browser fires a normal paste event,
                   this only marks it as "plain text". */
                plainNext = !!((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey &&
                    (e.key === "V" || e.key === "v"));
            }, true);
            ed.addEventListener("keyup", function () { plainNext = false; }, true);
            ed.addEventListener("paste", NP.paste._onPaste);
            document.addEventListener("selectionchange", function () {
                var r = editorRange();
                if (r && !r.collapsed) lastRange = r.cloneRange();
                else if (r) lastRange = null;
            });
            ed.addEventListener("contextmenu", NP.paste._onContextMenu);
        },

        _onPaste: function (e) {
            var plain = plainNext;
            plainNext = false;
            if (e.defaultPrevented || !richEditorActive()) return;   /* image paste: images.js */
            var cd = e.clipboardData;
            if (!cd) return;
            var html = plain ? "" : cd.getData("text/html");
            var text = cd.getData("text/plain");
            var frag = html ? NP.paste.cleanHtml(html) : null;
            /* E13: whatever comes, the browser never inserts it itself —
               HTML that cleans down to nothing would come in uncleaned. */
            e.preventDefault();
            if (!frag || !frag.childNodes.length) {
                if (!text) return;
                frag = plainFragment(text);
            }
            insertPasted(frag);
        },

        /* Colours, background, font and size off the selection; bold,
           italic, underline, strike and links stay. */
        clearFormatting: function () {
            if (!richEditorActive()) return false;
            var r = editorRange();
            if (!r || r.collapsed) r = restoreRange(lastRange);
            if (!r || r.collapsed) {
                if (NP.toast) NP.toast(NP.t("editor.clearFormatting.noSelection"), { timeout: 3000 });
                return true;
            }
            wholeCodeBlocks(r);
            var sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
            var box = document.createElement("div");
            box.appendChild(r.cloneContents());
            insertFragment(clean(box, true));
            return true;
        },

        _onContextMenu: function (e) {
            var r = editorRange();
            /* No selection, or Shift+right-click: the system menu (spelling
               suggestions, Select all). */
            if (!r || r.collapsed || e.shiftKey || !richEditorActive() || !NP.menu) return;
            e.preventDefault();
            NP.menu.open({ x: e.clientX, y: e.clientY }, [
                { id: "cut", label: NP.t("editor.menu.cut"), keys: "Ctrl+X",
                    run: function () { document.execCommand("cut"); } },
                { id: "copy", label: NP.t("editor.menu.copy"), keys: "Ctrl+C",
                    run: function () { document.execCommand("copy"); } },
                { id: "paste", label: NP.t("editor.menu.paste"), keys: "Ctrl+V",
                    run: function () { pasteFromClipboard(false); } },
                { id: "paste-plain", label: NP.t("editor.menu.pastePlain"), keys: "Ctrl+Shift+V",
                    run: function () { pasteFromClipboard(true); } },
                "-",
                { id: "clear", label: NP.t("editor.clearFormatting.label"),
                    keys: (NP.shortcuts && NP.shortcuts.getCurrent("clear-formatting")) || "",
                    run: NP.paste.clearFormatting }
            ], { keepFocus: true, footer: NP.t("editor.menu.systemHint") });
        }
    };

})(window.NP);
