/* dialog.js - NoirPad's own modal dialogs (replace alert/confirm/prompt).

   NP.dialog.alert(message, opts)    → Promise<void>
   NP.dialog.confirm(message, opts)  → Promise<boolean>
   NP.dialog.prompt(message, opts)   → Promise<string|null>   // trimmed; null = cancelled

   opts (all optional):
       title                 heading (default: "NoirPad")
       okLabel, cancelLabel  button texts (default: OK / Cancel, translated)
       danger: true          red OK button, for actions that cannot be undone
       value, placeholder    prompt: initial text / placeholder
       validate(value)       prompt: error text, or null when the value is fine
                             (default: NP.dialog.validateName)
       maxLength             prompt: default 300 (MAX_NAME_LEN in config.py)

   Enter = OK, Escape = Cancel (alert: close). While a dialog is open, keys
   do not reach the app's shortcuts. Texts are set with textContent only.

   NP.toast(message, { actionLabel, action, timeout }) - a short note at the
   bottom of the window (e.g. "Saved" + "Open folder"); it does not take focus. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Any character is fine in a name: export.py safe_filename() fixes up
       the file names when exporting. */
    var MAX_NAME = 300;

    var stack = [];   /* open dialogs, topmost last */
    var opened = 0;   /* for unique element ids */

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    }

    function validateName(value) {
        var v = (value || "").trim();
        if (!v) return NP.t("dialog.errorEmptyName");
        if (v.length > MAX_NAME) return NP.t("dialog.errorTooLong", { n: MAX_NAME });
        return null;
    }

    /* kind: "alert" | "confirm" | "prompt". Resolves with true/false
       (alert, confirm) or the text / null (prompt). */
    function open(kind, message, opts) {
        opts = opts || {};
        return new Promise(function (resolve) {
            var previousFocus = document.activeElement;
            var overlay = el("div", "dialog-overlay visible np-dialog" + (opts.danger ? " np-dialog--danger" : ""));  // i18n-ignore (CSS classes)
            overlay.setAttribute("role", kind === "alert" ? "alertdialog" : "dialog");
            overlay.setAttribute("aria-modal", "true");

            var box = el("form", "dialog-box");
            box.setAttribute("novalidate", "");
            var title = el("div", "dialog-title", opts.title || "NoirPad");  // i18n-ignore (brand)
            title.id = "np-dialog-title-" + (++opened);
            overlay.setAttribute("aria-labelledby", title.id);
            box.appendChild(title);
            if (message) box.appendChild(el("div", "dialog-message np-dialog-message", message));  // i18n-ignore (CSS classes)

            var input = null;
            var error = null;
            if (kind === "prompt") {
                input = el("input", "dialog-input");
                input.type = "text";
                input.id = "np-dialog-input";
                input.value = opts.value || "";
                if (opts.placeholder) input.placeholder = opts.placeholder;
                input.setAttribute("maxlength", String(opts.maxLength || MAX_NAME));
                input.setAttribute("spellcheck", "false");
                input.setAttribute("autocomplete", "off");
                if (message) input.setAttribute("aria-label", message);
                box.appendChild(input);
                error = el("div", "dialog-message np-dialog-error");  // i18n-ignore (CSS classes)
                error.setAttribute("role", "alert");
                box.appendChild(error);
            }

            var buttons = el("div", "dialog-buttons");
            var cancel = null;
            if (kind !== "alert") {
                cancel = el("button", "dialog-btn", opts.cancelLabel || NP.t("common.cancel"));
                cancel.type = "button";
                buttons.appendChild(cancel);
            }
            var ok = el("button", "dialog-btn " + (opts.danger ? "danger" : "primary"),
                        opts.okLabel || NP.t("common.ok"));
            ok.type = "submit";
            buttons.appendChild(ok);
            box.appendChild(buttons);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            var entry = { overlay: overlay };
            stack.push(entry);

            function close(result) {
                var i = stack.indexOf(entry);
                if (i !== -1) stack.splice(i, 1);
                window.removeEventListener("keydown", onKey, true);
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                if (previousFocus && previousFocus.focus && document.contains(previousFocus)) {
                    try { previousFocus.focus(); } catch (e) { /* gone */ }
                }
                resolve(result);
            }

            function submit() {
                if (kind !== "prompt") { close(true); return; }
                var validate = opts.validate || validateName;
                var problem = validate(input.value);
                if (problem) {
                    error.textContent = problem;
                    input.setAttribute("aria-invalid", "true");
                    input.focus();
                    return;
                }
                close(input.value.trim());
            }

            function dismiss() {
                close(kind === "prompt" ? null : kind === "alert");
            }

            /* Window capture: runs before every document-level handler
               (shortcuts, the shortcut recorder, overlay Escape). */
            function onKey(e) {
                if (stack[stack.length - 1] !== entry) return;
                e.stopPropagation();
                if (e.key === "Escape") {
                    e.preventDefault();
                    dismiss();
                } else if (e.key === "Enter" && !e.isComposing) {
                    e.preventDefault();
                    if (document.activeElement === cancel) dismiss();
                    else submit();
                } else if (e.key === "Tab") {
                    /* Keep focus inside the dialog. */
                    var focusable = [input, cancel, ok].filter(Boolean);
                    var at = focusable.indexOf(document.activeElement);
                    var next = e.shiftKey ? at - 1 : at + 1;
                    if (next < 0) next = focusable.length - 1;
                    if (next >= focusable.length || at === -1) next = 0;
                    e.preventDefault();
                    focusable[next].focus();
                }
            }

            box.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
            if (cancel) cancel.addEventListener("click", dismiss);
            if (input) {
                input.addEventListener("input", function () {
                    error.textContent = "";
                    input.removeAttribute("aria-invalid");
                });
            }
            window.addEventListener("keydown", onKey, true);

            if (input) {
                input.focus();
                input.select();
            } else if (opts.danger && cancel) {
                cancel.focus();     /* U14: Enter alone never does the dangerous thing */
            } else {
                ok.focus();
            }
        });
    }

    /* ---- NP.modal: the app's own windows (Settings, Help, Shortcuts, Font
       picker) behave like the dialogs above for the keyboard and screen
       readers (U1): role=dialog + aria-modal + a name, the focus moves in,
       Tab stays inside, and on close the focus goes back where it was. ---- */

    var FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), " +
        "select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
    var modals = [];   /* open windows, topmost last */

    function shown(node, root) {
        for (var n = node; n && n !== root.parentNode; n = n.parentElement) {
            if (n.hidden) return false;
            var cs = window.getComputedStyle(n);
            if (cs.display === "none" || cs.visibility === "hidden") return false;
        }
        return true;
    }

    function focusables(root) {
        return Array.prototype.filter.call(root.querySelectorAll(FOCUSABLE), function (n) {
            return shown(n, root);
        });
    }

    function onModalKey(e) {
        if (e.key !== "Tab" || stack.length) return;    /* an NP.dialog on top handles itself */
        var top = modals[modals.length - 1];
        if (!top) return;
        var list = focusables(top);
        if (!list.length) return;
        /* In an open dropdown list (N11): Tab goes on from its button. */
        var active = document.activeElement;
        var dropdown = active && active.closest && active.closest(".np-dropdown");
        if (dropdown) {
            active = dropdown.querySelector(".np-dropdown-trigger");
            if (NP.dropdown && NP.dropdown.closeAll) NP.dropdown.closeAll();
        }
        var at = list.indexOf(active);
        var next = e.shiftKey ? (at <= 0 ? list.length - 1 : at - 1)
                              : (at === -1 || at === list.length - 1 ? 0 : at + 1);
        e.preventDefault();
        list[next].focus();
    }

    NP.modal = {
        /* opts: label (text) or labelledBy (element id), initialFocus (selector) */
        open: function (overlay, opts) {
            opts = opts || {};
            if (!overlay || modals.indexOf(overlay) !== -1) return;
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            if (opts.labelledBy) overlay.setAttribute("aria-labelledby", opts.labelledBy);
            else if (opts.label) overlay.setAttribute("aria-label", opts.label);
            overlay.setAttribute("aria-hidden", "false");
            overlay._npReturnFocus = document.activeElement;
            modals.push(overlay);
            if (modals.length === 1) document.addEventListener("keydown", onModalKey, true);
            var first = (opts.initialFocus && overlay.querySelector(opts.initialFocus)) ||
                focusables(overlay)[0];
            if (first) {
                try { first.focus(); } catch (e) { /* not focusable */ }
            }
        },

        close: function (overlay) {
            var i = modals.indexOf(overlay);
            if (i === -1) return;
            modals.splice(i, 1);
            if (!modals.length) document.removeEventListener("keydown", onModalKey, true);
            overlay.setAttribute("aria-hidden", "true");
            var back = overlay._npReturnFocus;
            overlay._npReturnFocus = null;
            /* Only when the focus was inside (or nowhere): a click elsewhere wins. */
            var active = document.activeElement;
            if (back && back.focus && document.contains(back) &&
                (!active || active === document.body || overlay.contains(active))) {
                try { back.focus(); } catch (e) { /* gone */ }
            }
        },

        isOpen: function (overlay) { return modals.indexOf(overlay) !== -1; }
    };

    var toastTimer = null;

    function toast(message, opts) {
        opts = opts || {};
        var old = document.querySelector(".np-toast");
        if (old && old.parentNode) old.parentNode.removeChild(old);
        clearTimeout(toastTimer);

        var box = el("div", "np-toast");
        box.setAttribute("role", "status");
        box.appendChild(el("span", "np-toast-text", message));
        function close() {
            clearTimeout(toastTimer);
            if (box.parentNode) box.parentNode.removeChild(box);
        }
        if (opts.action && opts.actionLabel) {
            var action = el("button", "np-toast-action", opts.actionLabel);
            action.type = "button";
            action.addEventListener("click", function () { close(); opts.action(); });
            box.appendChild(action);
        }
        var x = el("button", "np-toast-close", "\u00d7");
        x.type = "button";
        x.setAttribute("aria-label", NP.t("common.close"));
        x.addEventListener("click", close);
        box.appendChild(x);
        document.body.appendChild(box);
        toastTimer = setTimeout(close, opts.timeout || 8000);
        return { close: close };
    }

    NP.toast = toast;

    NP.dialog = {
        alert: function (message, opts) {
            return open("alert", message, opts).then(function () { /* void */ });
        },
        confirm: function (message, opts) {
            return open("confirm", message, opts);
        },
        prompt: function (message, opts) {
            return open("prompt", message, opts);
        },
        validateName: validateName,
        /* .catch(NP.dialog.failed) for API calls behind a button. */
        failed: function (err) {
            return open("alert", err && err.message ? err.message : String(err));
        },
        isOpen: function () { return stack.length > 0; }
    };

})(window.NP);
