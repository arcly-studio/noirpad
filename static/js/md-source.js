/* md-source.js - colours for the Markdown source (#editor-md).

   A <textarea> can only have one text colour, so the coloured copy lives in
   #md-highlight right under it: same box, same font and wrapping, scrolled
   along with the textarea. The textarea itself keeps the real text (caret,
   selection, undo, spellcheck) but draws it transparent while the copy is
   in sync (#md-source.md-hl-on); without JS, or for a huge note, the plain
   textarea text shows as before.

   Colours: ordinary text = --md-src-text (one step calmer than the accent
   in the neon themes), headings, markup and code = --accent (themes.css). */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var MAX_CHARS = 60000;       /* above this: no colours, plain textarea */
    var MAX_LINE = 2000;         /* longer lines (minified code, logs): no inline marks */
    var COPY = ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
                "wordSpacing", "tabSize"];

    var FENCE = /^ {0,3}(`{3,}|~{3,})/;
    var HEADING = /^ {0,3}#{1,6}(?=\s|$)/;
    var RULE = /^ {0,3}(?:(?:[-*_] *){3,}|=+ *)$/;
    var QUOTE = /^( {0,3}> ?)+/;
    var LIST = /^\s*(?:[-*+]|\d{1,9}[.)])(?=\s)(?:\s+\[[ xX]\](?=\s|$))?/;
    var TABLE_ROW = /^\s*\|/;
    /* 1 escape | 2,3 code span | 4-8 link / image | 9 ** __ ~~ | 10 *x* _x_ */
    var INLINE = new RegExp(
        "(\\\\[\\\\`*_{}\\[\\]()#+\\-.!~|>])" +
        "|(`+)([^`\\n]|[^`\\n][^\\n]*?[^`\\n])\\2(?!`)" +
        "|(!?\\[)([^\\]\\n]*)(\\]\\()([^)\\s]*(?:\\s+\"[^\"\\n]*\")?)(\\))" +
        "|(\\*\\*|__|~~)" +
        "|(\\*(?=\\S)[^*\\n]*?\\S\\*|(?<!\\w)_(?=\\S)[^_\\n]*?\\S_(?!\\w))",
        "g");

    /* One source line → [[class|null, text], ...] (class: mark, code, head). */
    function inline(text, out) {
        var last = 0;
        var m;
        INLINE.lastIndex = 0;
        while ((m = INLINE.exec(text))) {
            if (m.index > last) out.push([null, text.slice(last, m.index)]);
            if (m[1]) {
                out.push([null, m[1]]);
            } else if (m[2]) {
                out.push(["code", m[0]]);
            } else if (m[4]) {
                out.push(["mark", m[4]]);
                out.push([null, m[5]]);
                out.push(["mark", m[6] + m[7] + m[8]]);
            } else if (m[9]) {
                out.push(["mark", m[9]]);
            } else {
                out.push(["mark", m[10].charAt(0)]);
                out.push([null, m[10].slice(1, -1)]);
                out.push(["mark", m[10].charAt(m[10].length - 1)]);
            }
            last = INLINE.lastIndex;
        }
        if (last < text.length) out.push([null, text.slice(last)]);
        return out;
    }

    function tableLine(text, out) {
        text.split(/(\|)/).forEach(function (part) {
            if (part === "|") out.push(["mark", part]);
            else if (part) inline(part, out);
        });
        return out;
    }

    /* The whole source → segments; "\n" between lines stays uncoloured. */
    function tokenize(src) {
        var out = [];
        var fence = null;               /* the open fence's marker, e.g. "```" */
        var lines = src.split("\n");
        for (var i = 0; i < lines.length; i++) {
            if (i > 0) out.push([null, "\n"]);
            var line = lines[i];
            if (!line) continue;
            var f = FENCE.exec(line);
            if (fence) {
                out.push(["code", line]);
                if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length &&
                    !line.slice(f[0].length).trim()) fence = null;
                continue;
            }
            if (f) {
                fence = f[1];
                out.push(["code", line]);
                continue;
            }
            if (HEADING.test(line)) { out.push(["head", line]); continue; }
            if (RULE.test(line)) { out.push(["mark", line]); continue; }
            var rest = line;
            var q = QUOTE.exec(rest);
            if (q) { out.push(["mark", q[0]]); rest = rest.slice(q[0].length); }
            var l = LIST.exec(rest);
            if (l) { out.push(["mark", l[0]]); rest = rest.slice(l[0].length); }
            /* The inline regex backtracks to the end of the line for every
               unclosed ` * _ [ — keep that bounded. */
            if (rest.length > MAX_LINE) out.push([null, rest]);
            else if (TABLE_ROW.test(rest)) tableLine(rest, out);
            else inline(rest, out);
        }
        return out;
    }

    function els() {
        return {
            box: document.getElementById("md-source"),
            ta: document.getElementById("editor-md"),
            hl: document.getElementById("md-highlight")
        };
    }

    /* Same box as the textarea's text area (without its scrollbar). */
    function sync() {
        var e = els();
        if (!e.ta || !e.hl) return;
        var s = e.hl.style;
        s.top = e.ta.offsetTop + "px";
        s.left = e.ta.offsetLeft + "px";
        /* Fractional width (flex pane): a rounded one could wrap a line
           differently. The rect contains the page's zoom (desktop Ctrl+=),
           a style width does not. Minus the textarea's scrollbar, if any. */
        var scrollbar = e.ta.offsetWidth - e.ta.clientWidth;
        var zoom = e.ta.currentCSSZoom || 1;
        s.width = (e.ta.getBoundingClientRect().width / zoom - scrollbar) + "px";
        s.height = e.ta.clientHeight + "px";
        var cs = getComputedStyle(e.ta);
        COPY.forEach(function (p) { s[p] = cs[p]; });
        e.hl.scrollTop = e.ta.scrollTop;
        e.hl.scrollLeft = e.ta.scrollLeft;
    }

    var pending = 0;
    var lastSrc = null;

    function render() {
        pending = 0;
        var e = els();
        if (!e.box || !e.ta || !e.hl) return;
        var src = e.ta.value;
        var on = src.length <= MAX_CHARS;
        e.box.classList.toggle("md-hl-on", on);
        if (!on) {
            e.hl.replaceChildren();
            lastSrc = null;
            return;
        }
        if (src !== lastSrc) {
            var frag = document.createDocumentFragment();
            /* R5: uncoloured runs (and the "\n" between lines) as one text
               node — the DOM nodes, not the tokenizer, were the cost. */
            var plain = "";
            tokenize(src).forEach(function (seg) {
                if (!seg[0]) {
                    plain += seg[1];
                    return;
                }
                if (plain) {
                    frag.appendChild(document.createTextNode(plain));
                    plain = "";
                }
                var span = document.createElement("span");
                span.className = "mds-" + seg[0];
                span.textContent = seg[1];
                frag.appendChild(span);
            });
            if (plain) frag.appendChild(document.createTextNode(plain));
            /* A trailing newline is an empty last line in the textarea but
               nothing in a div: keep the heights (and the scroll range) equal. */
            if (src.charAt(src.length - 1) === "\n") frag.appendChild(document.createTextNode("\u200b"));
            e.hl.replaceChildren(frag);
            lastSrc = src;
        }
        sync();
    }

    /* R5: a long source is recoloured once typing pauses; meanwhile the
       textarea shows its own (plain) text, so nothing stale is on screen. */
    var BIG = 20000;
    var BIG_DELAY = 250;
    var bigTimer = 0;

    function schedule() {
        var e = els();
        if (e.ta && e.box && e.ta.value.length > BIG) {
            if (pending) {
                if (window.cancelAnimationFrame) window.cancelAnimationFrame(pending);
                pending = 0;
            }
            e.box.classList.remove("md-hl-on");
            clearTimeout(bigTimer);
            bigTimer = setTimeout(render, BIG_DELAY);
            return;
        }
        if (pending) return;
        pending = window.requestAnimationFrame ? window.requestAnimationFrame(render)
                                               : setTimeout(render, 16);
    }

    /* The note leaves the editor (another note, the lock screen): its text
       must not stay in the hidden underlay either (E6). */
    function clear() {
        clearTimeout(bigTimer);
        if (pending) {
            if (window.cancelAnimationFrame) window.cancelAnimationFrame(pending);
            clearTimeout(pending);
            pending = 0;
        }
        var e = els();
        if (e.hl) e.hl.replaceChildren();
        lastSrc = null;
    }

    NP.mdSource = {
        _tokenize: tokenize,          /* tests */
        refresh: render,
        schedule: schedule,
        clear: clear
    };

    document.addEventListener("DOMContentLoaded", function () {
        var e = els();
        if (!e.ta || !e.hl) return;
        e.ta.addEventListener("input", schedule);
        e.ta.addEventListener("scroll", function () {
            e.hl.scrollTop = e.ta.scrollTop;
            e.hl.scrollLeft = e.ta.scrollLeft;
        });
        /* A note opened in Markdown mode: markdown.js renders the preview
           and fires this after setting the textarea's value. */
        document.addEventListener("np-md-rendered", schedule);
        if (window.ResizeObserver) new ResizeObserver(sync).observe(e.ta);
        window.addEventListener("resize", sync);
        /* The mono web font may arrive after the first sync: new metrics. */
        if (document.fonts && document.fonts.addEventListener) {
            document.fonts.addEventListener("loadingdone", sync);
            if (document.fonts.ready) document.fonts.ready.then(sync);
        }
        render();
    });

})(window.NP);
