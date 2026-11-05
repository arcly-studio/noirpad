/* encryption.js - NoirPad note encryption

   The password is typed into NP.passwordDialog (type=password) and sent to
   the server exactly once, to lock or unlock. The server keeps the derived
   key in memory and answers with an unlock token for that note; the editor
   keeps only the token (NP.editor._unlockToken) and autosaves with it.
   Locking, auto-lock and leaving the page make the server forget the key. */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    var MIN_PASSWORD = 4;   // same rule as the backend (MIN_NOTE_PASSWORD)
    var GOOD_PASSWORD = 8;  // shorter ones are allowed, with a hint

    var reunlockPending = null;
    var unlockPending = {};   // noteId -> promise of the open unlock dialog

    function editor() { return NP.editor; }

    /* The stored images a note's text refers to (N1.4), as {name: true}:
       <<IMG:name> in the rich editor, /images/name in Markdown or as a link. */
    function imageNames(text) {
        var re = /(?:<<IMG:|\/images\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpe?g|gif|webp))/gi;
        var names = {};
        var m;
        while ((m = re.exec(String(text || "")))) names[m[1].toLowerCase()] = true;
        return names;
    }

    function openNoteText() {
        var ed = editor();
        if (!ed) return "";
        var md = NP.markdown && NP.markdown.isActive && NP.markdown.isActive();
        return md ? NP.markdown.getRawText() : (ed.el ? ed._htmlToTextWithImages().text : "");
    }

    function noteHasImages() {
        return Object.keys(imageNames(openNoteText())).length > 0;
    }

    var knownImages = {};     // locked note id -> images it had when it was opened
    var imagesNoticed = {};   // locked note id -> this session already showed the notice

    NP.encryption = {
        /* STATE A → B: lock a plain note. It stays open (unlocked). */
        encrypt: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                NP.dialog.alert(NP.t("encryption.noNoteSelected"));
                return Promise.resolve();
            }
            if (NP.encryption.isEncrypted(noteId) || (editor() && editor()._currentNoteEncrypted)) {
                NP.dialog.alert(NP.t("encryption.alreadyEncrypted"));
                return Promise.resolve();
            }

            return NP.passwordDialog.ask({
                title: NP.t("encryption.lockTitle"),
                message: NP.t("encryption.lockMessage", { n: MIN_PASSWORD }),
                warning: NP.t("encryption.lockWarning") +
                    (noteHasImages() ? "\n" + NP.t("encryption.imagesNotEncrypted") : ""),
                confirm: true,
                minLength: MIN_PASSWORD,
                weakBelow: GOOD_PASSWORD,
                weakHint: NP.t("encryption.shortPasswordHint", { n: GOOD_PASSWORD }),
                okLabel: NP.t("encryption.lock")
            }).then(function (password) {
                if (!password) return;
                var ed = editor();
                /* Save pending edits as plain text first, so what gets
                   encrypted is what the user sees. */
                var flush = ed && ed.save ? ed.save(true) : Promise.resolve();
                return flush.then(function () {
                    return NP.api.encrypt(noteId, password);
                }).then(function (res) {
                    if (ed && ed._currentNoteId === noteId) {
                        ed._currentNoteEncrypted = true;
                        ed._unlockToken = res && res.unlock_token;
                        NP.encryption.noteOpened(noteId, openNoteText());
                    }
                    return NP.state.init();
                }).then(function () {
                    NP.encryption.updateLockButtonState();
                });
            }).catch(function (err) {
                NP.dialog.alert(NP.t("encryption.encryptFailed", { error: err && err.message ? err.message : err }));
            });
        },

        /* An image just went into a locked note: its file stays unencrypted. */
        noteImageAdded: function () {
            var ed = editor();
            if (ed && ed._currentNoteEncrypted && NP.toast) {
                imagesNoticed[ed._currentNoteId] = true;
                NP.toast(NP.t("encryption.imagesNotEncrypted"), { timeout: 12000 });
            }
        },

        /* A locked note was just opened or locked: what it refers to is known. */
        noteOpened: function (noteId, text) {
            knownImages[noteId] = imageNames(text);
        },

        /* A locked note was saved. A link to a stored image typed by hand
           (Markdown) gets the same notice, once per note and session. */
        noteSaved: function (noteId, text) {
            var known = knownImages[noteId];
            if (!known || imagesNoticed[noteId] || !NP.toast) return;
            var isNew = Object.keys(imageNames(text)).some(function (name) { return !known[name]; });
            if (!isNew) return;
            imagesNoticed[noteId] = true;
            NP.toast(NP.t("encryption.imagesNotEncrypted"), { timeout: 12000 });
        },

        /* ":decrypt" command — remove encryption for good. */
        decrypt: function () {
            var noteId = NP.state && NP.state.currentNoteId;
            if (!noteId) {
                NP.dialog.alert(NP.t("encryption.noNoteSelected"));
                return Promise.resolve();
            }
            var ed = editor();
            if (ed && ed._currentNoteId === noteId && ed._unlockToken) {
                return NP.encryption.removeEncryption();
            }
            if (!NP.encryption.isEncrypted(noteId)) {
                NP.dialog.alert(NP.t("encryption.notEncrypted"));
                return Promise.resolve();
            }
            return NP.passwordDialog.ask({
                title: NP.t("encryption.removeTitle"),
                message: NP.t("encryption.removeMessage"),
                okLabel: NP.t("encryption.removeOk")
            }).then(function (password) {
                if (!password) return;
                return NP.api.decrypt(noteId, { password: password }).then(function () {
                    if (ed && ed.loadNote) return ed.loadNote(noteId);
                });
            }).catch(function (err) {
                NP.dialog.alert(NP.t("encryption.decryptFailed", { error: err && err.message ? err.message : err }));
            });
        },

        /* Ask for the password of an encrypted note and unlock it on the
           server. Resolves to the unlock response ({content, formats,
           mode, unlock_token}) or null when cancelled. Wrong passwords
           are reported inside the loop. */
        askAndUnlock: function (noteId, message) {
            /* One dialog per note, even if the note is opened twice. */
            if (unlockPending[noteId]) return unlockPending[noteId];
            var p = NP.encryption._askAndUnlock(noteId, message);
            unlockPending[noteId] = p;
            return p.finally(function () { delete unlockPending[noteId]; });
        },

        _askAndUnlock: function (noteId, message) {
            return NP.passwordDialog.ask({
                title: NP.t("encryption.unlockTitle"),
                message: message || NP.t("encryption.unlockMessage"),
                okLabel: NP.t("encryption.unlock")
            }).then(function (password) {
                if (!password) return null;
                return NP.api.unlock(noteId, password).catch(function (err) {
                    if (err && err.status === 400) {
                        return NP.encryption._askAndUnlock(noteId, NP.t("encryption.wrongPassword"));
                    }
                    throw err;
                });
            });
        },

        /* Autosave got 401 (key expired on the server, e.g. after 12 h or
           a server restart). Ask once, even if several saves fail at the
           same time; resolves to the new token or null. */
        reunlock: function (noteId) {
            if (reunlockPending) return reunlockPending;
            reunlockPending = NP.encryption.askAndUnlock(noteId,
                NP.t("encryption.reunlockMessage")
            ).then(function (res) {
                var ed = editor();
                var token = res && res.unlock_token;
                if (token && ed && ed._currentNoteId === noteId) ed._unlockToken = token;
                return token || null;
            }).finally(function () {
                reunlockPending = null;
            });
            return reunlockPending;
        },

        /* ----------------------------------------------------------------
           State-aware Lock button
           ----------------------------------------------------------------
             A  plain note                -> encrypt (password dialog)
             B  encrypted + UNLOCKED      -> remove encryption (confirm)
             C  encrypted + LOCKED        -> unlock to view (password dialog)

           "unlocked" == the editor holds an unlock token
           (NP.editor._unlockToken) and the plaintext is shown.
           ---------------------------------------------------------------- */

        handleLockButtonClick: function () {
            var ed = editor();
            var id = ed && ed._currentNoteId;
            if (!id) {
                NP.dialog.alert(NP.t("encryption.noNoteSelected"));
                return;
            }

            if (!ed._currentNoteEncrypted) {
                NP.encryption.encrypt();
            } else if (ed._unlockToken) {
                NP.encryption.removeEncryption();
            } else {
                NP.encryption.unlock();
            }
        },

        /* STATE C → B: loadNote asks for the password and shows the note
           (the file stays encrypted). */
        unlock: function () {
            var id = editor() && editor()._currentNoteId;
            if (!id) return Promise.resolve();
            if (editor().loadNote) return editor().loadNote(id);
            return Promise.resolve();
        },

        /* STATE B → A: permanently strip encryption using the unlock
           token (no second password prompt). Confirm first. */
        removeEncryption: function () {
            var ed = editor();
            var id = ed && ed._currentNoteId;
            if (!id) return Promise.resolve();
            if (!ed._unlockToken) {
                NP.dialog.alert(NP.t("encryption.unlockFirst"));
                return Promise.resolve();
            }

            return NP.dialog.confirm(NP.t("encryption.removeConfirm"), {
                title: NP.t("encryption.removeTitle"),
                okLabel: NP.t("encryption.removeOk"),
                danger: true
            }).then(function (ok) {
                if (!ok) return;

                /* Stop autosave up front: an encrypted autosave firing during
                   the decrypt request would immediately re-encrypt the note. */
                if (ed.stopAutosave) ed.stopAutosave();

                /* Flush the latest edits (encrypted), then decrypt for good. */
                var flush = ed.save ? ed.save(true) : Promise.resolve();
                return flush.then(function () {
                    return NP.api.decrypt(id, { unlock_token: ed._unlockToken });
                }).then(function () {
                    ed._unlockToken = null;
                    ed._currentNoteEncrypted = false;
                    if (ed.loadNote) return ed.loadNote(id);
                }).catch(function (err) {
                    if (ed.startAutosave) ed.startAutosave();
                    NP.dialog.alert(NP.t("encryption.removeFailed", { error: err && err.message ? err.message : err }));
                });
            });
        },

        /* Sync the #btn-lock icon/label with the open note's state
           (topbar.js: lock / unlock / remove the lock). */
        updateLockButtonState: function () {
            if (NP.topbar && NP.topbar.refresh) NP.topbar.refresh();
        },

        /* Auto-lock: hide the unlocked note and make the server forget
           every key. Returns true if a note was actually locked. */
        lockAll: function () {
            var ed = editor();
            var open = !!(ed && ed._currentNoteId && ed._unlockToken);
            /* save() reads the editor and the token synchronously, so the
               flush still works after both are cleared below. Autosave may
               be switched off in Settings. */
            var flush = open && ed.save ? ed.save(true) : Promise.resolve();
            flush.then(function () {
                return NP.api.lockAll();
            }).catch(function () { /* server restart forgets keys anyway */ });
            if (!open) return false;

            if (ed.stopAutosave) ed.stopAutosave();
            ed._unlockToken = null;
            if (ed._showLockScreen) ed._showLockScreen();
            NP.encryption.updateLockButtonState();
            return true;
        },

        isEncrypted: function (noteId) {
            if (!NP.state || !NP.state.data || !NP.state.data.notes) return false;
            var content = NP.state.data.notes[noteId];
            if (!content || typeof content !== "string") return false;

            return NP.isEncryptedEnvelope(content);
        }
    };

})(window.NP);
