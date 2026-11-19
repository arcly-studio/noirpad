// N1.11 audit of every keyboard shortcut: each key does what the help (F1)
// says, in a rich-text note, in the Markdown source and outside the editor;
// no two actions share a key; F1, the README tables, the tooltips and the
// list in Settings show the same keys and names, in English and Czech.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";
import { locale } from "./harness.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const STATIC = path.join(ROOT, "static");
const INDEX = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];
const HELP_JS = fs.readFileSync(path.join(STATIC, "js/help.js"), "utf8");
const TOOLS = INDEX.match(/<div id="top-tools"[\s\S]*?\n {8}<\/div>/)[0];

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/focus-mode.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js", "js/help.js",
    "js/shortcuts-manager.js", "js/app.js"];
const EXTRA = `<button id="btn-new-note"></button><button id="btn-new-folder"></button>
  <div id="sidebar"></div><canvas id="matrix-canvas"></canvas><div id="shortcuts-body"></div>`;
const TREE = [{ id: "r", name: "Rich", type: "note" }, { id: "m", name: "Md", type: "note" }];

async function boot(where, lang = "en") {
    const app = startApp({ tree: TREE, notes: { r: "hello world", m: "hello world" }, modes: { m: "markdown" },
        scripts: SCRIPTS, body: TOOLS + EXTRA + BODY + SETTINGS });
    const { win, NP } = app;
    NP.auth = { start() {} };
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    // jsdom has no isContentEditable (app.js: Delete in a text field deletes text)
    Object.defineProperty(win.HTMLElement.prototype, "isContentEditable", {
        configurable: true,
        get() { return !!this.closest('[contenteditable="true"]'); },
    });
    win.matchMedia = () => ({ matches: false, addEventListener() {} });
    NP.api.hasToken = () => true;
    NP.api.saveSettings = vi.fn(() => Promise.resolve({}));
    NP.api.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    NP.toast = vi.fn();
    if (lang !== "en") NP.i18n.use(lang, locale(lang));
    await app.ready();
    NP.settings.init();
    NP.app.bindKeys();
    NP.markdown.registerShortcuts();
    NP.shortcuts.init();
    NP.topbar.init();
    NP.paste.init();
    NP.shortcutsManager.init();
    if (where !== "outside") {
        await NP.tabs.add(where === "md" ? "m" : "r", where === "md" ? "Md" : "Rich");
        await flush();
    } else {
        await NP.tabs.add("r", "Rich");
        await flush();
    }
    const ed = win.document.getElementById("editor");
    ed.setAttribute("contenteditable", ed.contentEditable);   // jsdom does not reflect it
    return app;
}

/* The spies behind every action (what the handlers call). */
function spyAll(app) {
    const { win, NP } = app;
    const s = {
        save: vi.spyOn(NP.editor, "save").mockImplementation(() => Promise.resolve(true)),
        find: vi.fn(), findNext: vi.fn(), findPrev: vi.fn(),
        image: vi.fn(), newNote: vi.fn(), newFolder: vi.fn(), favorite: vi.fn(), lock: vi.fn(),
        clear: vi.spyOn(NP.paste, "clearFormatting").mockImplementation(() => true),
        markdown: vi.spyOn(NP.markdown, "toggleForCurrentNote").mockImplementation(() => {}),
        del: vi.fn(), rename: vi.fn(),
        focus: vi.spyOn(NP.focusMode, "toggle").mockImplementation(() => {}),
        orientation: vi.spyOn(NP.settings, "toggleOrientation").mockImplementation(() => {}),
        settings: vi.spyOn(NP.settings, "open").mockImplementation(() => {}),
        help: vi.spyOn(NP.help, "show").mockImplementation(() => {}),
        findAll: vi.fn(), palette: vi.fn(), font: vi.fn(), fullscreen: vi.fn(),
        next: vi.spyOn(NP.tabs, "next").mockImplementation(() => {}),
        prev: vi.spyOn(NP.tabs, "prev").mockImplementation(() => {}),
        closeTab: vi.spyOn(NP.tabs, "closeCurrent").mockImplementation(() => {}),
    };
    NP.search = { toggle: s.find, next: s.findNext, prev: s.findPrev };
    NP.tree.deleteSelected = s.del;
    NP.tree.renameSelected = s.rename;
    NP.tree.focusedId = () => "r";
    NP.findAll = { show: s.findAll };
    NP.commandBar = { toggle: s.palette };
    NP.fontPicker = { show: s.font };
    NP.fullscreen = { toggle: s.fullscreen };
    // the buttons the handlers click: one listener each, calling this round's spy
    app.spies = s;
    if (!app.buttonsWired) {
        app.buttonsWired = true;
        const click = (id, name) => win.document.getElementById(id).addEventListener("click", (e) => {
            e.stopImmediatePropagation();
            app.spies[name]();
        }, true);
        click("btn-insert-image", "image");
        click("btn-new-note", "newNote");
        click("btn-new-folder", "newFolder");
        click("btn-favorite", "favorite");
        click("btn-lock", "lock");
    }
    return s;
}

/* "Ctrl+Shift+X" -> a keydown on the focused element. */
function press(win, ks) {
    const parts = ks.split("+");
    let key = parts.pop();
    const shift = parts.includes("Shift");
    if (key === "Space") key = " ";
    else if (key.length === 1 && /[a-z]/i.test(key)) key = shift ? key.toUpperCase() : key.toLowerCase();
    const ev = new win.KeyboardEvent("keydown", { key, code: key === "0" ? "Digit0" : "",
        ctrlKey: parts.includes("Ctrl"), shiftKey: shift, altKey: parts.includes("Alt"),
        bubbles: true, cancelable: true });
    (win.document.activeElement || win.document.body).dispatchEvent(ev);
    return ev;
}

/* Put the focus and a selection ("world") where *where* says. */
function place(app, where) {
    const { win, NP } = app;
    const ed = win.document.getElementById("editor");
    if (where === "rich") {
        NP.editor.renderContent(ed, "hello world", []);
        ed.focus();
        const t = ed.firstChild;
        const r = win.document.createRange();
        r.setStart(t, 6);
        r.setEnd(t, 11);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
    } else if (where === "md") {
        const ta = win.document.getElementById("editor-md");
        ta.value = "hello world";
        ta.focus();
        ta.setSelectionRange(6, 11);
    } else {
        win.document.activeElement.blur();
    }
}

const text = (app, where) => where === "md" ? app.win.document.getElementById("editor-md").value
    : app.win.document.getElementById("editor").innerHTML;

/* What the help says each action does, as a check per place.
   where: "rich" | "md" | "outside". */
const EXPECT = {
    "md-bold": (a, s, w) => expect(text(a, w)).toBe({ rich: "hello <b>world</b>", md: "hello **world**", outside: "hello world" }[w]),
    "md-italic": (a, s, w) => expect(text(a, w)).toBe({ rich: "hello <i>world</i>", md: "hello *world*", outside: "hello world" }[w]),
    "fmt-underline": (a, s, w) => expect(text(a, w)).toBe({ rich: "hello <u>world</u>", md: "hello world", outside: "hello world" }[w]),
    "md-strikethrough": (a, s, w) => expect(text(a, w)).toBe({ rich: "hello <strike>world</strike>", md: "hello ~~world~~", outside: "hello world" }[w]),
    "md-link": (a, s, w) => {
        const dlg = a.win.document.querySelector(".np-link-dialog");
        expect(!!dlg).toBe(w === "rich");
        if (dlg) dlg.querySelector(".dialog-btn:not(.primary)").click();
        if (w === "md") expect(text(a, w)).toBe("hello [world](url)");
    },
    "md-code-inline": (a, s, w) => expect(text(a, w)).toBe(w === "md" ? "hello `world`" : "hello world"),
    "md-code-block": (a, s, w) => expect(text(a, w)).toBe(w === "md" ? "hello \n```\nworld\n```\n" : "hello world"),
    "save": (a, s) => expect(s.save).toHaveBeenCalled(),
    "find": (a, s) => expect(s.find).toHaveBeenCalled(),
    "find-next": (a, s) => expect(s.findNext).toHaveBeenCalled(),
    "find-prev": (a, s) => expect(s.findPrev).toHaveBeenCalled(),
    "insert-image": (a, s) => expect(s.image).toHaveBeenCalled(),
    "clear-formatting": (a, s, w) => expect(s.clear).toHaveBeenCalledTimes(w === "rich" ? 1 : 0),
    "toggle-markdown": (a, s) => expect(s.markdown).toHaveBeenCalled(),
    "new-folder": (a, s) => expect(s.newFolder).toHaveBeenCalled(),
    "new-note": (a, s) => expect(s.newNote).toHaveBeenCalled(),
    // in a text field Delete deletes text, not the note
    "delete": (a, s, w) => expect(s.del).toHaveBeenCalledTimes(w === "outside" ? 1 : 0),
    "rename": (a, s) => expect(s.rename).toHaveBeenCalled(),
    "toggle-favorite": (a, s) => expect(s.favorite).toHaveBeenCalled(),
    "toggle-lock": (a, s) => expect(s.lock).toHaveBeenCalled(),
    "toggle-sidebar": (a, s) => expect(s.focus).toHaveBeenCalled(),
    "toggle-orientation": (a, s) => expect(s.orientation).toHaveBeenCalled(),
    "open-settings": (a, s) => expect(s.settings).toHaveBeenCalled(),
    "open-help": (a, s) => expect(s.help).toHaveBeenCalled(),
    "find-all": (a, s) => expect(s.findAll).toHaveBeenCalled(),
    "open-command-palette": (a, s) => expect(s.palette).toHaveBeenCalled(),
    "open-font-picker": (a, s) => expect(s.font).toHaveBeenCalled(),
    "fullscreen": (a, s) => expect(s.fullscreen).toHaveBeenCalled(),
    "next-tab": (a, s) => expect(s.next).toHaveBeenCalled(),
    "prev-tab": (a, s) => expect(s.prev).toHaveBeenCalled(),
    "close-tab": (a, s) => expect(s.closeTab).toHaveBeenCalled(),
    "zoom-in": (a) => expect(a.win.document.documentElement.style.zoom).toBe("1.1"),
    "zoom-out": (a) => expect(a.win.document.documentElement.style.zoom).toBe("0.9"),
    "zoom-reset": (a) => expect(a.win.document.documentElement.style.zoom).toBe("1"),
};

/* The help rows: [key cap, label key, shortcut id?]. */
const HELP_ROWS = [...HELP_JS.matchAll(/\["([^"]+)", "([\w.]+)"(?:, "([\w-]+)")?\]/g)]
    .map((m) => ({ key: m[1], label: m[2], id: m[3] }));

describe("every shortcut does what F1 says (desktop defaults)", () => {
    for (const where of ["rich", "md", "outside"]) {
        it(`${where === "rich" ? "rich-text note" : where === "md" ? "Markdown source" : "outside the editor"}`, async () => {
            const app = await boot(where);
            const all = app.NP.shortcuts.getAll();
            const keyed = Object.keys(all).filter((id) => all[id].current);
            expect(keyed.filter((id) => !EXPECT[id])).toEqual([]);     // a new key needs a line here
            for (const id of keyed) {
                const s = spyAll(app);
                if (id === "zoom-out" || id === "zoom-reset") app.NP.state.data.ui_zoom = 100;
                if (id === "zoom-reset") app.NP.state.data.ui_zoom = 130;
                place(app, where);
                press(app.win, all[id].current);
                await flush();
                try {
                    EXPECT[id](app, s, where);
                } catch (e) {
                    e.message = `${id} (${all[id].current}) in ${where}: ${e.message}`;
                    throw e;
                }
                vi.restoreAllMocks();
            }
        });
    }
});

describe("no key is used twice", () => {
    for (const desktop of [true, false]) {
        it(desktop ? "desktop defaults" : "web defaults", async () => {
            const app = await boot("outside");
            app.NP.api.hasToken = () => desktop;
            if (!desktop) { app.NP.shortcuts._webDefaults = false; app.NP.shortcuts.init(); }
            const all = app.NP.shortcuts.getAll();
            const seen = {};
            for (const [id, info] of Object.entries(all)) {
                if (!info.default) continue;
                expect(seen[info.default], `${info.default}: ${seen[info.default]} and ${id}`).toBeUndefined();
                seen[info.default] = id;
            }
            // nor with the editor's own keys outside the list
            for (const own of ["Ctrl+Z", "Ctrl+Y", "Ctrl+C", "Ctrl+X", "Ctrl+V", "Ctrl+Shift+V", "Ctrl+A"]) {
                expect(seen[own], own).toBeUndefined();
            }
        });
    }
});

describe("F1, README, tooltips and the Settings list show the same keys", () => {
    it("every key in the list is in F1, with the key it has", async () => {
        const app = await boot("outside");
        const all = app.NP.shortcuts.getAll();
        for (const [id, info] of Object.entries(all)) {
            if (!info.default) continue;
            const row = HELP_ROWS.find((r) => r.id === id);
            expect(row, `${id} missing in F1`).toBeTruthy();
            expect(row.key, id).toBe(info.default);
        }
    });

    for (const lang of ["en", "cs"]) {
        it(`F1 window and the Settings list (${lang})`, async () => {
            const app = await boot("outside", lang);
            const { win, NP } = app;
            const dict = locale(lang);
            const t = (k) => k.split(".").reduce((o, p) => o && o[p], dict);
            NP.help.show();
            const content = () => win.document.getElementById("help-content").textContent;
            win.document.querySelector('#help-nav [data-idx="1"]').click();
            for (const id of ["md-bold", "md-italic", "fmt-underline", "md-strikethrough", "md-link", "toggle-sidebar"]) {
                const row = HELP_ROWS.find((r) => r.id === id);
                expect(content()).toContain(row.key);
                expect(content()).toContain(t(row.label));
            }
            expect(t("help.keys.focus")).not.toMatch(/Ctrl/);
            expect(JSON.stringify(dict)).not.toMatch(/Ctrl\+B\)/);   // no hard-coded "(Ctrl+B)" left
            // the effects bullet names the key currently set
            win.document.querySelectorAll("#help-nav [role=tab]").forEach((b) => {
                if (b.textContent === t("help.effects.title")) b.click();
            });
            expect(content()).toContain(t("help.effects.focus").replace("{keys}", "Ctrl+Shift+B"));
            // Settings → Keyboard shortcuts: every action with its name and key
            NP.shortcutsManager.refreshSummary();
            const rows = [...win.document.querySelectorAll("#shortcuts-body .shortcuts-row")];
            expect(rows.length).toBe(Object.keys(NP.shortcuts.getAll()).length);
            for (const r of rows) {
                const id = r.getAttribute("data-shortcut-id");
                const info = NP.shortcuts.getAll()[id];
                expect(r.querySelector(".shortcuts-row-label").textContent).toBe(t(info.labelKey));
                expect(r.querySelector(".shortcuts-row-key").textContent).toBe(info.current || "—");
                expect(t(info.categoryKey), id).toBeTruthy();
            }
            const cats = [...win.document.querySelectorAll("#shortcuts-body .shortcuts-category")].map((c) => c.textContent);
            expect(cats[0]).toBe(t("shortcuts.categories.formatting"));
        });
    }

    it("tooltips: the key a top-bar button and the ⋯ menu show is the current one", async () => {
        const app = await boot("rich");
        const { win, NP } = app;
        const ids = [...INDEX.matchAll(/data-shortcut="([\w-]+)"/g)].map((m) => m[1]);
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
            expect(NP.shortcuts.getAll()[id], id).toBeTruthy();
            const b = win.document.querySelector(`#top-tools [data-shortcut="${id}"]`);
            b.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
            expect(b.title).toContain(`(${NP.shortcuts.getCurrent(id)})`);
        }
        win.document.getElementById("btn-more").click();
        const focusItem = win.document.querySelector('.np-menu [data-id="focus"] .np-menu-keys');
        expect(focusItem.textContent).toBe("Ctrl+Shift+B");
    });

    for (const file of ["README.md", "README.cs.md"]) {
        it(`${file}: the key table matches`, async () => {
            const app = await boot("outside");
            const all = app.NP.shortcuts.getAll();
            const defaults = new Set(Object.values(all).map((i) => i.default).filter(Boolean));
            const md = fs.readFileSync(path.join(ROOT, file), "utf8");
            const table = md.split(/^\| (?:Shortcut|Zkratka) \|.*$/m)[1].split(/\r?\n\r?\n/)[0];
            const rows = [...table.matchAll(/^\| (`[^|]+) \| ([^|]+) \|\r?$/gm)];
            expect(rows.length).toBeGreaterThan(10);
            const extra = new Set(["Ctrl+Shift+V", "Ctrl+Mezerník"]);   // paste plain (no list entry); cs name of Space
            const keys = rows.flatMap((r) => [...r[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
            for (const k of keys) {
                const norm = k.replace("Ctrl+Mezerník", "Ctrl+Space");
                expect(defaults.has(norm) || extra.has(k), `${file}: ${k}`).toBe(true);
            }
            for (const id of ["md-bold", "md-italic", "fmt-underline", "md-strikethrough", "md-link", "toggle-sidebar"]) {
                expect(keys, `${file}: ${id}`).toContain(all[id].default);
            }
            const sidebarRow = rows.find((r) => r[1].includes("`Ctrl+Shift+B`"));
            expect(sidebarRow[2]).toMatch(file === "README.md" ? /Focus mode/ : /Režim soustředění/);
            const boldRow = rows.find((r) => r[1].startsWith("`Ctrl+B`"));
            expect(boldRow[2]).toMatch(file === "README.md" ? /^Bold/ : /^Tučné/);
        });
    }
});
