// The start page (welcome.js): actions with the current shortcuts, RECENT
// notes (persisted as a setting), keyboard, and user data via textContent.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dangers, loadApp } from "./harness.js";

const ID = (n) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const DAY = 86400000;
let win;
let saved;

function setup(data = {}) {
    win = loadApp(["js/utils.js", "js/topbar.js", "js/shortcuts.js", "js/welcome.js"], {
        body: '<div id="editor"></div>' });
    saved = [];
    win.NP.appInfo = { version: "9.8.7" };
    win.NP.state = {
        data: {
            tree: [
                { id: "f", name: "Folder", type: "folder", children: [
                    { id: ID(1), name: "Alpha", type: "note" },
                    { id: ID(2), name: '<img src=x onerror="alert(1)">', type: "note" },
                ] },
                { id: ID(3), name: "Secret", type: "note" },
                { id: ID(4), name: "Delta", type: "note" },
            ],
            notes: { [ID(3)]: "NPENC1:abc" },
            favorites: [ID(1)],
            trash: { tree: [{ id: ID(9), name: "Gone", type: "note" }], notes: {} },
            ...data,
        },
    };
    win.NP.isEncryptedEnvelope = (c) => String(c).startsWith("NPENC1:");
    win.NP.encryption = { isEncrypted: (id) => win.NP.isEncryptedEnvelope(win.NP.state.data.notes[id] || "") };
    win.NP.api = { saveSettings: vi.fn((s) => { saved.push(s); return Promise.resolve({}); }) };
    win.NP.tabs = { add: vi.fn() };
}

const ed = () => win.document.getElementById("editor");
const render = () => win.NP.welcome.render(ed());
const rows = () => [...ed().querySelectorAll(".welcome-row")];
const labels = () => rows().map((r) => r.querySelector(".welcome-row-label").textContent);

describe("start page", () => {
    beforeEach(() => setup());

    it("header: decorative logo, name, tagline with the API version", () => {
        render();
        const logo = ed().querySelector("img.welcome-icon");
        expect(logo.getAttribute("src")).toBe("/static/img/noirpad-icon.svg");
        expect(logo.classList.contains("np-decorative")).toBe(true);
        expect(logo.getAttribute("aria-hidden")).toBe("true");
        expect(ed().querySelector(".welcome-logo").textContent).toBe("NoirPad");
        expect(ed().querySelector(".welcome-tagline").textContent).toBe("your dark notebook · v9.8.7");
        expect(ed().querySelector(".welcome-foot").textContent).toBe("F1 help");
        expect(ed().querySelector(".welcome-by")).toBeNull();      // no author / url from the API
    });

    it("\"by <author>\" links to the project page as a plain anchor (links.js opens it)", () => {
        win.NP.appInfo = { version: "9.8.7", url: "https://github.com/arcly-studio/noirpad", author: "Arcly Studio" };
        render();
        const a = ed().querySelector(".welcome-by a");
        expect(a.textContent).toBe("by Arcly Studio");
        expect(a.getAttribute("href")).toBe("https://github.com/arcly-studio/noirpad");
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toBe("noopener noreferrer");
        expect(rows().includes(a)).toBe(false);                      // not part of the keyboard list
    });

    it("four actions with the shortcut from the registry (also after a remap)", () => {
        render();
        expect(labels()).toEqual(["New note", "New folder", "Search notes", "Commands"]);
        const kbd = (i) => [...rows()[i].querySelectorAll("kbd")].map((k) => k.textContent).join("+");
        expect([0, 1, 2, 3].map(kbd)).toEqual(["Ctrl+Shift+N", "Ctrl+Shift+F", "Ctrl+Shift+K", "Ctrl+Shift+P"]);
        win.NP.shortcuts.setCurrent("find-all", "Ctrl+Alt+F");
        render();
        expect(kbd(2)).toBe("Ctrl+Alt+F");
    });

    it("a shortcut on the plus key: Ctrl++ = Ctrl and +", () => {
        win.NP.shortcuts.setCurrent("new-note", "Ctrl++");
        render();
        expect([...rows()[0].querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "+"]);
    });

    it("an action row runs its shortcut handler", () => {
        const h = vi.fn();
        win.NP.shortcuts.register("find-all", h);
        render();
        rows()[2].click();
        expect(h).toHaveBeenCalledTimes(1);
    });

    it("no recent notes: no RECENT section", () => {
        render();
        expect(ed().querySelector(".welcome-section")).toBeNull();
        expect(rows()).toHaveLength(4);
    });

    it("RECENT: 3 newest, skips trashed/deleted, ★ for favourites, lock for locked, dates", () => {
        const now = Date.now();
        win.NP.state.data.recent_notes = [
            { id: ID(9), at: now },              // in the trash
            { id: "deleted", at: now },          // gone
            { id: ID(1), at: now },
            { id: ID(3), at: now - DAY },
            { id: ID(2), at: now - 40 * DAY },
            { id: ID(4), at: now - 50 * DAY },   // 4th: not shown
        ];
        render();
        expect(ed().querySelector(".welcome-section").textContent).toBe("Recent");
        expect(labels().slice(4)).toEqual(["Alpha", "Secret", '<img src=x onerror="alert(1)">']);
        const recent = rows().slice(4);
        expect(recent[0].querySelector(".welcome-star")).not.toBeNull();
        expect(recent[1].querySelector(".welcome-star")).toBeNull();
        expect(recent[0].querySelector(".welcome-date").textContent).toBe("today");
        expect(recent[1].querySelector(".welcome-date").textContent).toBe("yesterday");
        expect(recent[1].classList.contains("welcome-row--locked")).toBe(true);
        expect(recent[1].querySelector("use").getAttribute("href")).toContain("#i-lock");
        expect(recent[0].querySelector("use").getAttribute("href")).toContain("#i-file-text");
        expect(dangers(ed())).toEqual([]);
        expect(ed().querySelectorAll("img")).toHaveLength(1);       // only the logo
    });

    it("a recent row opens the note in a tab", () => {
        win.NP.state.data.recent_notes = [{ id: ID(4), at: Date.now() }];
        render();
        rows()[4].click();
        expect(win.NP.tabs.add).toHaveBeenCalledWith(ID(4), "Delta");
    });

    it("dates further back: day and month in the UI language", () => {
        const now = new Date(2026, 9, 16, 12);
        expect(win.NP.welcome._relativeDate(new Date(2026, 9, 16, 1).getTime(), now)).toBe("today");
        expect(win.NP.welcome._relativeDate(new Date(2026, 9, 15, 23).getTime(), now)).toBe("yesterday");
        expect(win.NP.welcome._relativeDate(new Date(2026, 9, 2).getTime(), now)).toMatch(/Oct/);
        expect(win.NP.welcome._relativeDate(new Date(2025, 0, 2).getTime(), now)).toMatch(/2025/);
    });
});

describe("noteOpened (RECENT list in the settings)", () => {
    beforeEach(() => setup());

    it("newest first, no duplicates, saved as a setting", () => {
        win.NP.welcome.noteOpened(ID(1));
        win.NP.welcome.noteOpened(ID(4));
        win.NP.welcome.noteOpened(ID(1));
        const list = win.NP.state.data.recent_notes;
        expect(list.map((r) => r.id)).toEqual([ID(1), ID(4)]);
        expect(typeof list[0].at).toBe("number");
        expect(saved.at(-1)).toEqual({ recent_notes: list });
    });

    it("re-opening the newest note right away writes nothing", () => {
        win.NP.welcome.noteOpened(ID(1));
        win.NP.welcome.noteOpened(ID(1));
        expect(saved).toHaveLength(1);
        win.NP.state.data.recent_notes[0].at -= 11 * 60 * 1000;   // a while later: the time is updated
        win.NP.welcome.noteOpened(ID(1));
        expect(saved).toHaveLength(2);
    });

    it("the locked note's row says so to a screen reader", () => {
        win.NP.state.data.recent_notes = [{ id: ID(3), at: Date.now() }, { id: ID(1), at: Date.now() }];
        render();
        expect(rows()[4].getAttribute("aria-label")).toBe("Secret, locked, today");
        expect(rows()[5].getAttribute("aria-label")).toBe("Alpha, Favorite, today");
    });

    it("at most 10 entries; trashed / deleted ones are dropped", () => {
        const tree = Array.from({ length: 12 }, (_, n) => ({ id: ID(100 + n), name: `N${n}`, type: "note" }));
        setup({ tree, recent_notes: [{ id: ID(9), at: 1 }, { id: "deleted", at: 1 }] });
        tree.forEach((n) => win.NP.welcome.noteOpened(n.id));
        const ids = win.NP.state.data.recent_notes.map((r) => r.id);
        expect(ids).toHaveLength(10);
        expect(ids[0]).toBe(ID(111));
        expect(ids).not.toContain(ID(9));
        expect(ids).not.toContain("deleted");
    });

    it("ignores folders, unknown ids and notes in the trash", () => {
        ["f", "nope", ID(9)].forEach((id) => win.NP.welcome.noteOpened(id));
        expect(win.NP.state.data.recent_notes).toBeUndefined();
        expect(saved).toEqual([]);
    });
});

describe("keyboard", () => {
    beforeEach(() => {
        setup({ recent_notes: [{ id: ID(4), at: Date.now() }] });
        win.NP.welcome.render(ed(), { focus: true });
    });
    const key = (k) => win.document.activeElement.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

    it("without opts.focus the page leaves the focus alone (e.g. after a delete in the tree)", () => {
        win.document.body.focus();
        render();
        expect(win.document.activeElement).not.toBe(rows()[0]);
    });

    it("starts on the first row; Up / Down move (and wrap)", () => {
        expect(win.document.activeElement).toBe(rows()[0]);
        key("ArrowDown");
        expect(win.document.activeElement).toBe(rows()[1]);
        key("ArrowUp");
        key("ArrowUp");
        expect(win.document.activeElement).toBe(rows()[4]);
        key("ArrowDown");
        expect(win.document.activeElement).toBe(rows()[0]);
    });

    it("Enter runs the focused row", () => {
        rows()[4].focus();
        key("Enter");
        expect(win.NP.tabs.add).toHaveBeenCalledWith(ID(4), "Delta");
    });
});
