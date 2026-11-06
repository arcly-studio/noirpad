/* shortcuts.js - Central keyboard-shortcut registry + dispatcher.
 *
 * One global capture-phase keydown listener replaces the per-module
 * hardcoded handlers. Handlers are registered by id; the binding for
 * each id lives in `registry` (default + current) and can later be
 * remapped from Settings (next phase) and persisted to the backend.
 *
 * Dispatcher contract:
 *   - On a keystroke match the registered handler is called.
 *   - If the handler returns `false`, the dispatcher CONTINUES iterating
 *     to find the next matching binding. This enables context-aware
 *     bindings (e.g. md-bold's Ctrl+B consumes only in MD mode; in
 *     rich-text it returns false so toggle-sidebar — also Ctrl+B — can
 *     fire). When all matching handlers passthrough, the event falls
 *     through to browser default (e.g. Delete in a focused input still
 *     deletes the character).
 *   - Otherwise the event is consumed (preventDefault + stopPropagation).
 *
 * Iteration order is for...in (insertion order). Place higher-priority
 * (more specific) bindings earlier in the registry — Markdown actions
 * are listed first so they get the first chance to claim conflicting
 * keystrokes like Ctrl+B.
 */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* ============== Helpers ============== */

    function normalizeKey(key) {
        if (!key) return "";
        if (key === " " || key === "Spacebar") return "Space";
        if (key.length === 1) return key.toLowerCase();
        return key;
    }

    function eventToKeystroke(e) {
        var parts = [];
        if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");

        var key = normalizeKey(e.key);
        if (key === "Control" || key === "Alt" ||
            key === "Shift" || key === "Meta") {
            return null;
        }
        /* "+" separates the parts of a keystroke: the plus key is written "=". */
        if (key === "+") {
            parts = parts.filter(function (p) { return p !== "Shift"; });
            key = "=";
        }
        parts.push(key);
        return parts.join("+");
    }

    function hasPart(parts, name) {
        for (var i = 0; i < parts.length; i++) {
            if (parts[i] === name) return true;
        }
        return false;
    }

    function parseKeystroke(str) {
        var raw = str.split("+");
        var parts = [];
        for (var i = 0; i < raw.length; i++) parts.push(raw[i].trim());
        return {
            ctrl:  hasPart(parts, "Ctrl"),
            alt:   hasPart(parts, "Alt"),
            shift: hasPart(parts, "Shift"),
            key:   normalizeKey(parts[parts.length - 1])
        };
    }

    function matchesKeystroke(e, ks) {
        var p = parseKeystroke(ks);
        var key = normalizeKey(e.key);
        var shift = !!e.shiftKey;
        /* The plus key, wherever a keyboard has it: Shift+= (US), its own key
           (Czech) or the numeric keypad. */
        if (key === "+") {
            key = "=";
            shift = false;
        }
        /* The key marked 0 gives another character on Czech keyboards. */
        if (p.key === "0" && !shift && (e.code === "Digit0" || e.code === "Numpad0")) key = "0";
        /* ctrl == ctrl||meta to match the old `e.ctrlKey || e.metaKey`
           behaviour (Cmd on macOS) used by every migrated handler. */
        return (
            !!(e.ctrlKey || e.metaKey) === p.ctrl &&
            !!e.altKey === p.alt &&
            shift === p.shift &&
            key === p.key
        );
    }

    /* Browser-reserved combos that must not be rebound. */
    var BLACKLIST = [
        "Ctrl+T", "Ctrl+Shift+T", "Ctrl+N", "Ctrl+Shift+N",
        "Ctrl+R", "F5", "Ctrl+Q", "F11", "F12", "Ctrl+Shift+I",
        "Ctrl+Shift+J", "Ctrl+U", "Ctrl+Shift+C"
    ];

    /* U11: the desktop window has no browser around it, so NoirPad's own
       default keys from that list work there (and may be set again). */
    var DESKTOP_ALLOWED = ["Ctrl+Shift+T", "Ctrl+Shift+N", "Ctrl+Shift+I", "F11"];

    /* U11: in a browser tab (NoirPad-web) the browser takes these default
       keys (new window, reopen tab, dev tools) before the page sees them;
       there NoirPad uses Alt+Shift instead. */
    var WEB_DEFAULTS = {
        "new-note": "Alt+Shift+N",
        "open-font-picker": "Alt+Shift+T",
        "insert-image": "Alt+Shift+I",
        /* The browser's own zoom keys work there. */
        "zoom-in": "",
        "zoom-out": "",
        "zoom-reset": ""
    };

    /* The desktop app opens the page with its per-launch token (api.js). */
    function inDesktop() {
        return !!(NP.api && NP.api.hasToken && NP.api.hasToken());
    }

    /* Canonical form for comparison: single-char final key uppercased
       (matches the registry defaults like "Ctrl+S" and the BLACKLIST),
       so blacklist / conflict checks aren't defeated by letter case. */
    function normKs(ks) {
        if (!ks) return "";
        var parts = String(ks).split("+");
        var last = parts[parts.length - 1];
        if (last && last.length === 1) {
            parts[parts.length - 1] = last.toUpperCase();
        }
        return parts.join("+");
    }

    /* ============== Registry ============== */

    var registry = {
        /* Markdown — listed FIRST so for...in dispatch order gives these
           priority over conflicting bindings (e.g. md-bold's Ctrl+B vs
           toggle-sidebar's Ctrl+B). MD handlers return false when the MD
           textarea isn't focused, and the dispatcher's "continue on
           passthrough" semantics let the next matching binding fire. */
        "md-h1":                { default: "",              current: "",              labelKey: "shortcuts.labels.mdH1",        categoryKey: "shortcuts.categories.markdown" },
        "md-h2":                { default: "",              current: "",              labelKey: "shortcuts.labels.mdH2",        categoryKey: "shortcuts.categories.markdown" },
        "md-h3":                { default: "",              current: "",              labelKey: "shortcuts.labels.mdH3",        categoryKey: "shortcuts.categories.markdown" },
        "md-bold":              { default: "Ctrl+B",        current: "Ctrl+B",        labelKey: "shortcuts.labels.mdBold",              categoryKey: "shortcuts.categories.markdown" },
        "md-italic":            { default: "Ctrl+I",        current: "Ctrl+I",        labelKey: "shortcuts.labels.mdItalic",            categoryKey: "shortcuts.categories.markdown" },
        "md-code-inline":       { default: "Ctrl+E",        current: "Ctrl+E",        labelKey: "shortcuts.labels.mdCodeInline",       categoryKey: "shortcuts.categories.markdown" },
        "md-strikethrough":     { default: "",              current: "",              labelKey: "shortcuts.labels.mdStrikethrough",     categoryKey: "shortcuts.categories.markdown" },
        "md-code-block":        { default: "Ctrl+Shift+E",  current: "Ctrl+Shift+E",  labelKey: "shortcuts.labels.mdCodeBlock",        categoryKey: "shortcuts.categories.markdown" },
        "md-quote":             { default: "",              current: "",              labelKey: "shortcuts.labels.mdQuote",             categoryKey: "shortcuts.categories.markdown" },
        "md-list-bullet":       { default: "",              current: "",              labelKey: "shortcuts.labels.mdListBullet",       categoryKey: "shortcuts.categories.markdown" },
        "md-list-numbered":     { default: "",              current: "",              labelKey: "shortcuts.labels.mdListNumbered",     categoryKey: "shortcuts.categories.markdown" },
        "md-horizontal-rule":   { default: "",              current: "",              labelKey: "shortcuts.labels.mdHorizontalRule",   categoryKey: "shortcuts.categories.markdown" },
        "md-link":              { default: "Ctrl+K",        current: "Ctrl+K",        labelKey: "shortcuts.labels.mdLink",              categoryKey: "shortcuts.categories.markdown" },
        "md-image":             { default: "",              current: "",              labelKey: "shortcuts.labels.mdImage",             categoryKey: "shortcuts.categories.markdown" },

        /* Editor */
        "save":                 { default: "Ctrl+S",        current: "Ctrl+S",        labelKey: "shortcuts.labels.save",              categoryKey: "shortcuts.categories.editor" },
        "find":                 { default: "Ctrl+F",        current: "Ctrl+F",        labelKey: "shortcuts.labels.find",           categoryKey: "shortcuts.categories.editor" },
        "find-next":            { default: "F3",            current: "F3",            labelKey: "shortcuts.labels.findNext",              categoryKey: "shortcuts.categories.editor" },
        "find-prev":            { default: "Shift+F3",      current: "Shift+F3",      labelKey: "shortcuts.labels.findPrev",          categoryKey: "shortcuts.categories.editor" },
        "insert-image":         { default: "Ctrl+Shift+I",  current: "Ctrl+Shift+I",  labelKey: "shortcuts.labels.insertImage",           categoryKey: "shortcuts.categories.editor" },
        "clear-formatting":     { default: "Ctrl+Space",    current: "Ctrl+Space",    labelKey: "shortcuts.labels.clearFormatting",  categoryKey: "shortcuts.categories.editor" },
        "toggle-markdown":      { default: "Ctrl+M",        current: "Ctrl+M",        labelKey: "shortcuts.labels.toggleMarkdown",   categoryKey: "shortcuts.categories.editor" },

        /* Notes */
        "new-folder":           { default: "Ctrl+Shift+F",  current: "Ctrl+Shift+F",  labelKey: "shortcuts.labels.newFolder",             categoryKey: "shortcuts.categories.notes" },
        "new-note":             { default: "Ctrl+Shift+N",  current: "Ctrl+Shift+N",  labelKey: "shortcuts.labels.newNote",               categoryKey: "shortcuts.categories.notes" },
        "delete":               { default: "Delete",        current: "Delete",        labelKey: "shortcuts.labels.delete",        categoryKey: "shortcuts.categories.notes" },
        "rename":               { default: "F2",            current: "F2",            labelKey: "shortcuts.labels.rename",        categoryKey: "shortcuts.categories.notes" },
        "toggle-favorite":      { default: "Ctrl+D",        current: "Ctrl+D",        labelKey: "shortcuts.labels.toggleFavorite",        categoryKey: "shortcuts.categories.notes" },
        "toggle-lock":          { default: "Ctrl+Shift+L",  current: "Ctrl+Shift+L",  labelKey: "shortcuts.labels.toggleLock",       categoryKey: "shortcuts.categories.notes" },

        /* UI */
        "toggle-sidebar":       { default: "Ctrl+B",        current: "Ctrl+B",        labelKey: "shortcuts.labels.toggleSidebar",   categoryKey: "shortcuts.categories.ui" },
        "toggle-orientation":   { default: "Ctrl+L",        current: "Ctrl+L",        labelKey: "shortcuts.labels.toggleOrientation",categoryKey: "shortcuts.categories.ui" },
        "open-settings":        { default: "Ctrl+,",        current: "Ctrl+,",        labelKey: "shortcuts.labels.openSettings",          categoryKey: "shortcuts.categories.ui" },
        "open-help":            { default: "F1",            current: "F1",            labelKey: "shortcuts.labels.openHelp",              categoryKey: "shortcuts.categories.ui" },
        "find-all":             { default: "Ctrl+Shift+K",  current: "Ctrl+Shift+K",  labelKey: "shortcuts.labels.findAll",            categoryKey: "shortcuts.categories.ui" },
        "open-command-palette": { default: "Ctrl+Shift+P",  current: "Ctrl+Shift+P",  labelKey: "shortcuts.labels.openCommandPalette",   categoryKey: "shortcuts.categories.ui" },
        "open-font-picker":     { default: "Ctrl+Shift+T",  current: "Ctrl+Shift+T",  labelKey: "shortcuts.labels.openFontPicker",       categoryKey: "shortcuts.categories.ui" },
        "fullscreen":           { default: "F11",           current: "F11",           labelKey: "shortcuts.labels.fullscreen",      categoryKey: "shortcuts.categories.ui" },

        /* Tabs */
        "next-tab":             { default: "Ctrl+Tab",      current: "Ctrl+Tab",      labelKey: "shortcuts.labels.nextTab",               categoryKey: "shortcuts.categories.tabs" },
        "prev-tab":             { default: "Ctrl+Shift+Tab",current: "Ctrl+Shift+Tab",labelKey: "shortcuts.labels.prevTab",           categoryKey: "shortcuts.categories.tabs" },
        "close-tab":            { default: "Ctrl+W",        current: "Ctrl+W",        labelKey: "shortcuts.labels.closeTab",              categoryKey: "shortcuts.categories.tabs" },

        /* Zoom: last, so a key someone already gave another action stays with it. */
        "zoom-in":              { default: "Ctrl+=",        current: "Ctrl+=",        labelKey: "shortcuts.labels.zoomIn",                categoryKey: "shortcuts.categories.ui" },
        "zoom-out":             { default: "Ctrl+-",        current: "Ctrl+-",        labelKey: "shortcuts.labels.zoomOut",               categoryKey: "shortcuts.categories.ui" },
        "zoom-reset":           { default: "Ctrl+0",        current: "Ctrl+0",        labelKey: "shortcuts.labels.zoomReset",             categoryKey: "shortcuts.categories.ui" }
    };

    var handlers = {}; /* id -> function (may return false = passthrough) */

    /* ============== Public API ============== */

    NP.shortcuts = {

        inDesktop: inDesktop,

        register: function (id, handler) {
            handlers[id] = handler;
        },

        getAll: function () {
            return registry;
        },

        /* Run an action as if its key had been pressed (start page rows). */
        run: function (id) {
            if (handlers[id]) return handlers[id]();
        },

        /* Display texts. The registry is built at load time (before the
           dictionaries arrive), so it stores keys; resolve them here. */
        label: function (id) {
            return registry[id] ? NP.t(registry[id].labelKey) : "";
        },

        categoryLabel: function (id) {
            return registry[id] ? NP.t(registry[id].categoryKey) : "";
        },

        getCurrent: function (id) {
            return registry[id] ? registry[id].current : null;
        },

        setCurrent: function (id, keystroke) {
            if (registry[id]) {
                registry[id].current = keystroke;
                NP.shortcuts.persist();
            }
        },

        reset: function (id) {
            if (registry[id]) {
                registry[id].current = registry[id].default;
                NP.shortcuts.persist();
            }
        },

        resetAll: function () {
            for (var id in registry) {
                registry[id].current = registry[id].default;
            }
            NP.shortcuts.persist();
        },

        persist: function () {
            if (NP.api && NP.api.saveSettings) {
                var mapping = {};
                for (var id in registry) {
                    if (registry[id].current !== registry[id].default) {
                        mapping[id] = registry[id].current;
                    }
                }
                if (NP.state && NP.state.data) {
                    NP.state.data.custom_shortcuts = mapping;
                }
                NP.api.saveSettings({ custom_shortcuts: mapping });
            }
        },

        loadFromState: function () {
            if (NP.state && NP.state.data && NP.state.data.custom_shortcuts) {
                var mapping = NP.state.data.custom_shortcuts;
                for (var id in mapping) {
                    if (registry[id]) {
                        registry[id].current = mapping[id];
                    }
                }
            }
        },

        validate: function (keystroke) {
            keystroke = normKs(keystroke);
            if (!keystroke) {
                return { ok: false, reason: NP.t("shortcuts.errors.empty") };
            }
            var hasModifier = /^(Ctrl|Alt|Shift)\+/.test(keystroke);
            var standalone = /^(F\d+|Delete|Insert|Home|End|PageUp|PageDown|Escape)$/
                .test(keystroke);
            if (!hasModifier && !standalone) {
                return {
                    ok: false,
                    reason: NP.t("shortcuts.errors.needsModifier")
                };
            }
            for (var i = 0; i < BLACKLIST.length; i++) {
                if (inDesktop() && DESKTOP_ALLOWED.indexOf(BLACKLIST[i]) !== -1) continue;
                if (normKs(BLACKLIST[i]) === keystroke) {
                    return {
                        ok: false,
                        reason: NP.t("shortcuts.errors.reserved")
                    };
                }
            }
            return { ok: true };
        },

        findConflict: function (keystroke, excludeId) {
            keystroke = normKs(keystroke);
            for (var id in registry) {
                if (id === excludeId) continue;
                if (registry[id].current &&
                    normKs(registry[id].current) === keystroke) {
                    return { id: id, label: NP.shortcuts.label(id) };
                }
            }
            return null;
        },

        /* Expose for the (future) Settings editor + tests. */
        eventToKeystroke: eventToKeystroke,

        _bound: false,

        /* True while a modal window covers the app. */
        modalOpen: function () {
            return !!document.querySelector(
                "#settings-overlay.visible, #help-overlay.visible, #shortcuts-overlay.visible, " +
                ".np-modal, .np-findall-overlay, .np-dialog, " +
                ".np-password-dialog, #image-viewer-overlay");
        },

        init: function () {
            if (!inDesktop() && !NP.shortcuts._webDefaults) {
                NP.shortcuts._webDefaults = true;
                for (var wid in WEB_DEFAULTS) {
                    if (registry[wid]) {
                        if (registry[wid].current === registry[wid].default) registry[wid].current = WEB_DEFAULTS[wid];
                        registry[wid].default = WEB_DEFAULTS[wid];
                    }
                }
            }
            NP.shortcuts.loadFromState();

            if (NP.shortcuts._bound) return;   /* one listener only */
            NP.shortcuts._bound = true;

            document.addEventListener("keydown", function (e) {
                /* While recording a new binding in Settings, let the
                   keystroke pass through to the recorder (no dispatch,
                   no preventDefault). */
                if (NP.shortcuts._recordingActive) return;
                /* Settings, help, pickers and dialogs are modal: under them
                   only F1 (help) works, so e.g. Delete can't trash the note
                   behind the Settings window (C2). Escape is theirs. */
                var modal = NP.shortcuts.modalOpen();
                for (var id in registry) {
                    var ks = registry[id].current;
                    if (!ks) continue;
                    if (modal && id !== "open-help") continue;
                    if (!matchesKeystroke(e, ks)) continue;

                    var handler = handlers[id];
                    if (!handler) {
                        /* Bound but no handler — try the next binding for
                           this keystroke (could be a more specific action
                           that owns the key). */
                        continue;
                    }
                    var result;
                    try {
                        result = handler(e);
                    } catch (err) {
                        console.error(
                            "Shortcut handler error for " + id + ":", err  // i18n-ignore (console log)
                        );
                    }
                    if (result === false) {
                        /* Context-aware passthrough — try the next binding
                           that matches the same keystroke (e.g. md-bold
                           defers to toggle-sidebar outside MD mode). If
                           none matches, the key falls through to browser
                           default at the bottom of the loop. */
                        continue;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }, true); /* capture: run before contentEditable defaults */
        }
    };

})(window.NP);
