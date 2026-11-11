/* licenses.js - About → Licenses (N8, N9).

   A G7 window over Settings with NoirPad's LICENSE and
   THIRD-PARTY-NOTICES.txt, loaded from /api/licenses on first open.
   The texts go in with textContent only. Escape and the close button
   close this window; Settings stays open underneath. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var overlay = null;
    var cache = null;

    function el(tag, cls, text) {
        var node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text != null) node.textContent = text;
        return node;
    }

    function onKey(e) {
        if (e.key !== "Escape" || !overlay) return;
        e.preventDefault();
        e.stopPropagation();
        close();
    }

    function close() {
        if (!overlay) return;
        var gone = overlay;
        overlay = null;
        window.removeEventListener("keydown", onKey, true);
        if (gone.parentNode) gone.parentNode.removeChild(gone);
        if (NP.modal) NP.modal.close(gone);
    }

    function fill(body, data) {
        body.textContent = "";
        var own = el("pre", "licenses-text");
        own.textContent = data.license;
        var third = el("pre", "licenses-text");
        third.textContent = data.notices;
        body.appendChild(el("h3", "licenses-heading", NP.t("ui.licenses.noirpad")));
        body.appendChild(own);
        body.appendChild(el("h3", "licenses-heading", NP.t("ui.licenses.thirdParty")));
        body.appendChild(third);
    }

    function load() {
        if (cache) return Promise.resolve(cache);
        return NP.api.licenses().then(function (data) {
            if (!data || typeof data.license !== "string" || typeof data.notices !== "string") {
                throw new Error("bad response");
            }
            cache = data;
            return data;
        });
    }

    function open() {
        if (overlay) return Promise.resolve();
        overlay = el("div", "licenses-overlay");
        overlay.id = "licenses-overlay";
        var win = el("div");
        win.id = "licenses-window";

        var header = el("div", "licenses-header");
        var title = el("h2", null, NP.t("ui.licenses.title"));
        title.id = "licenses-title";
        var closeBtn = el("button", "licenses-close", "×");
        closeBtn.type = "button";
        closeBtn.setAttribute("aria-label", NP.t("common.close"));
        closeBtn.title = NP.t("common.close");
        closeBtn.addEventListener("click", close);
        header.appendChild(title);
        header.appendChild(closeBtn);

        var body = el("div", "licenses-body");
        body.tabIndex = 0;                      /* scrollable from the keyboard */
        body.setAttribute("role", "document");
        body.setAttribute("aria-labelledby", "licenses-title");
        body.appendChild(el("p", "licenses-status", NP.t("ui.licenses.loading")));

        win.appendChild(header);
        win.appendChild(body);
        overlay.appendChild(win);
        overlay.addEventListener("mousedown", function (e) {
            if (e.target === overlay) close();
        });
        document.body.appendChild(overlay);
        window.addEventListener("keydown", onKey, true);
        if (NP.modal) NP.modal.open(overlay, { labelledBy: "licenses-title", initialFocus: ".licenses-close" });

        var mine = overlay;
        return load().then(function (data) {
            if (overlay === mine) fill(body, data);
        }).catch(function () {
            if (overlay !== mine) return;
            body.textContent = "";
            body.appendChild(el("p", "licenses-status", NP.t("ui.licenses.failed")));
        });
    }

    NP.licenses = {
        open: open,
        close: close,
        isOpen: function () { return !!overlay; }
    };
})(window.NP);
