/* focus-mode.js - Focus mode with sidebar slide animation */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var EXIT_BTN_ID = "focus-mode-exit-btn";

    /* The key currently set for focus mode ("—" when none). */
    function focusKeys() {
        return (NP.shortcuts && NP.shortcuts.getCurrent && NP.shortcuts.getCurrent("toggle-sidebar")) || "—";
    }

    NP.focusMode = {
        active: false,

        toggle: function () {
            if (this.active) {
                this._leave();
            } else {
                this._enter();
            }
        },

        _enter: function () {
            this.active = true;
            if (NP.state) NP.state.focusMode = true;

            var sidebar = document.getElementById("sidebar");
            if (sidebar) {
                sidebar.classList.add("collapsed");
            }

            /* Add focus-mode class on body for any additional CSS targeting */
            document.body.classList.add("focus-mode");

            /* Create small exit button on left edge */
            this._createExitBtn();
        },

        _leave: function () {
            this.active = false;
            if (NP.state) NP.state.focusMode = false;

            var sidebar = document.getElementById("sidebar");
            if (sidebar) {
                sidebar.classList.remove("collapsed");
            }

            document.body.classList.remove("focus-mode");

            /* Slide out exit button then remove */
            var btn = document.getElementById(EXIT_BTN_ID);
            if (btn) {
                btn.style.left = "-20px";
                btn.style.opacity = "0";
                setTimeout(function () {
                    if (btn.parentNode) btn.parentNode.removeChild(btn);
                }, 400);
            }
        },

        _createExitBtn: function () {
            /* Remove if already exists */
            this._removeExitBtn();

            var btn = document.createElement("button");
            btn.id = EXIT_BTN_ID;
            btn.title = NP.t("focus.exitTitle", { keys: focusKeys() });
            btn.innerHTML = "&#9654;"; /* Right-pointing triangle */
            btn.style.cssText =
                "position:fixed;left:-20px;top:50%;transform:translateY(-50%);" +
                "z-index:800;width:20px;height:48px;padding:0;" +
                "background:var(--bg-light, #111);border:1px solid var(--border, #1a2e1a);" +
                "border-left:none;border-radius:0 6px 6px 0;" +
                "color:var(--fg-dim, #00bf30);font-size:10px;" +
                "cursor:pointer;opacity:0;" +
                "transition:left 0.4s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease;";
            /* Slide in after a frame */
            requestAnimationFrame(function () {
                btn.style.left = "0";
                btn.style.opacity = "0.4";
            });

            btn.addEventListener("mouseenter", function () {
                btn.style.opacity = "1";
            });
            btn.addEventListener("mouseleave", function () {
                btn.style.opacity = "0.4";
            });

            var self = this;
            btn.addEventListener("click", function () {
                self.toggle();
            });

            document.body.appendChild(btn);
        },

        _removeExitBtn: function () {
            var btn = document.getElementById(EXIT_BTN_ID);
            if (btn && btn.parentNode) {
                btn.parentNode.removeChild(btn);
            }
        }
    };

})(window.NP);
