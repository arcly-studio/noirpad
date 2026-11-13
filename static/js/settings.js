/* settings.js - Settings panel + reusable .np-dropdown component */
window.NP = window.NP || {};

(function (NP) {
    "use strict";

    /* =====================================================================
     * Reusable dropdown component
     * ---------------------------------------------------------------------
     * Generic: NO theme/font logic lives here. It only handles
     * open/close/select and dispatches a `np-dropdown-change` CustomEvent
     * ({ value, dropdown }) on the .np-dropdown root. Feature-specific
     * behaviour (theme switch, font switch, …) lives below and just listens
     * for that event. Works for any .np-dropdown anywhere in the DOM.
     * ===================================================================== */

    var _globalDropdownHandlersBound = false;

    function setOpen(dropdown, open) {
        dropdown.classList.toggle("open", open);
        var trigger = dropdown.querySelector(".np-dropdown-trigger");
        if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function closeAllDropdowns(except) {
        var open = document.querySelectorAll(".np-dropdown.open");
        for (var i = 0; i < open.length; i++) {
            if (open[i] === except) continue;
            /* The keyboard was inside: it goes back to the button, not to nowhere. */
            var inside = document.activeElement && document.activeElement.closest &&
                document.activeElement.closest(".np-dropdown-menu");
            setOpen(open[i], false);
            if (inside && open[i].contains(inside)) {
                open[i].querySelector(".np-dropdown-trigger").focus();
            }
        }
    }

    /* N11: a listbox for the keyboard and screen readers. Named by the
       settings row it stands in. */
    function describeDropdown(dropdown) {
        var trigger = dropdown.querySelector(".np-dropdown-trigger");
        var menu = dropdown.querySelector(".np-dropdown-menu");
        if (!trigger || !menu) return;
        var settingsRow = dropdown.closest(".settings-row");
        var row = settingsRow && settingsRow.querySelector(".settings-label");
        var value = dropdown.querySelector(".np-dropdown-label");
        var names = [];
        if (row && dropdown.id) {
            row.id = row.id || dropdown.id + "-name";
            names.push(row.id);
            menu.setAttribute("aria-labelledby", row.id);
        }
        if (value && dropdown.id) {
            value.id = value.id || dropdown.id + "-value";
            names.push(value.id);
        }
        if (names.length) trigger.setAttribute("aria-labelledby", names.join(" "));
        trigger.setAttribute("aria-haspopup", "listbox");
        trigger.setAttribute("aria-expanded", "false");
        menu.setAttribute("role", "listbox");
        var decor = dropdown.querySelectorAll(".np-dropdown-arrow, .np-dropdown-marker");
        for (var i = 0; i < decor.length; i++) decor[i].setAttribute("aria-hidden", "true");
        var options = dropdown.querySelectorAll(".np-dropdown-option");
        for (var o = 0; o < options.length; o++) {
            options[o].setAttribute("role", "option");
            options[o].setAttribute("tabindex", "-1");
        }
    }

    function optionsOf(dropdown) {
        return Array.prototype.slice.call(dropdown.querySelectorAll(".np-dropdown-option"));
    }

    function focusOption(option) {
        if (!option) return;
        option.focus();
        if (option.scrollIntoView) option.scrollIntoView({ block: "nearest" });
    }

    function openWithKeyboard(dropdown) {
        closeAllDropdowns(dropdown);
        setOpen(dropdown, true);
        focusOption(dropdown.querySelector(".np-dropdown-option-selected") || optionsOf(dropdown)[0]);
    }

    function onTriggerKey(dropdown, e) {
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        e.stopPropagation();
        openWithKeyboard(dropdown);
    }

    function onOptionKey(dropdown, e) {
        var options = optionsOf(dropdown);
        var at = options.indexOf(document.activeElement);
        if (at === -1) return;
        var next = null;
        if (e.key === "ArrowDown") next = options[Math.min(at + 1, options.length - 1)];
        else if (e.key === "ArrowUp") next = options[Math.max(at - 1, 0)];
        else if (e.key === "Home") next = options[0];
        else if (e.key === "End") next = options[options.length - 1];
        else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(dropdown, false);
            dropdown.querySelector(".np-dropdown-trigger").focus();
            selectOption(dropdown, options[at].getAttribute("data-value"), true);
            return;
        } else if (e.key === "Tab") {
            closeAllDropdowns(null);
            return;
        } else {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        focusOption(next);
    }

    /* Reflect dropdown[data-value] into the trigger label + selected option.
       Does NOT fire any event. */
    function syncDropdown(dropdown) {
        var value = dropdown.getAttribute("data-value");
        var labelEl = dropdown.querySelector(".np-dropdown-label");
        var options = dropdown.querySelectorAll(".np-dropdown-option");
        for (var i = 0; i < options.length; i++) {
            var opt = options[i];
            var isSelected = opt.getAttribute("data-value") === value;
            opt.setAttribute("aria-selected", isSelected ? "true" : "false");
            if (isSelected) {
                opt.classList.add("np-dropdown-option-selected");
                if (labelEl) {
                    var optLabel = opt.querySelector(".np-dropdown-option-label");
                    labelEl.textContent = optLabel ? optLabel.textContent : value;
                }
            } else {
                opt.classList.remove("np-dropdown-option-selected");
            }
        }
    }

    function selectOption(dropdown, value, fireEvent) {
        dropdown.setAttribute("data-value", value);
        syncDropdown(dropdown);
        if (fireEvent) {
            dropdown.dispatchEvent(new CustomEvent("np-dropdown-change", {
                bubbles: true,
                detail: { value: value, dropdown: dropdown }
            }));
        }
    }

    function initDropdowns() {
        var dropdowns = document.querySelectorAll(".np-dropdown");
        for (var d = 0; d < dropdowns.length; d++) {
            (function (dropdown) {
                /* Always (re)sync visual state from data-value */
                syncDropdown(dropdown);

                if (dropdown._npInited) return;
                dropdown._npInited = true;
                describeDropdown(dropdown);

                var trigger = dropdown.querySelector(".np-dropdown-trigger");
                if (trigger) {
                    trigger.addEventListener("click", function (e) {
                        e.stopPropagation();
                        var willOpen = !dropdown.classList.contains("open");
                        closeAllDropdowns(dropdown);   /* only one open at a time */
                        setOpen(dropdown, willOpen);
                    });
                    trigger.addEventListener("keydown", function (e) { onTriggerKey(dropdown, e); });
                }

                var menu = dropdown.querySelector(".np-dropdown-menu");
                if (menu) menu.addEventListener("keydown", function (e) { onOptionKey(dropdown, e); });

                var options = dropdown.querySelectorAll(".np-dropdown-option");
                for (var i = 0; i < options.length; i++) {
                    options[i].addEventListener("click", function (e) {
                        e.stopPropagation();
                        setOpen(dropdown, false);
                        if (trigger) trigger.focus();
                        selectOption(dropdown, this.getAttribute("data-value"), true);
                    });
                }
            })(dropdowns[d]);
        }

        if (!_globalDropdownHandlersBound) {
            _globalDropdownHandlersBound = true;
            /* Click anywhere outside a dropdown closes all open ones */
            document.addEventListener("click", function (e) {
                if (!e.target || !e.target.closest || !e.target.closest(".np-dropdown")) {
                    closeAllDropdowns(null);
                }
            });
            /* Escape closes all open dropdowns (generic component behaviour) */
            document.addEventListener("keydown", function (e) {
                if (e.key === "Escape") closeAllDropdowns(null);
            });
        }
    }

    NP.dropdown = {
        initAll: initDropdowns,
        closeAll: function () { closeAllDropdowns(null); },
        setValue: function (dropdown, value, fireEvent) {
            if (typeof dropdown === "string") {
                dropdown = document.getElementById(dropdown);
            }
            if (dropdown) selectOption(dropdown, value, !!fireEvent);
        }
    };

    /* =====================================================================
     * Settings panel (feature layer)
     * ===================================================================== */

    function currentTheme() {
        if (NP.state && NP.state.data && NP.state.data.theme) {
            return NP.state.data.theme;
        }
        return document.documentElement.getAttribute("data-theme") || "matrix";
    }

    function currentUiFont() {
        if (NP.state && NP.state.data && NP.state.data.ui_font) {
            return NP.state.data.ui_font;
        }
        return "jetbrains-mono";
    }

    function fontFamilyFor(value) {
        var opt = document.querySelector(
            '#setting-ui-font .np-dropdown-option[data-value="' + value + '"]'
        );
        return opt ? opt.getAttribute("data-font-family") : null;
    }

    function applyUiFont(value) {
        var fam = fontFamilyFor(value);
        if (fam) {
            document.documentElement.style.setProperty("--font-display", fam);
        }
    }

    /* =====================================================================
     * Settings v2 — helpers + wiring
     * ===================================================================== */

    /* Read a setting from NP.state.data, falling back to dflt when the key
       is missing/null (existing data files predate the v2 keys). */
    function sget(key, dflt) {
        var d = NP.state && NP.state.data;
        if (d && d[key] !== undefined && d[key] !== null) return d[key];
        return dflt;
    }

    /* Mirror a patch into local state and persist it to the backend. */
    function saveSetting(patch) {
        if (NP.state && NP.state.data) {
            for (var k in patch) {
                if (patch.hasOwnProperty(k)) NP.state.data[k] = patch[k];
            }
        }
        if (NP.api && NP.api.saveSettings) {
            Promise.resolve(NP.api.saveSettings(patch)).catch(function (err) {
                console.error("Settings not saved:", err);   // i18n-ignore (console log)
            });
        } else {
            NP.api.fetch("/api/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch)
            });
        }
    }

    function setToggle(id, isOn) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle("on", isOn);
        el.setAttribute("aria-checked", isOn ? "true" : "false");
    }

    function bindToggle(id, getter, onChange) {
        var el = document.getElementById(id);
        if (!el) return;
        setToggle(id, getter());
        el.addEventListener("click", function () {
            var next = !el.classList.contains("on");
            setToggle(id, next);
            onChange(next);
        });
    }


    /* Noir effects as stored (missing = off: data from before the
       redesign got explicit values in noirpad/storage.py). */
    function effects() {
        return {
            glow: sget("glow_enabled", false) === true,
            matrix: sget("matrix_rain_enabled", false) === true,
            crt: sget("crt_enabled", false) === true
        };
    }

    function anyEffect() {
        var e = effects();
        return e.glow || e.matrix || e.crt;
    }

    /* Show the effects on screen and the switches in Settings. */
    function applyEffects() {
        var e = effects();
        /* N12: Windows high contrast. Nothing decorative over the text; the
           settings themselves stay as they are for when it is switched off. */
        var shown = !NP.forcedColors();
        applyGlow(sget("glow_intensity", 100));
        if (NP.matrixRain && NP.matrixRain.setEnabled) NP.matrixRain.setEnabled(e.matrix && shown);
        if (NP.effects && NP.effects.crtShow) NP.effects.crtShow(e.crt && shown);
        document.body.classList.toggle("np-glow", e.glow && shown);
        setToggle("setting-noir-effects", e.glow || e.matrix || e.crt);
        setToggle("setting-glow", e.glow);
        setToggle("setting-matrix-rain", e.matrix);
        setToggle("setting-crt", e.crt);
        var row = document.getElementById("setting-glow-intensity-row");
        if (row) row.hidden = !e.glow;
        /* U8: the glitch is a colour shift of the glow — without Glow it
           cannot show, so its switch is off-limits and says why. */
        var glitch = document.getElementById("setting-glitch-effect");
        if (glitch) glitch.disabled = !e.glow;
        var hint = document.getElementById("setting-glitch-hint");
        if (hint) hint.hidden = e.glow;
    }

    /* N12: zoom of the desktop window, Ctrl+= / Ctrl+- / Ctrl+0 (a browser has
       its own). #app takes its height from --np-zoom. */
    var ZOOM_DEFAULT = 100;
    var ZOOM_MIN = 70;
    var ZOOM_MAX = 200;
    var ZOOM_STEP = 10;

    function zoomInUse() {
        return !!(NP.shortcuts && NP.shortcuts.inDesktop && NP.shortcuts.inDesktop());
    }

    function cleanZoom(value) {
        var n = parseInt(value, 10);
        if (isNaN(n)) return ZOOM_DEFAULT;
        return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n));
    }

    function applyZoom(percent) {
        var z = cleanZoom(percent) / 100;
        var root = document.documentElement;
        root.style.zoom = String(z);
        root.style.setProperty("--np-zoom", String(z));
    }

    function changeZoom(next) {
        next = cleanZoom(next);
        applyZoom(next);
        if (next !== cleanZoom(sget("ui_zoom", ZOOM_DEFAULT))) saveSetting({ ui_zoom: next });
        if (NP.toast) NP.toast(NP.t("shortcuts.labels.zoomLevel", { n: next }), { timeout: 2000 });
    }

    function bindZoomKeys() {
        if (!NP.shortcuts || !NP.shortcuts.register) return;
        function by(step) {
            return function () {
                if (!zoomInUse()) return false;
                changeZoom(cleanZoom(sget("ui_zoom", ZOOM_DEFAULT)) + step);
            };
        }
        NP.shortcuts.register("zoom-in", by(ZOOM_STEP));
        NP.shortcuts.register("zoom-out", by(-ZOOM_STEP));
        NP.shortcuts.register("zoom-reset", function () {
            if (!zoomInUse()) return false;
            changeZoom(ZOOM_DEFAULT);
        });
    }

    /* CRT used to live only in this browser (localStorage). Data that has
       no crt_enabled yet takes that old value over, once. */
    function migrateCrt() {
        var d = NP.state && NP.state.data;
        if (!d || d.crt_enabled !== undefined) return;
        var old = false;
        try { old = localStorage.getItem("noirpad_crt") === "1"; } catch (e) { /* none */ }
        if (NP.state && NP.state.data) NP.state.data.crt_enabled = old;
        Promise.resolve(NP.api && NP.api.saveSettings && NP.api.saveSettings({ crt_enabled: old }))
            .then(function () {
                try { localStorage.removeItem("noirpad_crt"); } catch (e) { /* none */ }
            })
            .catch(function () { /* next start tries again */ });
    }

    /* No existing layout module applies orientation; keep it to a safe,
       non-breaking data attribute so the value round-trips + persists. */
    function applyOrientation(value) {
        /* Landscape is the CSS default for #editor; portrait is the
           body-class override. Toggle both so state is always explicit. */
        var portrait = value === "portrait";
        document.body.classList.toggle("orientation-portrait", portrait);
        document.body.classList.toggle("orientation-landscape", !portrait);
    }

    /* Number with a fixed count of decimals in the UI language's format
       ("1.5" in English, "1,5" in Czech). */
    function formatDecimal(value, digits) {
        try {
            return value.toLocaleString(NP.i18n ? NP.i18n.lang() : "en", {
                minimumFractionDigits: digits,
                maximumFractionDigits: digits
            });
        } catch (e) {
            return value.toFixed(digits);
        }
    }

    function formatBytes(bytes) {
        if (!bytes || bytes < 0) return NP.t("settings.size.bytes", { n: 0 });
        if (bytes < 1024) return NP.t("settings.size.bytes", { n: bytes });
        if (bytes < 1024 * 1024) {
            return NP.t("settings.size.kb", { n: formatDecimal(bytes / 1024, 1) });
        }
        if (bytes < 1024 * 1024 * 1024) {
            return NP.t("settings.size.mb", { n: formatDecimal(bytes / (1024 * 1024), 2) });
        }
        return NP.t("settings.size.gb", { n: formatDecimal(bytes / (1024 * 1024 * 1024), 2) });
    }

    /* About → Storage used. Refreshed each time Settings opens (no
       polling). Read-only /api/storage endpoint. */
    function refreshStorageUsed() {
        var el = document.getElementById("setting-storage-used");
        if (!el) return;
        el.textContent = NP.t("common.loading");
        NP.api.fetch("/api/storage")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                el.textContent = formatBytes(data.total_size) + " / ∞";
            })
            .catch(function () {
                el.textContent = NP.t("settings.storageError");
            });
    }

    /* Spellcheck (Settings → Editor) for both the rich-text editor and
       the Markdown source. The browser's own dictionaries decide the
       language. */
    function applySpellcheck(on) {
        ["editor", "editor-md"].forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.spellcheck = !!on;
        });
    }

    /* Single source of truth for glow strength. Sets concrete px values
       (JS does the math; CSS just substitutes var(--glow-blur*)) plus the
       multiplier (kept for compat) and updates the live % readout. */
    function applyGlow(pct) {
        pct = parseInt(pct, 10);
        if (isNaN(pct)) pct = 100;
        /* Glow is a Noir effect: off = no glow at all (the slider keeps its
           value for when it comes back). */
        var m = sget("glow_enabled", false) === true && !NP.forcedColors() ? pct / 100 : 0;
        var root = document.documentElement;
        root.style.setProperty("--glow-multiplier", String(m));
        root.style.setProperty("--glow-core", (4 * m) + "px");
        root.style.setProperty("--glow-blur-sm", (12 * m) + "px");
        root.style.setProperty("--glow-blur", (22 * m) + "px");
        root.style.setProperty("--glow-blur-lg", (40 * m) + "px");
        var vEl = document.getElementById("setting-glow-intensity-val");
        if (vEl) vEl.textContent = pct + "%";
    }

    /* Shortcuts list + recording UI moved to shortcuts-manager.js
       (standalone #shortcuts-overlay). The core registry/dispatch/
       validation stays in shortcuts.js. */

    function syncRadioGroup(name, value) {
        var btns = document.querySelectorAll(
            '[id^="setting-' + name + '-"]'
        );
        for (var i = 0; i < btns.length; i++) {
            var on = btns[i].getAttribute("data-value") === value;
            btns[i].classList.toggle("on", on);
            btns[i].setAttribute("aria-checked", on ? "true" : "false");
        }
    }

    var _v2Wired = false;

    function wireV2() {
        if (_v2Wired) return;
        _v2Wired = true;

        /* ---- Appearance ---- */

        var openFp = document.getElementById("setting-open-font-picker");
        if (openFp) {
            openFp.addEventListener("click", function () {
                NP.settings.close();
                if (NP.fontPicker && NP.fontPicker.show) NP.fontPicker.show();
            });
        }

        /* setting-glow-intensity: drives --glow-multiplier (every glow
           blur in noirpad.css is calc(Npx * var(--glow-multiplier,1))).
           input = real-time live preview; persistence is debounced. */
        var glowSlider = document.getElementById("setting-glow-intensity");
        if (glowSlider) {
            glowSlider.addEventListener("input", function () {
                var pct = parseInt(this.value, 10);
                if (isNaN(pct)) pct = 100;
                applyGlow(pct);
                if (NP.state && NP.state.data) {
                    NP.state.data.glow_intensity = pct;
                }
                if (NP.settings._glowSaveTimer) {
                    clearTimeout(NP.settings._glowSaveTimer);
                }
                NP.settings._glowSaveTimer = setTimeout(function () {
                    if (NP.api && NP.api.saveSettings) {
                        NP.api.saveSettings({ glow_intensity: pct });
                    }
                }, 500);
            });
        }

        /* ---- Noir effects: glow, matrix rain, CRT (all off for a new
           install). The master switch turns all three on or off. ---- */
        bindToggle("setting-noir-effects", anyEffect, function (v) {
            NP.settings.setEffects({ glow: v, matrix: v, crt: v });
        });
        bindToggle("setting-glow", function () { return effects().glow; },
            function (v) { NP.settings.setEffects({ glow: v }); });
        bindToggle("setting-matrix-rain", function () { return effects().matrix; },
            function (v) { NP.settings.setEffects({ matrix: v }); });
        bindToggle("setting-crt", function () { return effects().crt; },
            function (v) { NP.settings.setEffects({ crt: v }); });

        bindToggle(
            "setting-show-splash",
            function () { return sget("show_splash", true) !== false; },
            function (v) { saveSetting({ show_splash: v }); }
        );

        /* ---- Editor ---- */

        bindToggle(
            "setting-autosave",
            function () { return !!sget("autosave", false); },
            function (v) {
                saveSetting({ autosave: v });
                if (NP.editor && NP.editor._currentNoteId) NP.editor.startAutosave();
            }
        );

        var aiDd = document.getElementById("setting-autosave-interval");
        if (aiDd) {
            aiDd.addEventListener("np-dropdown-change", function (e) {
                var n = parseInt(e.detail.value, 10);
                saveSetting({ autosave_interval: isNaN(n) ? 5 : n });
                if (NP.editor && NP.editor.startAutosave && NP.editor._autosaveTimer) {
                    NP.editor.startAutosave();   /* restart with the new interval */
                }
            });
        }

        var orient = document.querySelector("#setting-page-orientation-landscape");
        var orientP = document.querySelector("#setting-page-orientation-portrait");
        [orient, orientP].forEach(function (btn) {
            if (!btn) return;
            btn.addEventListener("click", function () {
                var value = btn.getAttribute("data-value");
                syncRadioGroup("page-orientation", value);
                saveSetting({ page_orientation: value });
                applyOrientation(value);
            });
        });

        bindToggle(
            "setting-spellcheck",
            function () { return sget("spellcheck", true) !== false; },
            function (v) {
                saveSetting({ spellcheck: v });
                applySpellcheck(v);
            }
        );

        /* glitch_effect is read by effects.js (onEditorInput early-returns
           when false) — integrated with effects.js. */
        bindToggle(
            "setting-glitch-effect",
            function () { return sget("glitch_effect", true) !== false; },
            function (v) { saveSetting({ glitch_effect: v }); }
        );

        /* ---- Behavior ---- */

        /* confirm_delete is read by tree.js + app.js delete handlers. */
        bindToggle(
            "setting-confirm-delete",
            function () { return sget("confirm_delete", true) !== false; },
            function (v) { saveSetting({ confirm_delete: v }); }
        );

        /* Language: stored with the settings; reload so every module
           (and the lock screen next time) renders in it. */
        var langDd = document.getElementById("setting-language");
        if (langDd) {
            langDd.addEventListener("np-dropdown-change", function (e) {
                var value = e.detail.value;   /* "auto" | "en" | "cs" */
                if (NP.state && NP.state.data) NP.state.data.language = value;
                NP.api.saveSettings({ language: value }).then(function () {
                    window.location.reload();
                });
            });
        }

        var idleDd = document.getElementById("setting-idle-lock");
        if (idleDd) {
            idleDd.addEventListener("np-dropdown-change", function (e) {
                var value = e.detail.value;   /* "off" | "5" | "30" | "60" */
                /* saveSetting mirrors to NP.state.data + persists. */
                saveSetting({ idle_lock_minutes: value });
                /* Apply live: off => 0, otherwise the numeric minutes. */
                if (NP.autoLock && NP.autoLock.setMinutes) {
                    var n = parseInt(value, 10);
                    NP.autoLock.setMinutes(isNaN(n) ? 0 : n);
                }
            });
        }

        /* When ON, the +Note flow prompts for an encryption password
           immediately after loading the new note (see app.js #btn-new-note
           handler). Cancelling the prompt leaves the note plain. */
        bindToggle(
            "setting-default-encrypted",
            function () { return !!sget("default_encrypted", false); },
            function (v) { saveSetting({ default_encrypted: v }); }
        );

        /* ---- Data ---- */

        var dlBackup = document.getElementById("setting-download-backup");
        if (dlBackup) {
            dlBackup.addEventListener("click", function () {
                if (NP.backup && NP.backup.download) NP.backup.download();
                else if (NP.api && NP.api.downloadBackup) NP.api.downloadBackup();
            });
        }

        var impBackup = document.getElementById("setting-import-backup");
        if (impBackup) {
            impBackup.addEventListener("click", function () {
                if (NP.backup && NP.backup.import) NP.backup.import();
            });
        }

        /* Store edition (N1.11): add the installer edition's notes into a
           new folder. Shown only while the backend offers it (refreshed on
           every open, see refreshInstallerNotes). */
        var addInstaller = document.getElementById("setting-add-installer-notes");
        if (addInstaller) {
            addInstaller.addEventListener("click", function () {
                addInstaller.disabled = true;
                NP.api.addInstallerNotes(NP.t("settings.installerFolder")).then(function (res) {
                    addInstaller.hidden = true;
                    return NP.state.init().then(function () {
                        if (NP.tree && NP.tree.render) NP.tree.render();
                        NP.toast(NP.t("settings.installerAdded", { folder: res.folder }), { timeout: 10000 });
                    });
                }).catch(function (err) {
                    NP.dialog.alert(NP.t("settings.installerAddFailed", {
                        error: err && err.message ? err.message : err
                    }));
                    refreshInstallerNotes();
                }).finally(function () { addInstaller.disabled = false; });
            });
        }

        var exportAll = document.getElementById("setting-export-all");
        if (exportAll) {
            exportAll.addEventListener("click", function () {
                /* Fetch as blob so we can show a loading state during the
                   server-side zip build (vs. window.location.href which
                   gives no feedback). */
                var originalText = exportAll.textContent;
                exportAll.textContent = NP.t("settings.exporting");
                exportAll.disabled = true;

                NP.api.download("/api/notes/export")
                    .finally(function () {
                        exportAll.textContent = originalText;
                        exportAll.disabled = false;
                    });
            });
        }

        var exportMd = document.getElementById("setting-export-md");
        if (exportMd) {
            exportMd.addEventListener("click", function () {
                exportMd.disabled = true;
                NP.api.download("/api/notes/export-md").then(function (headers) {
                    var skipped = headers ? parseInt(headers.get("x-noirpad-skipped"), 10) : 0;
                    if (skipped > 0) {
                        NP.dialog.alert(NP.t("settings.exportMdSkipped", { n: skipped }));
                    }
                }).finally(function () { exportMd.disabled = false; });
            });
        }

        var importMd = document.getElementById("setting-import-md");
        if (importMd) {
            importMd.addEventListener("click", function () {
                var input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.accept = ".md,.markdown,.txt,.zip";
                input.addEventListener("change", function () {
                    if (!input.files || !input.files.length) return;
                    NP.api.importMarkdown(input.files).then(function (res) {
                        return NP.state.init().then(function () {
                            if (NP.tree && NP.tree.render) NP.tree.render();
                            var msg = res.images
                                ? NP.t("settings.importDoneWithImages", {
                                    notes: NP.t("settings.importNotes", { n: res.notes }),
                                    images: NP.t("settings.importImages", { n: res.images })
                                })
                                : NP.t("settings.importDone", {
                                    notes: NP.t("settings.importNotes", { n: res.notes })
                                });
                            if (res.skipped) msg += "\n" + NP.t("settings.importSkipped", { n: res.skipped });
                            NP.dialog.alert(msg);
                        });
                    }).catch(function (err) {
                        NP.dialog.alert(NP.t("settings.importFailed", { error: err && err.message ? err.message : err }));
                    });
                });
                input.click();
            });
        }

        var emptyTrash = document.getElementById("setting-empty-trash");
        if (emptyTrash) {
            emptyTrash.addEventListener("click", function () {
                /* NP.trash.empty() handles its own confirm + refresh. */
                if (NP.trash && NP.trash.empty) NP.trash.empty();
            });
        }

        var resetAll = document.getElementById("setting-reset-all");
        if (resetAll) {
            resetAll.addEventListener("click", function () {
                NP.dialog.confirm(
                    NP.t("settings.resetConfirm") + "\n\n" + NP.t("settings.resetConfirmDetail"),
                    { okLabel: NP.t("settings.resetOk"), danger: true }
                ).then(function (ok) {
                    if (!ok) return;

                    return NP.api.fetch("/api/settings/reset", { method: "POST" })
                        .then(function (r) {
                            if (!r.ok) {
                                throw new Error(NP.t("settings.serverError", { status: r.status }));
                            }
                            return r.json();
                        })
                        .then(function () {
                            /* Reload — simpler and more reliable than
                               re-applying every setting in JS (theme, font,
                               glow multiplier, CRT/matrix rain, autosave
                               timer, shortcut bindings, ...). */
                            window.location.reload();
                        })
                        .catch(function (err) {
                            NP.dialog.alert(NP.t("settings.resetFailed", {
                                error: err && err.message ? err.message : err
                            }));
                        });
                });
            });
        }

        /* ---- About: version and project link from /api/version ---- */
        var info = NP.appInfo || {};
        var aboutVersion = document.getElementById("about-version");
        if (aboutVersion && info.version) aboutVersion.textContent = "v" + info.version;
        var aboutSource = document.getElementById("about-source");
        if (aboutSource && info.url) {
            aboutSource.href = info.url;
            aboutSource.textContent = info.url.replace(/^https:\/\//, "") + " \u2197";
        }
        /* "by Arcly Studio" \u2192 the project page; links.js opens it in the
           system browser (desktop) or a new tab (web). */
        var aboutBy = document.getElementById("about-by");
        if (aboutBy && info.url && info.author) {
            aboutBy.href = info.url;
            aboutBy.textContent = NP.t("ui.settings.by", { author: info.author });
            aboutBy.hidden = false;
        }
        /* N9: "Copyright (c) 2026 Arcly Studio · MIT" (the line of LICENSE). */
        var aboutCopyright = document.getElementById("about-copyright");
        if (aboutCopyright && info.copyright) {
            aboutCopyright.textContent = NP.t("ui.settings.copyrightLine", { copyright: info.copyright });
        }
        /* N10: e-mail for people without a GitHub account; links.js hands
           mailto: to the system mail app. */
        var aboutContact = document.getElementById("about-contact");
        if (aboutContact && info.contact) {
            aboutContact.href = "mailto:" + info.contact;
            aboutContact.textContent = info.contact;
            aboutContact.hidden = false;
        }
        /* N1.8: the privacy policy in the UI language, on GitHub (links.js
           opens it in the browser). The language changes only with a reload. */
        var aboutPrivacy = document.getElementById("about-privacy");
        if (aboutPrivacy && info.url) {
            var csPolicy = NP.i18n && NP.i18n.lang && NP.i18n.lang() === "cs";
            aboutPrivacy.href = info.url + "/blob/main/" + (csPolicy ? "PRIVACY.cs.md" : "PRIVACY.md");
            aboutPrivacy.hidden = false;
        }
        /* N8: LICENSE + THIRD-PARTY-NOTICES.txt (licenses.js) */
        var aboutLicenses = document.getElementById("about-licenses");
        if (aboutLicenses) {
            aboutLicenses.addEventListener("click", function () {
                if (NP.licenses) NP.licenses.open();
            });
        }

        /* ---- Session (only for a password-protected server) ---- */
        var sessionSection = document.getElementById("settings-session-section");
        if (sessionSection && NP.auth && NP.auth.passwordRequired) {
            sessionSection.hidden = !NP.auth.passwordRequired();
        }
        var logoutBtn = document.getElementById("settings-logout-btn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", function () {
                NP.dialog.confirm(NP.t("settings.logoutConfirm")).then(function (ok) {
                    if (ok && NP.auth && NP.auth.logout) NP.auth.logout();
                });
            });
        }
    }

    /* The "Add notes from the installer version" button: Store edition only,
       and only until the notes were copied or added (backend decides). */
    function refreshInstallerNotes() {
        var btn = document.getElementById("setting-add-installer-notes");
        if (!btn) return Promise.resolve();
        if ((NP.appInfo || {}).edition !== "store" || !NP.api.installerNotesStatus) {
            btn.hidden = true;
            return Promise.resolve();
        }
        return NP.api.installerNotesStatus().then(function (res) {
            btn.hidden = !(res && res.available);
        }, function () { btn.hidden = true; });
    }

    NP.settings = {
        _inited: false,

        init: function () {
            var overlay = document.getElementById("settings-overlay");
            if (!overlay) return;

            initDropdowns();

            if (!NP.settings._inited) {
                NP.settings._inited = true;
                bindZoomKeys();
                /* High contrast switched on or off while NoirPad runs. */
                if (window.matchMedia) {
                    var contrast = window.matchMedia("(forced-colors: active)");
                    if (contrast && contrast.addEventListener) contrast.addEventListener("change", applyEffects);
                }

                var closeBtn = document.getElementById("settings-close");
                if (closeBtn) {
                    closeBtn.addEventListener("click", function () {
                        NP.settings.close();
                    });
                }

                /* Backdrop click closes the panel */
                overlay.addEventListener("mousedown", function (e) {
                    if (e.target === overlay) NP.settings.close();
                });

                /* Escape: capture phase so we decide before the generic
                   dropdown / app.js handlers. First Escape closes an open
                   dropdown, a second closes the panel. */
                document.addEventListener("keydown", function (e) {
                    if (e.key !== "Escape") return;
                    /* Recording a shortcut? Let Escape reach the recorder
                       (cancel) instead of closing Settings. */
                    if (NP.shortcuts && NP.shortcuts._recordingActive) return;
                    /* Shortcuts manager open on top of Settings? Let its
                       own Escape handler close it, don't close Settings. */
                    var sov = document.getElementById("shortcuts-overlay");
                    if (sov && sov.classList.contains("visible")) return;
                    /* Same for About → Licenses (licenses.js). */
                    if (NP.licenses && NP.licenses.isOpen()) return;
                    if (!overlay.classList.contains("visible")) return;
                    if (overlay.querySelector(".np-dropdown.open")) {
                        closeAllDropdowns(null);
                    } else {
                        NP.settings.close();
                    }
                    e.stopPropagation();
                }, true);

                /* Theme dropdown → apply + persist (reuse NP.themes so
                   state + server stay consistent with the rest of the app) */
                var themeDd = document.getElementById("setting-theme");
                if (themeDd) {
                    themeDd.addEventListener("np-dropdown-change", function (e) {
                        if (NP.themes && NP.themes.apply) {
                            NP.themes.apply(e.detail.value);
                        } else {
                            document.documentElement.dataset.theme = e.detail.value;
                            if (NP.api && NP.api.saveSettings) {
                                NP.api.saveSettings({ theme: e.detail.value });
                            }
                        }
                    });
                }

                /* UI font dropdown → set --font-display + persist */
                var fontDd = document.getElementById("setting-ui-font");
                if (fontDd) {
                    fontDd.addEventListener("np-dropdown-change", function (e) {
                        var selectedOption = e.target.querySelector(
                            '.np-dropdown-option[data-value="' + e.detail.value + '"]'
                        );
                        var fontFamily = selectedOption
                            ? selectedOption.dataset.fontFamily
                            : null;

                        if (fontFamily) {
                            document.documentElement.style.setProperty(
                                "--font-display", fontFamily
                            );
                        }
                        if (NP.state && NP.state.data) {
                            NP.state.data.ui_font = e.detail.value;
                        }
                        if (NP.api && NP.api.saveSettings) {
                            NP.api.saveSettings({ ui_font: e.detail.value });
                        } else {
                            NP.api.fetch("/api/settings", {
                                method: "PUT",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ ui_font: e.detail.value })
                            });
                        }
                    });
                }

                wireV2();
            }

            /* Apply persisted ui_font on startup + sync both dropdowns */
            NP.settings.syncFromState();
            applyUiFont(currentUiFont());
        },

        /* Apply persisted runtime state to the live app. Called from app.js
           once NP.state.data is loaded. */
        applyRuntimeState: function () {
            migrateCrt();
            applyEffects();
            if (zoomInUse()) applyZoom(sget("ui_zoom", ZOOM_DEFAULT));
            applySpellcheck(sget("spellcheck", true) !== false);
            /* Startup ALWAYS forces Landscape (user choice) — overrides any
               persisted Portrait. setOrientation keeps the body class, the
               Settings radio and the stored value in sync. Ctrl+L / Settings
               still switch during the session; a reload resets to Landscape. */
            NP.settings.setOrientation("landscape");
        },

        /* Change Noir effects: {glow, matrix, crt} (any subset). */
        setEffects: function (patch) {
            var p = {};
            if (patch.glow !== undefined) p.glow_enabled = !!patch.glow;
            if (patch.matrix !== undefined) p.matrix_rain_enabled = !!patch.matrix;
            if (patch.crt !== undefined) p.crt_enabled = !!patch.crt;
            saveSetting(p);
            applyEffects();
        },

        effects: effects,

        /* Public orientation API — shared by the Settings radio, the
           Ctrl+L shortcut and the :orientation command so the body class,
           the persisted setting and the radio UI stay in sync. */
        setOrientation: function (value) {
            if (value !== "portrait" && value !== "landscape") return;
            applyOrientation(value);
            syncRadioGroup("page-orientation", value);
            /* R9: only a change is written (every start sets Landscape). */
            if (sget("page_orientation", "landscape") !== value) saveSetting({ page_orientation: value });
        },

        toggleOrientation: function () {
            var cur = sget("page_orientation", "landscape");
            NP.settings.setOrientation(
                cur === "portrait" ? "landscape" : "portrait"
            );
        },

        /* Reflect saved theme / ui_font into the dropdowns WITHOUT firing
           change events (used on init and every open). */
        syncFromState: function () {
            var themeDd = document.getElementById("setting-theme");
            if (themeDd) selectOption(themeDd, currentTheme(), false);
            var fontDd = document.getElementById("setting-ui-font");
            if (fontDd) selectOption(fontDd, currentUiFont(), false);

            /* ---- Settings v2 controls ---- */
            applyEffects();        /* the Noir effects switches */
            setToggle("setting-show-splash",
                sget("show_splash", true) !== false);
            setToggle("setting-autosave", !!sget("autosave", false));
            setToggle("setting-spellcheck",
                sget("spellcheck", true) !== false);
            setToggle("setting-glitch-effect",
                sget("glitch_effect", true) !== false);
            setToggle("setting-confirm-delete",
                sget("confirm_delete", true) !== false);
            setToggle("setting-default-encrypted",
                !!sget("default_encrypted", false));

            var aiDd = document.getElementById("setting-autosave-interval");
            if (aiDd) {
                selectOption(aiDd, String(sget("autosave_interval", 5)), false);
            }
            var idleDd = document.getElementById("setting-idle-lock");
            if (idleDd) {
                selectOption(idleDd, String(sget("idle_lock_minutes", "off")),
                    false);
            }
            var langDd = document.getElementById("setting-language");
            if (langDd) selectOption(langDd, String(sget("language", "auto")), false);

            syncRadioGroup("page-orientation",
                sget("page_orientation", "landscape"));

            var glowSlider2 = document.getElementById("setting-glow-intensity");
            if (glowSlider2) {
                var glow = sget("glow_intensity", 100);
                glowSlider2.value = glow;
                applyGlow(glow);
            }
        },

        open: function () {
            var overlay = document.getElementById("settings-overlay");
            if (!overlay) return;
            NP.settings.syncFromState();
            applyUiFont(currentUiFont());
            refreshStorageUsed();
            refreshInstallerNotes();
            if (NP.shortcutsManager && NP.shortcutsManager.refreshSummary) {
                NP.shortcutsManager.refreshSummary();
            }
            overlay.classList.add("visible");
            if (NP.modal) NP.modal.open(overlay, { labelledBy: "settings-title" });
        },

        close: function () {
            var overlay = document.getElementById("settings-overlay");
            if (!overlay) return;
            closeAllDropdowns(null);
            overlay.classList.remove("visible");
            if (NP.modal) NP.modal.close(overlay);
        },

        toggle: function () {
            var overlay = document.getElementById("settings-overlay");
            if (overlay && overlay.classList.contains("visible")) {
                NP.settings.close();
            } else {
                NP.settings.open();
            }
        }
    };

})(window.NP);
