/* markdown.js — Phase 4b: split-pane preview

   In MD mode the editor area splits into two panes:
     #md-source   — textarea, plain markdown source (no rendering)
     #md-preview  — rendered HTML with real block-level styling
                    (big H1 32px, blockquote bars, code blocks, etc.)

   No DOM is mutated inside contentEditable. No alignment constraint
   between source and preview, so the preview can use arbitrary
   font-sizes / line-heights — classic markdown render. The textarea
   is the source of truth; the preview is read-only output rebuilt
   on input (debounced). */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var renderTimer = null;
    var lastRendered = null;

    /* Markdown → HTML via the vendored markdown-it (raw HTML disabled),
       then DOMPurify (NP.sanitizeHtml). Tokens get the md-* classes the
       preview CSS styles; fenced code keeps the .md-codeblock[data-lang]
       contract syntax-highlight.js relies on. */
    var md = null;

    var BLOCK_CLASSES = {
        h1: "md-h1", h2: "md-h2", h3: "md-h3", h4: "md-h3", h5: "md-h3", h6: "md-h3",
        blockquote_open: "md-quote",
        paragraph_open: "md-line",
        bullet_list_open: "md-list",
        ordered_list_open: "md-list"
    };
    var INLINE_CLASSES = {
        strong_open: "md-bold",
        em_open: "md-italic",
        s_open: "md-strike"
    };

    /* Disallowed links lose their <a> (the text stays); disallowed
       images are shown as their markdown source. */
    function fixInline(children) {
        var out = [];
        var dropped = [];
        for (var i = 0; i < children.length; i++) {
            var t = children[i];
            if (t.type === "link_open") {
                var ok = !!NP.linkKind(t.attrGet("href"));
                dropped.push(!ok);
                if (!ok) continue;
                t.attrJoin("class", "md-link");
            } else if (t.type === "link_close") {
                if (dropped.pop()) continue;
            } else if (t.type === "image") {
                var src = t.attrGet("src");
                if (!NP.isImageSrc(src)) {
                    t.type = "text";
                    t.tag = "";
                    t.content = "![" + t.content + "](" + src + ")";
                    t.children = null;
                } else {
                    t.attrJoin("class", "md-image");
                }
            } else if (INLINE_CLASSES[t.type]) {
                t.attrJoin("class", INLINE_CLASSES[t.type]);
            }
            out.push(t);
        }
        children.length = 0;
        /* R4: no push.apply — a paragraph of ~80 000 lines would exceed
           the call stack ("Maximum call stack size exceeded"). */
        for (var o = 0; o < out.length; o++) children.push(out[o]);
    }

    function getMd() {
        if (md || !window.markdownit) return md;
        md = window.markdownit({ html: false, linkify: true, breaks: true });
        /* Let every URL through the parser; fixInline + DOMPurify decide. */
        md.validateLink = function () { return true; };
        /* - [ ] / - [x] → checkboxes. Display only: disabled, and the
           sanitizer forces that on every <input> anyway. */
        if (window.markdownitTaskLists) {
            md.use(window.markdownitTaskLists, { enabled: false, label: false });
        }

        md.core.ruler.push("noirpad_classes", function (state) {
            state.tokens.forEach(function (tok) {
                var cls = BLOCK_CLASSES[tok.type === "heading_open" ? tok.tag : tok.type];
                if (cls) tok.attrJoin("class", cls);
                if (tok.type === "inline" && tok.children) fixInline(tok.children);
            });
        });

        md.renderer.rules.code_inline = function (tokens, idx) {
            return '<code class="md-inline-code">' + NP.escapeHtml(tokens[idx].content) + "</code>";
        };
        function codeBlock(tokens, idx) {
            var tok = tokens[idx];
            var lang = (tok.info || "").trim().split(/\s+/)[0]
                .replace(/[^A-Za-z0-9+\-#]/g, "").slice(0, 32);
            return '<div class="md-codeblock"' +
                (lang ? ' data-lang="' + NP.escapeHtml(lang) + '"' : "") + ">" +
                NP.escapeHtml(tok.content.replace(/\n$/, "")) + "</div>";
        }
        md.renderer.rules.fence = codeBlock;
        md.renderer.rules.code_block = codeBlock;
        return md;
    }

    function renderPreview(rawText) {
        var parser = getMd();
        if (!parser) return NP.escapeHtml(rawText);  // vendor script failed to load
        return NP.sanitizeHtml(parser.render(rawText || ""));
    }

    /* ---- DOM helpers ---- */

    function getEls() {
        return {
            editor: document.getElementById("editor"),
            ta: document.getElementById("editor-md"),
            preview: document.getElementById("md-preview"),
            stack: document.getElementById("md-stack"),
            btn: document.getElementById("btn-md-toggle")
        };
    }

    function isMdMode() {
        return document.body.classList.contains("editor-md-active");
    }

    /* Switch animation (button / Ctrl+M only, never when a note loads).
       The switch is already done when it starts: the source shows at once,
       the preview slides in from the right, back to rich text the editor
       fades in, and the Markdown icon lights up. Only opacity and transform
       move (noirpad.css); the source and its caret never do. Nothing with
       prefers-reduced-motion or forced colours. */
    var ANIM_FALLBACK_MS = 400;

    function mediaOn(q) {
        return !!(window.matchMedia && window.matchMedia(q).matches);
    }

    function play(el, cls) {
        if (!el) return;
        clearTimeout(el._npAnimTimer);
        ["np-md-anim-slide", "np-md-anim-fade", "np-md-flash"].forEach(function (c) {
            if (c !== cls) el.classList.remove(c);
        });
        if (el.classList.contains(cls)) {
            /* Quick second switch: start over. */
            el.classList.remove(cls);
            void el.offsetWidth;
        }
        el.classList.add(cls);
        function done() {
            clearTimeout(el._npAnimTimer);
            el.classList.remove(cls);
            el.removeEventListener("animationend", done);
        }
        el.addEventListener("animationend", done);
        el._npAnimTimer = setTimeout(done, ANIM_FALLBACK_MS);
    }

    function stop(el) {
        if (!el) return;
        clearTimeout(el._npAnimTimer);
        el.classList.remove("np-md-anim-slide", "np-md-anim-fade");
    }

    function animateSwitch(toMd) {
        if (mediaOn("(prefers-reduced-motion: reduce)") || mediaOn("(forced-colors: active)")) return;
        var els = getEls();
        if (toMd) {
            stop(els.editor);
            var preview = !document.body.classList.contains("md-no-preview");
            if (preview) play(els.preview, "np-md-anim-slide");
            else play(els.stack, "np-md-anim-fade");
        } else {
            stop(els.preview);
            stop(els.stack);
            play(els.editor, "np-md-anim-fade");
        }
        play(els.btn, "np-md-flash");
    }

    function scheduleRender() {
        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(function () {
            renderTimer = null;
            var els = getEls();
            if (!els.ta || !els.preview) return;
            var src = els.ta.value;
            if (src === lastRendered) return;
            NP.markdown.renderInto(els.preview, src);
            lastRendered = src;
            /* Decoupled hook for syntax-highlight.js (and any other
               post-render consumer). Pure visual: the textarea is
               unaffected, so the save path never sees whatever the
               listener does to the preview DOM. */
            els.preview.dispatchEvent(new CustomEvent(
                "np-md-rendered", { bubbles: true }
            ));
        }, 60);
    }

    function updateMdButtonState() {
        var els = getEls();
        if (!els.btn) return;
        els.btn.classList.toggle("active", isMdMode());
        if (NP.topbar && NP.topbar.refresh) NP.topbar.refresh();
    }

    /* ---- Public API ---- */

    NP.markdown = {
        _insertCodeBlock: function (ta) { insertCodeBlock(ta); },   /* tests */


        /* Render markdown source *src* as the preview inside *el*. */
        renderInto: function (el, src) {
            el.innerHTML = renderPreview(src);
        },

        /* Switch to MD mode for the currently open note. Copies the
           editor's plain text into the textarea, renders the preview,
           reveals the split-pane stack.

           srcOverride: when provided, use this string as the textarea
           source instead of reading editor.innerText. The load path
           must pass the freshly fetched note content here — reading
           editor.innerText after the editor has been hidden
           (display:none in MD mode) returns "" and wipes the note. */
        enableForEditor: function (srcOverride) {
            var els = getEls();
            if (!els.ta || !els.preview) return;
            var src;
            if (typeof srcOverride === "string") {
                src = srcOverride;
            } else {
                /* Toggle path: editor is currently visible (rich-text
                   mode). innerText preserves <br>s as \n. */
                src = els.editor ? (els.editor.innerText || "") : "";
            }
            els.ta.value = src;
            lastRendered = null;
            document.body.classList.add("editor-md-active");
            updateMdButtonState();
            NP.markdown.renderInto(els.preview, src);
            lastRendered = src;
            els.preview.dispatchEvent(new CustomEvent(
                "np-md-rendered", { bubbles: true }
            ));
        },

        /* Leave MD mode — write the textarea back into the editor
           with <br>s for line breaks, hide the stack. Used by the
           USER-INITIATED toggle (Ctrl+M / MD button). NOT used by
           the load path — see leaveForLoad. */
        disableForEditor: function () {
            var els = getEls();
            if (!els.editor) return;
            var src = els.ta ? (els.ta.value || "") : "";
            document.body.classList.remove("editor-md-active");
            updateMdButtonState();
            els.editor.innerHTML = "";
            var lines = src.split("\n");
            for (var i = 0; i < lines.length; i++) {
                if (i > 0) els.editor.appendChild(document.createElement("br"));
                els.editor.appendChild(document.createTextNode(lines[i]));
            }
        },

        /* Leave MD mode when LOADING a different (rich-text) note.
           Just drops the md class — must NOT copy the textarea back
           into the editor (textarea still has the PREVIOUS note's
           markdown; the editor already holds the new note's HTML). */
        leaveForLoad: function () {
            document.body.classList.remove("editor-md-active");
            var ta = document.getElementById("editor-md");
            if (ta) ta.value = "";
            var pv = document.getElementById("md-preview");
            if (pv) pv.innerHTML = "";
            /* E6: the coloured copy of the source too (K3: a locked note's
               text never stays in the page). */
            if (NP.mdSource && NP.mdSource.clear) NP.mdSource.clear();
            lastRendered = null;
            updateMdButtonState();
        },

        /* MD button click + Ctrl+M shortcut. */
        toggleForCurrentNote: function () {
            var id = NP.state && NP.state.currentNoteId;
            if (!id) return;
            var data = NP.state.data;
            if (!data) return;
            var ed = NP.editor;
            /* Until this note's content is in the editor, the editor and the
               textarea still hold the previous note: switching now would
               save that text under this id (E4, the K1 rule). */
            if (!ed || ed._currentNoteId !== id || ed._loadedNoteId !== id) return;
            var locked = !!(ed && ed._currentNoteEncrypted);
            /* A locked note that is not unlocked has nothing to switch. */
            if (locked && !ed._unlockToken) return;
            var modes = data.note_modes = data.note_modes || {};
            var nextMode = modes[id] === "markdown" ? "rich-text" : "markdown";

            if (nextMode === "markdown") {
                modes[id] = "markdown";
                NP.markdown.enableForEditor();
            } else {
                delete modes[id];
                NP.markdown.disableForEditor();
            }
            animateSwitch(nextMode === "markdown");

            var content;
            if (nextMode === "markdown") {
                var ta = document.getElementById("editor-md");
                content = ta ? ta.value : "";
            } else if (NP.editor && NP.editor._htmlToTextWithImages) {
                content = NP.editor._htmlToTextWithImages().text;
            } else {
                content = "";
            }
            var formats = (nextMode !== "markdown" &&
                NP.editor && NP.editor._extractFormats)
                ? NP.editor._extractFormats() : [];
            if (NP.editor && NP.editor.updateCharCount) NP.editor.updateCharCount();
            /* A locked note stays encrypted on disk: re-encrypt with its
               unlock token, never a plain save (K2). */
            if (locked) {
                NP.api.saveEncrypted(id, ed._unlockToken, content, formats, { mode: nextMode })
                    .catch(NP.dialog.failed);
            } else if (NP.api && NP.api.saveNote) {
                Promise.resolve(NP.api.saveNote(id, content, formats, { mode: nextMode })).then(function (res) {
                    /* R6: this is the note's stored version now. */
                    if (res && res.rev && ed._currentNoteId === id) ed._rev = res.rev;
                }).catch(function (err) {
                    if (NP.dialog && NP.dialog.failed) NP.dialog.failed(err);
                });
            }
        },

        /* Called from editor.loadNote once content is in #editor.
           Flips to MD if the loaded note's mode is markdown.

           rawContent: the fresh server content as a plain string.
           REQUIRED for MD-mode loads — without it we'd fall back to
           reading editor.innerText, which returns "" when the editor
           is already hidden by the body.editor-md-active class. */
        applyForLoadedNote: function (noteId, rawContent) {
            var modes = NP.state && NP.state.data && NP.state.data.note_modes;
            var wantMd = noteId && modes && modes[noteId] === "markdown";
            if (wantMd) {
                /* If rawContent isn't provided (legacy callers), fall
                   back to the editor read so the toggle path still
                   works. The load path in editor.js always passes it. */
                if (typeof rawContent === "string") {
                    NP.markdown.enableForEditor(rawContent);
                } else {
                    NP.markdown.enableForEditor();
                }
            } else if (isMdMode()) {
                /* Loading a non-MD note while body still has the MD
                   class — drop the class but DO NOT call
                   disableForEditor: its textarea→editor copy would
                   overwrite the freshly loaded content with the
                   previous note's markdown. */
                NP.markdown.leaveForLoad();
            }
            updateMdButtonState();
        },

        /* Plain-text getter for the save path. */
        getRawText: function () {
            var ta = document.getElementById("editor-md");
            return ta ? ta.value : "";
        },

        isActive: isMdMode
    };

    /* ---- Shortcut handlers (textarea-based) ----

       All MD shortcut handlers return `false` when the textarea isn't
       focused / MD mode isn't active. The shortcuts dispatcher treats
       that as passthrough and tries the next matching binding.

       Edits go through setRangeText so the textarea's native undo stack
       is preserved, then dispatch an `input` event so the preview pane
       re-renders. */

    function activeTa() {
        if (!isMdMode()) return null;
        var ta = document.getElementById("editor-md");
        if (!ta || document.activeElement !== ta) return null;
        return ta;
    }

    function fireInput(ta) {
        ta.dispatchEvent(new Event("input", { bubbles: true }));
    }

    /* Surround the current selection with `before`/`after`. Empty
       selection places the caret between them; non-empty selection
       leaves the caret at the end of the inserted run. */
    function wrapSel(ta, before, after) {
        var s = ta.selectionStart;
        var e = ta.selectionEnd;
        var sel = ta.value.substring(s, e);
        var ins = before + sel + after;
        ta.setRangeText(ins, s, e, "end");
        if (sel.length === 0) {
            var caret = s + before.length;
            ta.setSelectionRange(caret, caret);
        }
        fireInput(ta);
    }

    /* Prepend `prefix` to the start of the line containing the caret,
       keeping the caret's relative position within the line. */
    function insertLinePrefix(ta, prefix) {
        var s = ta.selectionStart;
        var lineStart = ta.value.lastIndexOf("\n", s - 1) + 1;
        ta.setRangeText(prefix, lineStart, lineStart, "end");
        var newPos = s + prefix.length;
        ta.setSelectionRange(newPos, newPos);
        fireInput(ta);
    }

    /* Insert `text` at the caret. When `newlineBefore` is true and the
       caret isn't already at the start of a line, a leading \n is added
       so the new content starts on its own line. */
    function insertAtCaret(ta, text, newlineBefore) {
        var s = ta.selectionStart;
        var lead = "";
        if (newlineBefore && s > 0 && ta.value.charAt(s - 1) !== "\n") {
            lead = "\n";
        }
        ta.setRangeText(lead + text, s, s, "end");
        fireInput(ta);
    }

    /* Wrap selection in [label](url) and select the "url" placeholder
       so the user can immediately type the destination. */
    function insertLink(ta) {
        var s = ta.selectionStart;
        var e = ta.selectionEnd;
        var sel = ta.value.substring(s, e);
        var label = sel || NP.t("markdown.linkTextPlaceholder");
        var ins = "[" + label + "](url)";
        ta.setRangeText(ins, s, e, "end");
        var urlStart = s + 1 + label.length + 2;  /* "[" + label + "](" */
        ta.setSelectionRange(urlStart, urlStart + 3);  /* select "url" */
        fireInput(ta);
    }

    function insertImage(ta) {
        var s = ta.selectionStart;
        var alt = NP.t("markdown.imageAltPlaceholder");
        var ins = "![" + alt + "](url)";
        ta.setRangeText(ins, s, s, "end");
        var urlStart = s + 2 + alt.length + 2;  /* "![" + alt + "](" */
        ta.setSelectionRange(urlStart, urlStart + 3);
        fireInput(ta);
    }

    function insertCodeBlock(ta) {
        var s = ta.selectionStart;
        var e = ta.selectionEnd;
        var lead = (s > 0 && ta.value.charAt(s - 1) !== "\n") ? "\n" : "";
        var sel = ta.value.substring(s, e);
        if (sel) {
            /* Wrap the selection, keep it selected inside the fences (C13). */
            var body = sel.replace(/\n$/, "");
            ta.setRangeText(lead + "```\n" + body + "\n```\n", s, e, "end");
            var from = s + lead.length + 4;
            ta.setSelectionRange(from, from + body.length);
        } else {
            ta.setRangeText(lead + "```\n\n```\n", s, s, "end");
            /* Caret on the empty line between the fences. */
            var caret = s + lead.length + 4;  /* lead + "```\n" */
            ta.setSelectionRange(caret, caret);
        }
        fireInput(ta);
    }

    /* What each Markdown action writes into the source, by shortcut id.
       The keys of the Markdown-only actions are registered here; bold,
       italic, strikethrough and link are shared with rich-text notes and
       registered by format.js, which also uses this table for the Format
       menu and the context menu. */
    var EDITS = {
        "md-h1": function (ta) { insertLinePrefix(ta, "# "); },
        "md-h2": function (ta) { insertLinePrefix(ta, "## "); },
        "md-h3": function (ta) { insertLinePrefix(ta, "### "); },
        "md-bold": function (ta) { wrapSel(ta, "**", "**"); },
        "md-italic": function (ta) { wrapSel(ta, "*", "*"); },
        "md-strikethrough": function (ta) { wrapSel(ta, "~~", "~~"); },
        "md-code-inline": function (ta) { wrapSel(ta, "`", "`"); },
        "md-code-block": insertCodeBlock,
        "md-quote": function (ta) { insertLinePrefix(ta, "> "); },
        "md-list-bullet": function (ta) { insertLinePrefix(ta, "- "); },
        "md-list-numbered": function (ta) { insertLinePrefix(ta, "1. "); },
        "md-task": function (ta) { insertLinePrefix(ta, "- [ ] "); },
        "md-horizontal-rule": function (ta) { insertAtCaret(ta, "---\n", true); },
        "md-link": insertLink,
        "md-image": insertImage
    };
    var SHARED = ["md-bold", "md-italic", "md-strikethrough", "md-link"];

    NP.markdown.edit = EDITS;
    /* The source textarea while a Markdown note is open (focused or not). */
    NP.markdown.textarea = function () {
        if (!isMdMode()) return null;
        var ta = document.getElementById("editor-md");
        return ta && !ta.readOnly && !ta.disabled ? ta : null;
    };

    function registerMarkdownShortcuts() {
        if (!NP.shortcuts || !NP.shortcuts.register) return;
        Object.keys(EDITS).forEach(function (id) {
            if (SHARED.indexOf(id) !== -1) return;
            NP.shortcuts.register(id, function () {
                var ta = activeTa();
                if (!ta) return false;  /* passthrough — try next binding */
                EDITS[id](ta);
            });
        });
    }

    NP.markdown.registerShortcuts = registerMarkdownShortcuts;

    /* ---- Wiring ---- */

    document.addEventListener("DOMContentLoaded", function () {
        var els = getEls();
        if (els.btn) {
            els.btn.addEventListener("click", NP.markdown.toggleForCurrentNote);
        }
        if (els.ta) {
            els.ta.addEventListener("input", scheduleRender);
        }
        registerMarkdownShortcuts();
    });

})(window.NP);
