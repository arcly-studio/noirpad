/* utils.js - NoirPad utility functions */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* ---- UUID v4 ---- */
    NP.uuid = function () {
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = (Math.random() * 16) | 0;
            var v = c === "x" ? r : (r & 0x3) | 0x8;
            return v.toString(16);
        });
    };

    /* ---- Debounce ---- */
    NP.debounce = function (fn, ms) {
        var timer = null;
        return function () {
            var ctx = this;
            var args = arguments;
            clearTimeout(timer);
            timer = setTimeout(function () {
                fn.apply(ctx, args);
            }, ms);
        };
    };

    /* ---- DOM shortcuts ---- */
    NP.$ = function (sel) {
        return document.querySelector(sel);
    };

    NP.$$ = function (sel) {
        return document.querySelectorAll(sel);
    };

    /* ---- Escape HTML ----
       The one escaper for building HTML strings: text AND attribute
       values (quotes included). Prefer textContent / setAttribute when
       building DOM directly. */
    var HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    /* A NoirPad encryption envelope {"encrypted": true, "data": base64},
       as crypto.py is_encrypted_content (C12). */
    /* Windows high contrast (N12): the decorative effects stay off. */
    NP.forcedColors = function () {
        return !!(window.matchMedia && window.matchMedia("(forced-colors: active)").matches);
    };

    NP.isEncryptedEnvelope = function (content) {
        if (typeof content !== "string" || content.charAt(0) !== "{") return false;
        try {
            var obj = JSON.parse(content);
            return !!(obj && obj.encrypted === true && typeof obj.data === "string" &&
                /^[A-Za-z0-9+\/]{24,}={0,2}$/.test(obj.data));
        } catch (e) {
            return false;
        }
    };

    /* Full screen (F11, :fullscreen). The desktop app switches the real
       window (pywebview, via /api/desktop/fullscreen); a browser uses the
       Fullscreen API (D13). */
    NP.fullscreen = {
        toggle: function () {
            if (NP.api && NP.api.hasToken && NP.api.hasToken()) {
                return NP.api.fetch("/api/desktop/fullscreen", { method: "POST" })
                    .catch(function () { /* nothing to do */ });
            }
            var doc = document;
            var p = doc.fullscreenElement
                ? doc.exitFullscreen()
                : doc.documentElement.requestFullscreen();
            return Promise.resolve(p).catch(function () { /* refused by the browser */ });
        }
    };

    /* Text for searching: lower case, no diacritics ("Čeština" → "cestina"),
       folded one UTF-16 unit at a time, so every index in the result is
       the same index in the original (for highlighting) (D10). */
    var foldCache = {};
    NP.searchFold = function (str) {
        var out = "";
        for (var i = 0; i < str.length; i++) {
            var c = str.charAt(i);
            var f = foldCache[c];
            if (f === undefined) {
                f = c;
                try { f = c.normalize("NFD").charAt(0); } catch (e) { /* lone surrogate */ }
                f = f.toLowerCase().charAt(0) || c;
                foldCache[c] = f;
            }
            out += f;
        }
        return out;
    };

    NP.escapeHtml = function (str) {
        return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
            return HTML_ESCAPES[c];
        });
    };

    /* ---- Images and links ---- */

    /* Image files the backend stores: uuid4 + an allowed raster extension. */
    NP.IMAGE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp)$/i;

    NP.isImageName = function (name) {
        return typeof name === "string" && NP.IMAGE_NAME_RE.test(name);
    };

    /* Classify a link target. Only these may ever become clickable:
         "external" — http(s): and mailto:, opened outside the app window
         "image"    — /images/<valid name>, shown in the in-app viewer
       Anything else (javascript:, data:, file:, relative, //host) → null. */
    NP.linkKind = function (href) {
        if (typeof href !== "string") return null;
        href = href.trim();
        if (/^(https?:\/\/|mailto:)/i.test(href)) return "external";
        if (href.indexOf("/images/") === 0 && NP.isImageName(href.slice(8))) return "image";
        return null;
    };

    /* Image sources allowed in rendered notes (the CSP blocks remote ones). */
    NP.isImageSrc = function (src) {
        return NP.linkKind(src) === "image" ||
            /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src || "");
    };

    /* Sanitize an HTML string before it touches innerHTML. Falls back to
       plain text when DOMPurify failed to load. */
    var SANITIZE_CONFIG = {
        ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|\/images\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i,
        /* <input> only survives as a disabled checkbox (task lists, below). */
        FORBID_TAGS: ["style", "form", "button", "textarea", "select", "option"],
        FORBID_ATTR: ["style"]
    };
    var purifyHooked = false;

    NP.sanitizeHtml = function (html) {
        var purify = window.DOMPurify;
        if (!purify || !purify.sanitize) return NP.escapeHtml(html);
        if (!purifyHooked) {
            purifyHooked = true;
            purify.addHook("afterSanitizeAttributes", function (node) {
                if (node.tagName === "A" && !NP.linkKind(node.getAttribute("href"))) {
                    node.removeAttribute("href");
                }
                if (node.tagName === "IMG" && !NP.isImageSrc(node.getAttribute("src"))) {
                    node.removeAttribute("src");
                }
                if (node.tagName === "INPUT") {
                    ["name", "value", "form", "formaction", "id", "autofocus", "list"]
                        .forEach(function (a) { node.removeAttribute(a); });
                    node.setAttribute("type", "checkbox");
                    node.setAttribute("disabled", "");
                    node.setAttribute("tabindex", "-1");
                }
            });
        }
        return purify.sanitize(html, SANITIZE_CONFIG);
    };

    /* ---- Color helpers ---- */

    function hexToRgb(hex) {
        hex = hex.replace(/^#/, "");
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        var n = parseInt(hex, 16);
        return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }

    function rgbToHex(r, g, b) {
        return (
            "#" +
            ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b))
                .toString(16)
                .slice(1)
        );
    }

    function clamp(v, lo, hi) {
        return v < lo ? lo : v > hi ? hi : v;
    }

    NP.darkenColor = function (hex, factor) {
        var c = hexToRgb(hex);
        return rgbToHex(
            clamp(c.r * factor, 0, 255),
            clamp(c.g * factor, 0, 255),
            clamp(c.b * factor, 0, 255)
        );
    };

    NP.brightenColor = function (hex, factor) {
        var c = hexToRgb(hex);
        return rgbToHex(
            clamp(c.r + (255 - c.r) * factor, 0, 255),
            clamp(c.g + (255 - c.g) * factor, 0, 255),
            clamp(c.b + (255 - c.b) * factor, 0, 255)
        );
    };

    NP.interpolateColor = function (hex1, hex2, t) {
        var a = hexToRgb(hex1);
        var b = hexToRgb(hex2);
        return rgbToHex(
            a.r + (b.r - a.r) * t,
            a.g + (b.g - a.g) * t,
            a.b + (b.b - a.b) * t
        );
    };

    NP.computeColors = function (baseHex) {
        var base = baseHex || "#00ff41";
        return {
            BG: "#0a0a0a",
            BG_LIGHT: "#111111",
            BG_ENTRY: "#0d0d0d",
            FG: base,
            FG_DIM: NP.darkenColor(base, 0.75),
            FG_BRIGHT: NP.brightenColor(base, 0.3),
            ACCENT: base,
            BORDER: NP.interpolateColor(base, "#0a0a0a", 0.7),
            HOVER_BG: NP.interpolateColor(base, "#0a0a0a", 0.85),
            SELECT_BG: NP.interpolateColor(base, "#0a0a0a", 0.8),
            CURSOR_COLOR: base,
            GLOW: base
        };
    };

    /* ---- Theme color map ---- */
    NP.THEMES = {
        matrix: "#00ff41",
        amber: "#ffb000",
        cyan: "#00e5ff",
        red: "#ff3333",
        purple: "#bf40ff",
        blue: "#4488ff",
        pink: "#ff69b4",
        white: "#cccccc",
        gold: "#ffd700",
        lime: "#bfff00",
        orange: "#ff6600",
        ice: "#88ddff",
        dracula: "#bd93f9",
        synthwave: "#ff7edb",
        nord: "#88c0d0",
        gruvbox: "#fabd2f",
        "tokyo-night": "#7aa2f7"
    };

    /* ---- Tkinter-style line.col <-> offset conversion ---- */

    /* R3: where each line starts, built once per text (the last text is
       kept). A note with thousands of formats converts each in O(log n)
       instead of walking the whole text every time. */
    var lineCache = { text: null, starts: null };

    function lineStarts(text) {
        if (lineCache.starts && lineCache.text === text) return lineCache.starts;
        var starts = [0];
        for (var i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
        lineCache.text = text;
        lineCache.starts = starts;
        return starts;
    }

    NP.lineColToOffset = function (text, lineCol) {
        var parts = lineCol.split(".");
        var line = parseInt(parts[0], 10); // 1-based
        var col = parseInt(parts[1], 10);  // 0-based
        var starts = lineStarts(text);
        var k = line - 1;
        var base = 0;
        if (k > 0) {
            /* Past the last line: as if every line had its newline. */
            base = k < starts.length ? starts[k] : text.length + 1;
        }
        return base + col;
    };

    NP.offsetToLineCol = function (text, offset) {
        var o = Math.min(offset, text.length);
        if (!(o > 0)) return "1.0";
        var starts = lineStarts(text);
        var lo = 0, hi = starts.length - 1;      /* the last start <= o */
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (starts[mid] <= o) lo = mid; else hi = mid - 1;
        }
        return (lo + 1) + "." + (o - starts[lo]);
    };

})(window.NP);
