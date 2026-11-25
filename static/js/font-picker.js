/* font-picker.js - Font selection dialog */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Curated, categorized list. We intentionally show ALL of these
       regardless of whether they're installed — the browser falls back
       per the category's generic family, which is fine (most are stock
       Windows fonts; Inter/Outfit/Space Grotesk/Orbitron/Unbounded are
       loaded via Google Fonts in index.html). */
    var FONT_CATEGORIES = [
        { labelKey: "fontPicker.categories.monospace", fallback: "monospace", fonts: [
            "Cascadia Code", "JetBrains Mono", "Consolas", "Courier New",   // i18n-ignore
            "Fira Code", "Source Code Pro", "Lucida Console"   // i18n-ignore
        ] },
        { labelKey: "fontPicker.categories.sansSerif", fallback: "sans-serif", fonts: [
            "Arial", "Calibri", "Helvetica", "Segoe UI", "Tahoma",   // i18n-ignore
            "Trebuchet MS", "Verdana", "Inter", "Outfit", "Space Grotesk"   // i18n-ignore
        ] },
        { labelKey: "fontPicker.categories.serif", fallback: "serif", fonts: [
            "Times New Roman", "Georgia", "Cambria", "Garamond",   // i18n-ignore
            "Palatino", "Book Antiqua"   // i18n-ignore
        ] },
        { labelKey: "fontPicker.categories.display", fallback: "sans-serif", fonts: [
            "Comic Sans MS", "Impact", "Orbitron", "Unbounded"   // i18n-ignore
        ] }
    ];

    /* font name -> generic fallback, used for preview AND when applying. */
    var FONT_FALLBACK = {};
    (function () {
        for (var c = 0; c < FONT_CATEGORIES.length; c++) {
            var cat = FONT_CATEGORIES[c];
            for (var i = 0; i < cat.fonts.length; i++) {
                FONT_FALLBACK[cat.fonts[i]] = cat.fallback;
            }
        }
    })();

    function fallbackFor(name) {
        return FONT_FALLBACK[name] || "monospace";
    }

    var MIN_SIZE = 6;
    var MAX_SIZE = 72;
    var overlayEl = null;
    /* Robust selection handling: clicking the toolbar "Font" button moves
       focus off the contenteditable, so reading the LIVE selection at
       open-time is unreliable (it may be collapsed/lost). Instead we
       CONTINUOUSLY track the editor's last non-collapsed selection
       (selectionchange) and snapshot that when the picker opens. */
    var lastEditorRange = null;   /* last real editor text selection */
    var savedRange = null;        /* snapshot used by the Apply button */

    function trackEditorSelection() {
        if (overlayEl) return;    /* don't track while the modal is open */
        var editor = document.getElementById("editor");
        if (!editor) return;
        var sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        var range = sel.getRangeAt(0);
        if (range.collapsed) return;
        if (!editor.contains(range.commonAncestorContainer)) return;
        lastEditorRange = range.cloneRange();
    }

    /* Bound once — selectionchange fires on every selection change; the
       handler is just a few cheap early-returns. */
    document.addEventListener("selectionchange", trackEditorSelection);

    /* Called when the picker opens: snapshot the last TRACKED editor
       selection (not the live one, which is now the focused Font button). */
    function saveEditorSelection() {
        savedRange = (lastEditorRange && !lastEditorRange.collapsed)
            ? lastEditorRange.cloneRange()
            : null;
    }

    /* Wrap the saved selection in a <span> carrying font-family + size.
       _extractFormats() (editor.js) picks the span up as a
       {font,size,start,end} range, so it persists in the note and is
       re-emitted by NP.editor.renderContent() on reload — full round-trip. */
    function applyFontToSelection(fontFamily, sizePx) {
        var editor = document.getElementById("editor");
        if (!editor || !savedRange || savedRange.collapsed) return false;
        if (!editor.contains(savedRange.commonAncestorContainer)) return false;
        try {
            var span = document.createElement("span");
            span.style.fontFamily = fontFamily;
            span.style.fontSize = sizePx;
            var frag = savedRange.extractContents();
            /* The selection may cross existing styled <span>s (mixed
               fonts/sizes). Their inline font-family/font-size would
               OVERRIDE the new outer span (= "nothing happens"), so strip
               those two props from every descendant. Other styling
               (italic/underline/color) is left intact. */
            var inner = frag.querySelectorAll
                ? frag.querySelectorAll("*") : [];
            for (var i = 0; i < inner.length; i++) {
                inner[i].style.removeProperty("font-family");
                inner[i].style.removeProperty("font-size");
            }
            span.appendChild(frag);
            savedRange.insertNode(span);
            /* Clear snapshot + tracked range so a later open WITHOUT a
               fresh selection cannot re-style this just-changed region
               (that was the "applies to a previously changed part" bug).
               We intentionally do NOT programmatically re-select it. */
            savedRange = null;
            lastEditorRange = null;
            return true;
        } catch (e) {
            console.error("[font-picker] apply to selection failed:", e);
            return false;
        }
    }

    /* Note: the old canvas-based isFontAvailable()/getAvailableFonts()
       were removed — the picker now shows the full curated list and
       relies on the browser's per-category fallback for missing fonts. */

    NP.fontPicker = {

        show: function () {
            if (overlayEl) return;

            /* Capture the editor selection BEFORE the modal steals focus. */
            saveEditorSelection();

            var currentFont = (NP.state && NP.state.data && NP.state.data.font_family) || "Consolas";
            var currentSize = (NP.state && NP.state.data && NP.state.data.font_size) || 14;

            /* Build overlay */
            var overlay = document.createElement("div");
            overlay.id = "font-picker-overlay";
            overlay.className = "np-modal";
            overlay.style.cssText =
                "position:fixed;top:0;left:0;width:100%;height:100%;" +
                "z-index:5000;background:rgba(0,0,0,0.55);" +
                "display:flex;align-items:center;justify-content:center;";

            /* #font-picker: background, border and radius from G7 (noirpad.css) */
            var modal = document.createElement("div");
            modal.id = "font-picker";
            modal.style.cssText =
                "width:520px;max-width:calc(90 * var(--np-vw));max-height:calc(85 * var(--np-vh));" +
                "display:flex;flex-direction:column;overflow:hidden;";

            /* Header */
            var header = document.createElement("div");
            header.style.cssText =
                "display:flex;align-items:center;justify-content:space-between;" +
                "padding:10px 16px;border-bottom:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            header.innerHTML =
                '<span id="font-picker-title" style="font-size:14px;font-weight:600;color:var(--fg-bright, #4cff7a);">' + NP.escapeHtml(NP.t("fontPicker.title")) + '</span>' +
                '<button id="font-picker-close" style="font-size:18px;color:var(--fg-dim, #00bf30);' +
                'cursor:pointer;background:none;border:none;padding:2px 8px;" title="' + NP.escapeHtml(NP.t("common.close")) +
                '" aria-label="' + NP.escapeHtml(NP.t("common.close")) + '">&times;</button>';
            modal.appendChild(header);

            /* Scrollable body — header stays fixed above, footer fixed
               below. flex:1 + min-height:0 + overflow-y:auto makes large
               previews scroll instead of pushing the buttons off-screen. */
            var body = document.createElement("div");
            body.style.cssText = "flex:1 1 auto;min-height:0;overflow-y:auto;";
            modal.appendChild(body);

            /* Filter input */
            var filterRow = document.createElement("div");
            filterRow.style.cssText = "padding:8px 16px;border-bottom:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            var filterInput = document.createElement("input");
            filterInput.type = "text";
            filterInput.placeholder = NP.t("fontPicker.filterPlaceholder");
            filterInput.setAttribute("aria-label", NP.t("fontPicker.filterPlaceholder"));
            filterInput.style.cssText =
                "width:100%;padding:4px 8px;font-size:12px;background:var(--bg-entry, #0d0d0d);" +
                "border:1px solid var(--border, #1a2e1a);border-radius:4px;color:var(--fg, #00ff41);";
            filterRow.appendChild(filterInput);
            body.appendChild(filterRow);

            /* Font list */
            var listContainer = document.createElement("div");
            /* U1: a listbox – ↑ ↓ Home End pick a font, Tab moves on. */
            listContainer.setAttribute("role", "listbox");
            listContainer.setAttribute("aria-labelledby", "font-picker-title");
            listContainer.style.cssText =
                "flex:1;overflow-y:auto;padding:4px 0;min-height:120px;max-height:200px;";

            var selectedFont = currentFont;

            function renderList(filter) {
                var hadFocus = listContainer.contains(document.activeElement);
                listContainer.innerHTML = "";
                var lowerFilter = (filter || "").toLowerCase();

                for (var c = 0; c < FONT_CATEGORIES.length; c++) {
                    var cat = FONT_CATEGORIES[c];
                    var matched = [];
                    for (var j = 0; j < cat.fonts.length; j++) {
                        if (!lowerFilter ||
                            cat.fonts[j].toLowerCase().indexOf(lowerFilter) !== -1) {
                            matched.push(cat.fonts[j]);
                        }
                    }
                    if (matched.length === 0) continue;

                    var hdr = document.createElement("div");
                    hdr.setAttribute("role", "presentation");
                    hdr.textContent = NP.t(cat.labelKey);
                    hdr.style.cssText =
                        "padding:8px 16px 3px;font-size:10px;letter-spacing:1px;" +
                        "text-transform:uppercase;color:var(--fg-dim, #00bf30);" +
                        "opacity:0.7;user-select:none;";
                    listContainer.appendChild(hdr);

                    for (var k = 0; k < matched.length; k++) {
                        var fontName = matched[k];
                        var item = document.createElement("div");
                        item.textContent = fontName;
                        item.dataset.font = fontName;
                        item.setAttribute("role", "option");
                        item.setAttribute("aria-selected", fontName === selectedFont ? "true" : "false");
                        item.tabIndex = -1;
                        item.style.cssText =
                            "padding:5px 16px;cursor:pointer;font-size:13px;" +
                            "font-family:'" + fontName + "'," + cat.fallback + ";" +
                            "color:var(--fg, #00ff41);transition:background 0.1s ease;";
                        if (fontName === selectedFont) {
                            item.style.background = "var(--hover-bg, #0f2314)";
                            item.style.color = "var(--fg-bright, #4cff7a)";
                        }
                        (function (fName, el) {
                            el.addEventListener("click", function () {
                                selectedFont = fName;
                                renderList(filterInput.value);
                                updatePreview();
                            });
                            el.addEventListener("mouseenter", function () {
                                el.style.background = "var(--hover-bg, #0f2314)";
                            });
                            el.addEventListener("mouseleave", function () {
                                if (fName !== selectedFont) {
                                    el.style.background = "transparent";
                                }
                            });
                        })(fontName, item);
                        listContainer.appendChild(item);
                    }
                }
                var options = listContainer.querySelectorAll("[role=option]");
                var current = listContainer.querySelector("[aria-selected=true]") || options[0];
                if (current) {
                    current.tabIndex = 0;
                    if (hadFocus) current.focus();
                }
            }

            listContainer.addEventListener("keydown", function (e) {
                var options = Array.prototype.slice.call(listContainer.querySelectorAll("[role=option]"));
                var i = options.indexOf(document.activeElement);
                var to = null;
                if (e.key === "ArrowDown") to = options[Math.min(i + 1, options.length - 1)];
                else if (e.key === "ArrowUp") to = options[Math.max(i - 1, 0)];
                else if (e.key === "Home") to = options[0];
                else if (e.key === "End") to = options[options.length - 1];
                else if (e.key === "Enter" || e.key === " ") to = document.activeElement;
                else return;
                e.preventDefault();
                if (to && to.dataset.font) to.click();
            });

            renderList("");
            body.appendChild(listContainer);

            /* Size input row */
            var sizeRow = document.createElement("div");
            sizeRow.style.cssText =
                "display:flex;align-items:center;gap:10px;padding:8px 16px;" +
                "border-top:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            sizeRow.innerHTML =
                '<label for="font-picker-size" style="font-size:12px;color:var(--fg-dim, #00bf30);">' + NP.escapeHtml(NP.t("fontPicker.sizeLabel")) + '</label>';
            var sizeInput = document.createElement("input");
            sizeInput.type = "number";
            sizeInput.id = "font-picker-size";
            sizeInput.min = MIN_SIZE;
            sizeInput.max = MAX_SIZE;
            sizeInput.value = currentSize;
            sizeInput.style.cssText =
                "width:60px;padding:3px 6px;font-size:12px;text-align:center;" +
                "background:var(--bg-entry, #0d0d0d);border:1px solid var(--border, #1a2e1a);" +
                "border-radius:4px;color:var(--fg, #00ff41);";
            sizeRow.appendChild(sizeInput);
            sizeRow.innerHTML += '<span style="font-size:11px;color:var(--fg-dim, #00bf30);">px (' + MIN_SIZE + '-' + MAX_SIZE + ')</span>';
            /* Re-get sizeInput after innerHTML concat */
            body.appendChild(sizeRow);
            sizeInput = sizeRow.querySelector("input");
            sizeInput.value = currentSize;       /* innerHTML += dropped the typed-in value */

            /* Preview area */
            var previewBox = document.createElement("div");
            previewBox.style.cssText =
                "padding:12px 16px;border-top:1px solid var(--border, #1a2e1a);flex-shrink:0;";
            var previewLabel = document.createElement("div");
            previewLabel.style.cssText = "font-size:11px;color:var(--fg-dim, #00bf30);margin-bottom:6px;";
            previewLabel.textContent = NP.t("fontPicker.previewLabel");
            previewBox.appendChild(previewLabel);

            var previewArea = document.createElement("div");
            previewArea.style.cssText =
                "padding:10px;background:var(--bg-entry, #0d0d0d);border:1px solid var(--border, #1a2e1a);" +
                "border-radius:4px;color:var(--fg, #00ff41);min-height:48px;max-height:180px;" +
                "overflow:auto;white-space:pre-wrap;";
            previewArea.textContent = NP.t("fontPicker.previewSample") + "\nABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789\n!@#$%^&*() {}<>[] =+-_";
            previewBox.appendChild(previewArea);
            body.appendChild(previewBox);

            function updatePreview() {
                var size = parseInt(sizeInput.value, 10) || currentSize;
                if (size < MIN_SIZE) size = MIN_SIZE;
                if (size > MAX_SIZE) size = MAX_SIZE;
                previewArea.style.fontFamily =
                    "'" + selectedFont + "', " + fallbackFor(selectedFont);
                previewArea.style.fontSize = size + "px";
            }

            updatePreview();

            /* Button row */
            var btnRow = document.createElement("div");
            btnRow.style.cssText =
                "display:flex;justify-content:flex-end;gap:8px;padding:10px 16px;" +
                "border-top:1px solid var(--border, #1a2e1a);flex-shrink:0;";

            var cancelBtn = document.createElement("button");
            cancelBtn.textContent = NP.t("common.cancel");
            cancelBtn.style.cssText =
                "padding:5px 16px;font-size:12px;border-radius:4px;" +
                "border:1px solid var(--border, #1a2e1a);color:var(--fg-dim, #00bf30);" +
                "background:transparent;cursor:pointer;";
            btnRow.appendChild(cancelBtn);

            var applyBtn = document.createElement("button");
            applyBtn.textContent = NP.t("fontPicker.apply");
            applyBtn.style.cssText =
                "padding:5px 16px;font-size:12px;border-radius:4px;" +
                "border:1px solid var(--accent, #00ff41);color:var(--fg-bright, #4cff7a);" +
                "background:var(--hover-bg, #0f2314);cursor:pointer;";
            btnRow.appendChild(applyBtn);
            modal.appendChild(btnRow);

            overlay.appendChild(modal);
            document.body.appendChild(overlay);
            overlayEl = overlay;

            /* Event handlers */
            filterInput.addEventListener("input", function () {
                renderList(filterInput.value);
            });

            sizeInput.addEventListener("input", function () {
                updatePreview();
            });

            cancelBtn.addEventListener("click", function () {
                close();
            });

            applyBtn.addEventListener("click", function () {
                var size = parseInt(sizeInput.value, 10) || currentSize;
                if (size < MIN_SIZE) size = MIN_SIZE;
                if (size > MAX_SIZE) size = MAX_SIZE;

                var fontFamily = "'" + selectedFont + "', " + fallbackFor(selectedFont);
                var sizePx = size + "px";

                if (savedRange && !savedRange.collapsed &&
                    applyFontToSelection(fontFamily, sizePx)) {
                    /* Per-text styling: lives in the note's content/formats,
                       NOT the global app default — so do NOT touch
                       editor.style or saveSettings. Persist the note now so
                       it survives reload (via _extractFormats). */
                    if (NP.editor && NP.editor.save) NP.editor.save(true);
                } else {
                    /* No selection → editor-wide default (existing
                       behaviour, persisted as a global app setting). */
                    var editor = document.getElementById("editor");
                    if (editor) {
                        editor.style.fontFamily = fontFamily;
                        editor.style.fontSize = sizePx;
                    }
                    if (NP.state && NP.state.data) {
                        NP.state.data.font_family = selectedFont;
                        NP.state.data.font_size = size;
                    }
                    if (NP.api && NP.api.saveSettings) {
                        NP.api.saveSettings({ font_family: selectedFont, font_size: size });
                    }
                }

                close();
            });

            header.querySelector("#font-picker-close").addEventListener("click", function () {
                close();
            });

            overlay.addEventListener("click", function (e) {
                if (e.target === overlay) close();
            });

            var escHandler = function (e) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                }
            };
            document.addEventListener("keydown", escHandler, true);

            function close() {
                document.removeEventListener("keydown", escHandler, true);
                var gone = overlayEl;
                if (overlayEl && overlayEl.parentNode) {
                    overlayEl.parentNode.removeChild(overlayEl);
                }
                overlayEl = null;
                if (NP.modal && gone) NP.modal.close(gone);
            }

            /* Focus filter; Tab stays in the window (U1) */
            if (NP.modal) NP.modal.open(overlay, { labelledBy: "font-picker-title", initialFocus: "input" });
            else filterInput.focus();
        }
    };

})(window.NP);
