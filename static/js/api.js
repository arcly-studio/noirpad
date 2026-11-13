/* api.js - NoirPad API client */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* Desktop app: desktop.py opens the window at /#token=<random>. Keep
       the token for this window (sessionStorage survives a reload) and
       drop it from the address bar. Web/server mode has no token. */
    var TOKEN_KEY = "noirpad_token";
    var token = null;
    try {
        var m = /[#&]token=([^&]+)/.exec(window.location.hash || "");
        if (m) {
            token = decodeURIComponent(m[1]);
            sessionStorage.setItem(TOKEN_KEY, token);
            history.replaceState(null, "", window.location.pathname + window.location.search);
        } else {
            token = sessionStorage.getItem(TOKEN_KEY);
        }
    } catch (e) { /* storage unavailable — web mode needs no token */ }

    /* Headers every /api/ call carries: the CSRF marker (server mode)
       and the per-launch token (desktop). */
    function apiHeaders(extra) {
        var h = { "X-NoirPad-Request": "1" };
        if (token) h["X-NoirPad-Token"] = token;
        if (extra) {
            Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
        }
        return h;
    }

    /* fetch() with the API headers added. */
    function apiFetch(url, opts) {
        opts = opts || {};
        opts.headers = apiHeaders(opts.headers);
        opts.credentials = "same-origin";
        return fetch(url, opts);
    }

    var reloadingForLock = false;

    /* The API answers errors with {"detail": {"code", "params"}} (see
       noirpad/errors.py); the text comes from the locale files. */
    function errorFrom(res) {
        return res.text().then(function (txt) {
            var code = null;
            var params = null;
            try {
                var detail = JSON.parse(txt).detail;
                if (detail && typeof detail.code === "string") {
                    code = detail.code;
                    params = detail.params || null;
                } else if (Array.isArray(detail)) {
                    code = "invalid_input";     /* FastAPI validation errors */
                }
            } catch (e) { /* not JSON (proxy error page, …) */ }
            var msg = code ? NP.t("errors." + code, params)
                : NP.t("errors.generic", { status: res.status });
            var e = new Error(msg);
            e.status = res.status;
            e.code = code;
            /* 423 = app lock engaged (another window locked it, or the
               password changed): reload into the lock screen. */
            if (res.status === 423 && !reloadingForLock) {
                reloadingForLock = true;
                lockedElsewhere();
            }
            // 401 = server password session missing/expired.
            e.unauthorized = res.status === 401;
            throw e;
        });
    }

    /* R11: the reload would throw away what this window has not saved yet
       (every save is refused while locked). Then the page hides its content
       and asks for the password here: unlocked, the text is saved and work
       goes on; cancelled, it reloads into the lock screen as before. */
    function lockedElsewhere() {
        var ed = NP.editor;
        var unsaved = !!(ed && ed._saveState && ed._currentNoteId);
        if (!unsaved || !NP.passwordDialog) {
            window.location.reload();
            return;
        }
        document.body.classList.add("np-locked-elsewhere");
        /* A typo, a rate limit or a network hiccup asks again (with why);
           the text is only dropped after an explicit "discard". */
        function attempt(problem) {
            return NP.passwordDialog.ask({
                title: NP.t("appLock.lockedElsewhereTitle"),
                message: NP.t("appLock.lockedElsewhere"),
                warning: problem || undefined,
                okLabel: NP.t("appLock.unlockKeep")
            }).then(function (password) {
                if (!password) {
                    return NP.dialog.confirm(NP.t("appLock.discardUnsaved"), {
                        title: NP.t("appLock.lockedElsewhereTitle"),
                        okLabel: NP.t("editor.discardChanges"),
                        cancelLabel: NP.t("appLock.tryAgain"),
                        danger: true
                    }).then(function (discard) {
                        if (discard) window.location.reload();
                        else return attempt();
                    });
                }
                return NP.api.appLockUnlock(password).then(function () {
                    document.body.classList.remove("np-locked-elsewhere");
                    reloadingForLock = false;
                    return ed.save(true);
                }, function (err) {
                    return attempt(err && err.message ? err.message : String(err));
                });
            });
        }
        attempt();
    }

    function request(method, url, body) {
        var opts = { method: method, headers: {} };
        if (body instanceof FormData) {
            opts.body = body;
        } else if (body !== undefined) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        return apiFetch(url, opts).then(function (res) {
            if (!res.ok) return errorFrom(res);
            var ct = res.headers.get("content-type") || "";
            if (ct.indexOf("application/json") !== -1) {
                return res.json();
            }
            return res.text();
        });
    }

    /* "attachment; filename=\"x.txt\"; filename*=UTF-8''%C5%99.txt" → name */
    function filenameFrom(disposition) {
        var star = /filename\*=UTF-8''([^;]+)/i.exec(disposition || "");
        if (star) {
            try { return decodeURIComponent(star[1]); } catch (e) { /* fall through */ }
        }
        var plain = /filename="([^"]*)"/i.exec(disposition || "");
        return plain ? plain[1] : "";
    }

    /* Desktop app: the backend shows a native "Save as" dialog, writes the
       file and answers {saved, name, token} (desktop_save.py), so WebView2's
       Downloads panel never opens. Then a toast with "Open folder". */
    function savedNatively(res) {
        return res.json().then(function (info) {
            if (!info || !info.saved) return undefined;      /* cancelled */
            NP.toast(NP.t("api.saved", { name: info.name }), {
                actionLabel: NP.t("api.openFolder"),
                action: function () {
                    request("POST", "/api/desktop/reveal", { token: info.token }).catch(function (err) {
                        NP.dialog.alert(err && err.message ? err.message : String(err));
                    });
                }
            });
            return res.headers;
        });
    }

    /* Downloads go through fetch (so they carry the API headers) and a
       blob: link with `download` (allowed by links.js); in the desktop app
       through savedNatively. Resolves with the response headers, or
       undefined after Cancel or an error (which it shows). */
    function download(url) {
        var opts = token ? { headers: { "X-NoirPad-Save-As": "1" } } : {};
        return apiFetch(url, opts).then(function (res) {
            if (!res.ok) return errorFrom(res);
            if (token && (res.headers.get("content-type") || "").indexOf("application/json") !== -1) {
                return savedNatively(res);
            }
            var name = filenameFrom(res.headers.get("content-disposition"));
            return res.blob().then(function (blob) {
                var href = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = href;
                a.download = name || "download";
                a.style.display = "none";
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(href); }, 10000);
                return res.headers;
            });
        }).catch(function (err) {
            NP.dialog.alert(NP.t("api.downloadFailed", { error: err && err.message ? err.message : err }));
        });
    }

    NP.api = {
        fetch: apiFetch,
        download: download,
        hasToken: function () { return !!token; },

        getData: function () {
            return request("GET", "/api/data");
        },

        /* → {data, etag}, or null when the data still matches `etag`. */
        getDataIfChanged: function (etag) {
            var headers = etag ? { "If-None-Match": etag } : {};
            return apiFetch("/api/data", { headers: headers }).then(function (res) {
                if (res.status === 304) return null;
                if (!res.ok) return errorFrom(res);
                return res.json().then(function (data) {
                    return { data: data, etag: res.headers.get("etag") };
                });
            });
        },

        /* → {version, url, author, copyright, contact} from noirpad/__version__.py */
        version: function () {
            return request("GET", "/api/version");
        },

        /* → {license, notices}: LICENSE and THIRD-PARTY-NOTICES.txt (About → Licenses) */
        licenses: function () {
            return request("GET", "/api/licenses");
        },

        getNote: function (id) {
            return request("GET", "/api/note/" + encodeURIComponent(id));
        },

        saveNote: function (id, content, formats, opts) {
            var body = { content: content, formats: formats };
            if (opts && opts.mode !== undefined) body.mode = opts.mode;
            /* R6: the version this text was written on (409 if changed elsewhere). */
            if (opts && opts.baseRev) body.base_rev = opts.baseRev;
            return apiFetch("/api/note/" + encodeURIComponent(id), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body)
            }).then(function (res) {
                if (!res.ok) return errorFrom(res);
                /* R9: our copy of the data was exactly one write behind —
                   this save: take it over (text + ETag), so the next poll
                   is a 304 instead of the whole profile again. */
                var st = NP.state;
                var after = res.headers.get("ETag");
                if (st && st.data && st.etag && after &&
                    res.headers.get("X-NoirPad-ETag-Before") === st.etag) {
                    st.data.notes = st.data.notes || {};
                    st.data.notes[id] = content;
                    if (body.mode !== undefined) {
                        st.data.note_modes = st.data.note_modes || {};
                        if (body.mode === "markdown") st.data.note_modes[id] = "markdown";
                        else delete st.data.note_modes[id];
                    }
                    st.etag = after;
                }
                return res.json();
            });
        },

        newNote: function (parentId, name) {
            return request("POST", "/api/tree/new-note", {
                parent_id: parentId,
                name: name
            });
        },

        newFolder: function (parentId, name) {
            return request("POST", "/api/tree/new-folder", {
                parent_id: parentId,
                name: name
            });
        },

        rename: function (id, name) {
            return request("POST", "/api/tree/rename", {
                id: id,
                name: name
            });
        },

        move: function (id, targetId, position) {
            return request("POST", "/api/tree/move", {
                id: id,
                target_id: targetId,
                position: position
            });
        },

        deleteItem: function (id) {
            return request("POST", "/api/tree/delete", {
                id: id
            });
        },

        toggleFavorite: function (id) {
            return request("POST", "/api/favorites/toggle", {
                id: id
            });
        },

        getTags: function () {
            return request("GET", "/api/tags");
        },

        setTags: function (id, tags) {
            return request("PUT", "/api/tags/" + encodeURIComponent(id), {
                tags: tags
            });
        },

        getTrash: function () {
            return request("GET", "/api/trash");
        },

        restoreFromTrash: function (id) {
            return request("POST", "/api/trash/restore", {
                id: id
            });
        },

        emptyTrash: function () {
            return request("POST", "/api/trash/empty");
        },

        deleteTrashItem: function (id) {
            return request("POST", "/api/trash/delete", { id: id });
        },

        saveSettings: function (settings) {
            return request("PUT", "/api/settings", settings);
        },

        /* ---- Encrypted notes ----
           The password goes to the server only in encrypt() and unlock();
           both return an unlock_token that every later call uses. */
        encrypt: function (id, password) {
            return request("POST", "/api/encrypt", {
                id: id,
                password: password
            });
        },

        unlock: function (id, password) {
            return request("POST", "/api/unlock", {
                id: id,
                password: password
            });
        },

        /* auth: { unlock_token } or { password } */
        decrypt: function (id, auth) {
            return request("POST", "/api/decrypt", {
                id: id,
                unlock_token: auth.unlock_token || null,
                password: auth.password || null
            });
        },

        saveEncrypted: function (id, unlockToken, content, formats, opts) {
            var body = {
                id: id,
                unlock_token: unlockToken,
                content: content,
                formats: formats || []
            };
            if (opts && opts.mode !== undefined) body.mode = opts.mode;
            return request("POST", "/api/save-encrypted", body);
        },

        lock: function (unlockToken) {
            return request("POST", "/api/lock", { unlock_token: unlockToken });
        },

        lockAll: function () {
            return request("POST", "/api/lock-all");
        },

        uploadImage: function (file) {
            var fd = new FormData();
            fd.append("file", file);
            return request("POST", "/api/images/upload", fd);
        },

        exportTxt: function (id) {
            download("/api/export/" + encodeURIComponent(id) + "/txt");
        },

        exportHtml: function (id) {
            download("/api/export/" + encodeURIComponent(id) + "/html");
        },

        exportMd: function (id) {
            download("/api/export/" + encodeURIComponent(id) + "/md");
        },

        downloadBackup: function () {
            download("/api/backup");
        },

        importBackup: function (file) {
            var fd = new FormData();
            fd.append("file", file);
            return request("POST", "/api/backup/import", fd);
        },

        /* Store edition (N1.11): Settings → Data → add the installer edition's notes. */
        installerNotesStatus: function () {
            return request("GET", "/api/store/installer-notes");
        },

        addInstallerNotes: function (folder) {
            return request("POST", "/api/store/installer-notes", { folder: folder });
        },

        /* ---- Session (password-protected server mode) ---- */
        session: function () {
            return request("GET", "/api/session");
        },

        login: function (password, remember) {
            return request("POST", "/api/login", {
                password: password,
                remember: !!remember
            });
        },

        logout: function () {
            return request("POST", "/api/logout");
        },

        dismissNotice: function () {
            return request("POST", "/api/session/dismiss-notice");
        },

        /* Desktop: lets <img src="/images/…"> through (cookie). */
        bindSession: function () {
            return request("POST", "/api/session/bind");
        },

        /* .md files or zips of them → {notes, folders, images, skipped} */
        importMarkdown: function (files) {
            var form = new FormData();
            Array.prototype.forEach.call(files, function (f) { form.append("files", f); });
            return request("POST", "/api/notes/import-md", form);
        },

        appLockUnlock: function (password) {
            return request("POST", "/api/app-lock/unlock", { password: password });
        },

        appLockLock: function () {
            return request("POST", "/api/app-lock/lock");
        },

        appLockEnable: function (password, currentPassword) {
            return request("POST", "/api/app-lock/enable",
                { password: password, current_password: currentPassword || null });
        },

        appLockDisable: function (password) {
            return request("POST", "/api/app-lock/disable", { password: password });
        }
    };

})(window.NP);
