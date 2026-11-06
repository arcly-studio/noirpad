/* effects.js - Visual effects: CRT overlay, glitch typing */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var GLITCH_WINDOW_MS = 1000;
    var GLITCH_THRESHOLD = 5;       /* keys/sec required to trigger */
    var GLITCH_COOLDOWN_MS = 200;
    var GLITCH_DURATION_MS = 80;

    var inputTimes = [];
    var lastGlitchAt = 0;

    NP.effects = {

        /* ---- CRT scanlines ---- */

        /* Only the look; the setting is crt_enabled (Settings → Noir
           effects, NP.settings.setEffects). */
        crtShow: function (on) {
            document.body.classList.toggle("crt-on", !!on);
        },

        /* :crt */
        crtToggle: function () {
            var on = !NP.effects.crtIsOn();
            if (NP.settings && NP.settings.setEffects) NP.settings.setEffects({ crt: on });
            else NP.effects.crtShow(on);
        },

        crtIsOn: function () {
            return document.body.classList.contains("crt-on");
        },

        /* ---- Glitch typing ---- */

        onEditorInput: function () {
            /* Settings v2: glitch typing effect toggle (default on — only
               an explicit false disables it). */
            if (NP.state && NP.state.data &&
                NP.state.data.glitch_effect === false) {
                return;
            }
            if (NP.forcedColors && NP.forcedColors()) return;
            var now = performance.now();
            inputTimes.push(now);
            /* Drop entries older than the rolling window */
            var cutoff = now - GLITCH_WINDOW_MS;
            while (inputTimes.length && inputTimes[0] < cutoff) {
                inputTimes.shift();
            }
            if (inputTimes.length < GLITCH_THRESHOLD) return;
            if (now - lastGlitchAt < GLITCH_COOLDOWN_MS) return;
            lastGlitchAt = now;

            var editor = document.getElementById("editor");
            if (!editor) return;
            editor.classList.remove("glitching");
            void editor.offsetWidth;          /* restart animation */
            editor.classList.add("glitching");
            setTimeout(function () {
                editor.classList.remove("glitching");
            }, GLITCH_DURATION_MS + 20);
        }
    };

})(window.NP);
