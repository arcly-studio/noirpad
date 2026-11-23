/* links.js - the app window never navigates away.

   Every activation of an <a href> anywhere in the document (click, Ctrl/
   Shift/Meta-click, middle-click, Enter) is intercepted in the capture
   phase and default-prevented:
     - http(s):/mailto: → window.open(…, "noopener,noreferrer"). In the
       desktop app pywebview hands new windows to the system browser.
     - /images/<name>   → in-app image viewer.
     - anything else    → nothing happens.
   Exception: download anchors created by the app itself (blob: or /api/
   with a `download` attribute). A plain click on a link inside the
   editable note only places the caret; Ctrl+click opens it.

   Opening a link of a note (rich text or Markdown preview) is confirmed: the
   link lights up briefly and a toast names the address. An address that is
   not valid or not allowed gets an error toast and opens nothing.

   Dropping a file or link onto the window would also navigate it, so
   unhandled drops are cancelled too. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    function isAppDownload(a) {
        if (!a.hasAttribute("download")) return false;
        var href = a.getAttribute("href") || "";
        return href.indexOf("blob:") === 0 || href.indexOf("/api/") === 0;
    }

    var FLASH_FALLBACK_MS = 400;
    var OPENING_MS = 2000, BLOCKED_MS = 4000;

    /* In the open note; the start page (also in #editor) is not a note. */
    function inNote(a) {
        return !!a.closest("#editor, #md-preview") && !a.closest(".welcome-wrap");
    }

    /* A class for ~300 ms (noirpad.css, box-shadow only); it is never saved
       and leaves nothing on the link. */
    function flash(a) {
        if (NP.motionOff()) return;
        clearTimeout(a._npFlashTimer);
        if (a.classList.contains("np-link-flash")) {
            a.classList.remove("np-link-flash");
            void a.offsetWidth;      /* opened again at once: start over */
        }
        a.classList.add("np-link-flash");
        a._npFlashTimer = setTimeout(function () {
            a.classList.remove("np-link-flash");
            if (!a.className) a.removeAttribute("class");
        }, FLASH_FALLBACK_MS);
    }

    function say(key, href, timeout) {
        if (NP.toast) NP.toast(NP.t(key), { detail: NP.shortUrl(href), timeout: timeout });
    }

    /* Open a note's link outside the app window, with feedback.
       -> true when it was opened. */
    function open(a) {
        var href = (a.getAttribute("href") || "").trim();
        if (!NP.canOpenLink(href)) {
            say("format.link.blocked", href, BLOCKED_MS);
            return false;
        }
        window.open(href, "_blank", "noopener,noreferrer");
        flash(a);
        if (/^mailto:/i.test(href)) say("format.link.openingMail", href, OPENING_MS);
        else say("format.link.opening", href, OPENING_MS);
        return true;
    }

    function onActivate(e) {
        if (e.type === "auxclick" && e.button !== 1) return;
        var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
        if (!a || isAppDownload(a)) return;

        e.preventDefault();
        /* In the editable note a click places the caret; Ctrl+click opens. */
        if (a.isContentEditable && e.type === "click" && !(e.ctrlKey || e.metaKey)) return;
        var href = a.getAttribute("href");
        var kind = NP.linkKind(href);
        if (kind === "image") {
            if (NP.images && NP.images._openViewer) NP.images._openViewer(href);
        } else if (inNote(a)) {
            open(a);
        } else if (kind === "external") {
            window.open(href.trim(), "_blank", "noopener,noreferrer");
        }
    }

    /* Text dragged within an editable field keeps its native behaviour;
       files, or anything dropped elsewhere, would navigate the window. */
    function wouldNavigate(e) {
        var dt = e.dataTransfer;
        var hasFiles = !!(dt && dt.types && Array.prototype.indexOf.call(dt.types, "Files") !== -1);
        var t = e.target;
        var editable = !!(t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA"));
        return hasFiles || !editable;
    }

    function onDragOver(e) {
        if (wouldNavigate(e)) e.preventDefault();
    }

    function onDrop(e) {
        /* Handlers that accept a drop call preventDefault themselves. */
        if (!e.defaultPrevented && wouldNavigate(e)) e.preventDefault();
    }

    document.addEventListener("click", onActivate, true);
    document.addEventListener("auxclick", onActivate, true);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);

    NP.links = { open: open, _onActivate: onActivate };

})(window.NP);
