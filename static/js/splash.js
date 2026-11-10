/* splash.js - ASCII art splash screen on startup */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var LOGO =
        "  \u2588\u2588\u2588\u2557   \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \n" +
        "  \u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\n" +
        "  \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\n" +
        "  \u2588\u2588\u2551\u255a\u2588\u2588\u2557\u2588\u2588\u2551\u2588\u2588\u2551   \u2588\u2588\u2551\u2588\u2588\u2551\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u255d \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\n" +
        "  \u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2588\u2551\u255a\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2551\u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2551     \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\n" +
        "  \u255a\u2550\u255d  \u255a\u2550\u2550\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u2550\u255d \u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u255d     \u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u2550\u2550\u2550\u2550\u255d ";

    function buildMessages() {
        var data = (NP.state && NP.state.data) || {};
        var tree = data.tree || [];

        function countByType(items, type) {
            var n = 0;
            for (var i = 0; i < items.length; i++) {
                if (!type || items[i].type === type) n++;
                if (items[i].children) n += countByType(items[i].children, type);
            }
            return n;
        }

        var notes = countByType(tree, "note");
        var folders = countByType(tree, "folder");
        var theme = data.theme || "matrix";
        var port = location.port || (location.protocol === "https:" ? "443" : "80");

        return [
            { ok: "[ OK ]", msg: NP.t("splash.mounted") },
            { ok: "[ OK ]", msg: NP.t("splash.loadedTree", {
                notes: NP.t("splash.notes", { n: notes }),
                folders: NP.t("splash.folders", { n: folders })
            }) },
            { ok: "[ OK ]", msg: NP.t("splash.crypto") },
            { ok: "[ OK ]", msg: NP.t("splash.backend", { port: port }) },
            { ok: "[ OK ]", msg: NP.t("splash.theme", { theme: NP.themeName ? NP.themeName(theme) : theme }) },
            { ok: "[ OK ]", msg: NP.t("splash.target") },
            { ok: "[ OK ]", msg: NP.t("splash.ready") }
        ];
    }

    var MSG_DELAY = 140;

    NP.splash = {

        show: function () {
            /* ALWAYS remove the HTML pre-app splash from index.html —
               it's a "Loading..." placeholder shown until JS boot
               completes. Keeping the early-return below the removal
               means show_splash=false still uncovers the app; we only
               skip the ASCII boot animation, not the cleanup. */
            var existing = document.getElementById("splash-overlay");
            if (existing) existing.parentNode.removeChild(existing);

            /* Settings v2: respect the show_splash setting (default true —
               undefined/missing key still shows the splash). */
            if (NP.state && NP.state.data && NP.state.data.show_splash === false) {
                return;
            }

            /* Create overlay */
            var overlay = document.createElement("div");
            overlay.id = "splash-overlay";
            overlay.style.cssText =
                "position:fixed;top:0;left:0;width:100%;height:100%;" +
                "z-index:9999;display:flex;flex-direction:column;" +
                "align-items:center;justify-content:center;" +
                "background:#000;opacity:1;transition:opacity 0.5s ease;" +
                "cursor:pointer;user-select:none;";

            /* Logo container */
            var logoPre = document.createElement("pre");
            logoPre.style.cssText =
                "font-family:'Cascadia Code','Fira Code','JetBrains Mono','Consolas',monospace;" +
                "font-size:12px;line-height:1.3;color:var(--accent);" +
                "text-shadow:none;filter:none;" +
                "text-align:center;" +
                "white-space:pre;margin-bottom:32px;";
            logoPre.textContent = LOGO;
            overlay.appendChild(logoPre);

            /* Messages container — left-aligned, narrow column for terminal feel */
            var msgBox = document.createElement("div");
            msgBox.style.cssText =
                "font-family:monospace;font-size:13px;line-height:1.7;" +
                "color:var(--fg-dim, #00bf30);text-align:left;min-height:200px;" +
                "min-width:420px;";
            overlay.appendChild(msgBox);

            /* Continue prompt (hidden initially) */
            var continueEl = document.createElement("div");
            continueEl.style.cssText =
                "font-family:monospace;font-size:14px;margin-top:24px;" +
                "color:var(--fg-dim, #00bf30);opacity:0;transition:opacity 0.4s ease;";
            continueEl.textContent = NP.t("splash.continue");
            overlay.appendChild(continueEl);

            document.body.appendChild(overlay);

            /* Animate messages one by one */
            var messages = buildMessages();
            var msgIndex = 0;
            var timer = setInterval(function () {
                if (msgIndex >= messages.length) {
                    clearInterval(timer);
                    continueEl.style.opacity = "1";
                    return;
                }
                var entry = messages[msgIndex];
                var line = document.createElement("div");

                var ok = document.createElement("span");
                ok.textContent = entry.ok + " ";
                ok.style.color = "var(--accent, #00ff41)";
                ok.style.textShadow = "none";
                ok.style.fontWeight = "bold";
                line.appendChild(ok);

                var msg = document.createElement("span");
                msg.textContent = entry.msg;
                if (msgIndex === messages.length - 1) {
                    msg.style.color = "var(--fg-bright, #4cff7a)";
                } else {
                    msg.style.color = "var(--fg, #00ff41)";
                }
                msg.style.textShadow = "none";
                line.appendChild(msg);

                msgBox.appendChild(line);
                msgIndex++;
            }, MSG_DELAY);

            /* Dismiss handler */
            function dismiss() {
                overlay.removeEventListener("click", dismiss);
                document.removeEventListener("keydown", dismiss);
                overlay.style.opacity = "0";
                setTimeout(function () {
                    if (overlay.parentNode) {
                        overlay.parentNode.removeChild(overlay);
                    }
                }, 500);
            }

            /* Wait until all messages shown before allowing dismiss */
            var totalDelay = messages.length * MSG_DELAY + 200;
            setTimeout(function () {
                overlay.addEventListener("click", dismiss);
                document.addEventListener("keydown", dismiss, { once: true });
            }, totalDelay);
        }
    };

})(window.NP);
