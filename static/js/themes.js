/* themes.js - NoirPad theme switching */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    NP.themes = {
        apply: function (themeName) {
            /* An id (stored value, hidden alias) or a :theme name (N1.6). */
            var name = (NP.themeId && NP.themeId(themeName)) || themeName || "matrix";
            if (!NP.THEMES[name]) {
                name = "matrix";
            }
            document.documentElement.setAttribute("data-theme", name);

            /* Update state if loaded. R9: the start applies the stored
               theme — nothing to write then. */
            var changed = !(NP.state && NP.state.data && NP.state.data.theme === name);
            if (NP.state && NP.state.data) {
                NP.state.data.theme = name;
            }

            /* Notify post-render consumers (syntax-highlight.js
               needs to invalidate its theme-keyed cache and
               re-paint). */
            document.dispatchEvent(new CustomEvent(
                "np-theme-changed", { detail: { theme: name } }
            ));

            /* Persist to server */
            if (changed && NP.api && NP.api.saveSettings) {
                NP.api.saveSettings({ theme: name }).catch(function () {
                    /* silently ignore save errors */
                });
            }
        },

        getCurrent: function () {
            if (NP.state && NP.state.data && NP.state.data.theme) {
                return NP.state.data.theme;
            }
            return "matrix";
        }
    };

})(window.NP);
