/* cursor.js - Soft caret-row glow under the editor caret */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var ROW_HEIGHT = 28;     /* Approx line-height in px (matches #editor) */
    var GLOW_WIDTH = 360;    /* Half-width of the radial glow */
    var FADE_MS = 180;

    NP.cursor = {
        el: null,
        wrapper: null,
        rafId: null,
        _visible: false,
        _listeners: null,

        init: function () {
            if (this.el) return;

            this.wrapper = document.getElementById("editor-wrapper");
            if (!this.wrapper) return;
            if (getComputedStyle(this.wrapper).position === "static") {
                this.wrapper.style.position = "relative";
            }

            var glow = document.createElement("div");
            glow.id = "np-caret-glow";
            glow.style.cssText =
                "position:absolute;left:0;right:0;height:" + ROW_HEIGHT + "px;" +
                "pointer-events:none;z-index:1;opacity:0;" +
                "transition:opacity " + FADE_MS + "ms ease, top 80ms linear;";
            this.wrapper.appendChild(glow);
            this.el = glow;

            var self = this;
            this._listeners = {
                input: function () { self._scheduleUpdate(); },
                keyup: function () { self._scheduleUpdate(); },
                mouseup: function () { self._scheduleUpdate(); },
                focusin: function (e) { self._onFocus(e); },
                focusout: function (e) { self._onBlur(e); },
                scroll: function () { self._scheduleUpdate(); }
            };

            var editor = document.getElementById("editor");
            if (editor) {
                editor.addEventListener("input", this._listeners.input);
                editor.addEventListener("keyup", this._listeners.keyup);
                editor.addEventListener("mouseup", this._listeners.mouseup);
                editor.addEventListener("scroll", this._listeners.scroll);
            }
            document.addEventListener("focusin", this._listeners.focusin);
            document.addEventListener("focusout", this._listeners.focusout);
            document.addEventListener("selectionchange", this._listeners.input);
        },

        _onFocus: function (e) {
            var editor = document.getElementById("editor");
            if (!editor) return;
            if (editor === e.target || editor.contains(e.target)) {
                if (editor.getAttribute("contenteditable") !== "true") {
                    this.hide();
                } else {
                    this.show();
                    this._scheduleUpdate();
                }
            }
        },

        _onBlur: function (e) {
            var editor = document.getElementById("editor");
            if (!editor) return;
            if (editor === e.target || editor.contains(e.target)) {
                this.hide();
            }
        },

        _scheduleUpdate: function () {
            if (this.rafId) return;
            var self = this;
            this.rafId = requestAnimationFrame(function () {
                self.rafId = null;
                self._updatePos();
            });
        },

        _updatePos: function () {
            if (!this.el || !this.wrapper) return;

            var editor = document.getElementById("editor");
            if (!editor || editor.getAttribute("contenteditable") !== "true") {
                this.hide();
                return;
            }

            var sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) return;
            var range = sel.getRangeAt(0);
            if (!editor.contains(range.startContainer)) return;

            /* Get caret rect via a zero-width marker (insertNode/remove is reliable) */
            var rect;
            var collapsed = range.cloneRange();
            collapsed.collapse(true);
            var rects = collapsed.getClientRects();
            if (rects.length > 0) {
                rect = rects[0];
            } else {
                /* Fallback: insert a zero-width span */
                var span = document.createElement("span");
                span.textContent = "​";
                collapsed.insertNode(span);
                rect = span.getClientRects()[0];
                var parent = span.parentNode;
                if (parent) {
                    parent.removeChild(span);
                    parent.normalize();
                }
            }

            if (!rect || (rect.width === 0 && rect.height === 0 && rect.top === 0)) return;

            rect = NP.cssRect(rect);
            var wrapRect = NP.cssRect(this.wrapper);
            var caretY = rect.top - wrapRect.top + (rect.height || ROW_HEIGHT) / 2 - ROW_HEIGHT / 2;
            var caretX = rect.left - wrapRect.left;

            /* Build a radial gradient centered at caret, fading to transparent */
            /* Horizontal-only linear gradient — no central peak, so no visible dot */
            this.el.style.top = Math.round(caretY) + "px";
            var leftEdge = Math.max(0, Math.round(caretX) - GLOW_WIDTH);
            var rightEdge = Math.round(caretX) + GLOW_WIDTH;
            this.el.style.background =
                "linear-gradient(to right," +   // i18n-ignore (CSS value)
                "transparent " + leftEdge + "px," +
                "color-mix(in srgb, var(--accent) 12%, transparent) " + Math.round(caretX) + "px," +   // i18n-ignore (CSS value)
                "transparent " + rightEdge + "px)";
            this.el.style.boxShadow = "none";

            this.show();
        },

        show: function () {
            if (!this.el) return;
            this._visible = true;
            this.el.style.opacity = "0.35";
        },

        hide: function () {
            if (!this.el) return;
            this._visible = false;
            this.el.style.opacity = "0";
        }
    };

})(window.NP);
