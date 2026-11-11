/* auth.js - NoirPad start gate.
   NoirPad has a single local profile. Two optional passwords are asked
   here before anything loads: a self-hosted server's NOIRPAD_PASSWORD,
   then the App lock (app-lock.js). Otherwise the app boots straight away. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var session = null;   // last /api/session response
    var overlay = null;
    var mode = "server";  // which password the gate asks for: "server" | "applock"

    function el(tag, attrs, children) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (k) {
                if (k === "class") node.className = attrs[k];
                else if (k === "text") node.textContent = attrs[k];
                else if (attrs[k] !== undefined && attrs[k] !== null) {
                    node.setAttribute(k, attrs[k]);
                }
            });
        }
        (children || []).forEach(function (c) {
            if (c == null) return;
            if (typeof c === "string") node.appendChild(document.createTextNode(c));
            else node.appendChild(c);
        });
        return node;
    }

    function buildOverlay() {
        if (overlay) return overlay;

        overlay = el("div", { id: "auth-overlay", class: "auth-overlay" }, [
            el("div", { class: "auth-window" }, [
                el("img", { class: "auth-logo np-decorative", src: "/static/img/noirpad-icon.svg",
                            width: "64", height: "64", alt: "", draggable: "false",
                            "aria-hidden": "true" }),
                el("pre", { id: "auth-ascii", class: "auth-ascii", text:
" _   _       _      ____           _\n" +
"| \\ | | ___ (_)_ __|  _ \\ __ _  __| |\n" +
"|  \\| |/ _ \\| | '__| |_) / _` |/ _` |\n" +
"| |\\  | (_) | | |  |  __/ (_| | (_| |\n" +
"|_| \\_|\\___/|_|_|  |_|   \\__,_|\\__,_|"
                }),
                el("div", { id: "auth-subtitle", class: "auth-subtitle" }),
                el("form", { id: "auth-form", class: "auth-form" }, [
                    el("div", { class: "auth-row" }, [
                        el("label", { for: "auth-password", text: NP.t("auth.password") }),
                        el("input", {
                            id: "auth-password",
                            type: "password",
                            autocomplete: "current-password",
                            required: "required"
                        })
                    ]),
                    el("div", { id: "auth-remember-row", class: "auth-row auth-row-inline" }, [
                        el("label", { class: "auth-check" }, [
                            el("input", { id: "auth-remember", type: "checkbox", checked: "checked" }),
                            el("span", { text: " " + NP.t("auth.remember") })
                        ])
                    ]),
                    el("div", { id: "auth-error", class: "auth-error" }),
                    el("button", {
                        id: "auth-submit",
                        type: "submit",
                        class: "auth-submit",
                        text: NP.t("auth.unlock")
                    })
                ])
            ])
        ]);

        document.body.appendChild(overlay);
        overlay.querySelector("#auth-form").addEventListener("submit", onSubmit);
        return overlay;
    }

    function showError(msg) {
        if (!overlay) return;
        var box = overlay.querySelector("#auth-error");
        box.textContent = msg || "";
        box.style.display = msg ? "block" : "none";
    }

    function setBusy(busy) {
        if (!overlay) return;
        var btn = overlay.querySelector("#auth-submit");
        btn.disabled = !!busy;
        btn.classList.toggle("auth-busy", !!busy);
    }

    function onSubmit(e) {
        e.preventDefault();
        var pwInput = overlay.querySelector("#auth-password");
        var password = pwInput.value;
        var remember = overlay.querySelector("#auth-remember").checked;
        if (!password) { showError(NP.t("errors.password_required")); return; }
        showError("");
        setBusy(true);

        var attempt = mode === "applock"
            ? NP.api.appLockUnlock(password)
            : NP.api.login(password, remember);
        attempt.then(function () {
            pwInput.value = "";
            setBusy(false);
            hide();
            return NP.api.session().then(function (res) {
                session = res || session;
                return proceed();
            });
        }).catch(function (err) {
            setBusy(false);
            showError((err && err.message) || NP.t("auth.failed"));
        });
    }

    function show(which) {
        mode = which;
        buildOverlay();
        overlay.querySelector("#auth-subtitle").textContent =
            NP.t(mode === "applock" ? "auth.appLocked" : "auth.serverProtected");
        overlay.querySelector("#auth-remember-row").style.display =
            mode === "applock" ? "none" : "";
        overlay.querySelector("#auth-password").value = "";
        overlay.classList.add("auth-visible");
        document.body.classList.add("auth-active");
        showError("");
        setTimeout(function () {
            var pw = overlay.querySelector("#auth-password");
            if (pw) pw.focus();
        }, 50);
    }

    function hide() {
        if (!overlay) return;
        overlay.classList.remove("auth-visible");
        document.body.classList.remove("auth-active");
    }

    function bootApp() {
        if (NP.app && NP.app.init) {
            return NP.app.init();
        }
        return Promise.resolve();
    }

    /* Ask for whichever password is still missing, else start the app. */
    function proceed() {
        var lock = session.app_lock || {};
        if (NP.appLock) NP.appLock.enabled = !!lock.enabled;
        if (session.password_required && !session.authenticated) {
            show("server");
            return;
        }
        if (lock.enabled && !lock.unlocked) {
            show("applock");
            return;
        }
        return bootApp().then(showDataNotice);
    }

    /* Notices shown as a toast (information), the others as a dialog. */
    var TOAST_NOTICES = ["github_imported", "github_import_blocked"];

    /* The backend recovered from a corrupt notes file (or found none),
       or the Store edition imported the GitHub edition's notes. */
    function showDataNotice() {
        if (!session || !session.data_notice) return;
        var notice = session.data_notice;
        session.data_notice = null;
        setTimeout(function () {
            var text = NP.t("notice." + notice.code, notice.params);
            /* Store edition import (N1.9): information only, not a dialog. */
            if (TOAST_NOTICES.indexOf(notice.code) !== -1 && NP.toast) NP.toast(text, { timeout: 30000 });
            else NP.dialog.alert(text);
            NP.api.dismissNotice().catch(function () { /* shown anyway */ });
        }, 300);
    }

    function showStartError(err) {
        var sub = document.getElementById("splash-subtitle");
        if (sub) sub.textContent = NP.t("auth.startFailed", { error: err && err.message ? err.message : err });
    }

    NP.auth = {
        /* True when the server asks for a password (logout makes sense). */
        passwordRequired: function () {
            return !!(session && session.password_required);
        },
        logout: function () {
            return NP.api.logout().catch(function () {
                /* reload anyway — the server drops the session on restart */
            }).then(function () {
                window.location.reload();
            });
        },
        start: function () {
            /* Desktop: get the image cookie before anything renders. */
            var ready = NP.api.hasToken() ? NP.api.bindSession() : Promise.resolve();
            return ready.then(function () {
                return NP.api.session();
            }).then(function (res) {
                session = res || {};
                /* Language first: the gate itself must be translated. */
                NP.i18n.setDefault(session.install_language);
                return NP.i18n.init(session.language).then(proceed);
            }).catch(function (err) {
                return NP.i18n.init("auto").then(function () { showStartError(err); });
            });
        }
    };

})(window.NP);
