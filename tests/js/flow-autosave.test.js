// 1.1.0: typing without a pause was saved only by the 30 s safety net (the save
// waited for a pause). Now at the latest 2 s after the first unsaved key, in
// rich text and Markdown, so a window that dies costs about a second of
// typing. Locked notes are re-encrypted on each of those saves, and after a
// restored window the last note opens again with a message.
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";
import { loadApp, locale } from "./harness.js";

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/links.js", "js/focus-mode.js", "js/encryption.js", "js/welcome.js", "js/auth.js", "js/app.js"];
const TREE = [{ id: "r", name: "Rich", type: "note" }, { id: "m", name: "Md", type: "note" },
    { id: "L", name: "Locked", type: "note" }];
const ENVELOPE = JSON.stringify({ encrypted: true, data: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(id) {
    const app = startApp({ tree: TREE, notes: { r: "x", m: "x", L: ENVELOPE }, modes: { m: "markdown" }, scripts: SCRIPTS, body: BODY });
    const { NP, win } = app;
    Object.defineProperty(win.HTMLElement.prototype, "innerText", {
        configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; },
    });
    NP.auth = { start() {} };
    NP.api.hasToken = () => true;
    NP.api.unlock = vi.fn(() => Promise.resolve({ content: "x", formats: [], unlock_token: "tok" }));
    NP.api.saveEncrypted = vi.fn(() => Promise.resolve({ ok: true }));
    NP.passwordDialog = { ask: vi.fn(() => Promise.resolve("heslo-dlouhe")) };
    NP.toast = vi.fn();
    await app.ready();
    await NP.tabs.add(id, TREE.find((t) => t.id === id).name);
    await flush();
    return app;
}

// Types one character every 150 ms, so there is never a pause of 800 ms.
async function typeFor(win, el, ms) {
    const end = Date.now() + ms;
    let n = 0;
    while (Date.now() < end) {
        if (el.tagName === "TEXTAREA") el.value += "a"; else el.append("a");
        el.dispatchEvent(new win.Event("input", { bubbles: true }));
        n++;
        await wait(150);
    }
    return n;
}

describe("autosave while typing without a pause", () => {
    it("rich text: saved at the latest 2 s after the first unsaved key", async () => {
        const { win, NP } = await boot("r");
        const ed = win.document.getElementById("editor");
        ed.setAttribute("contenteditable", "true");
        ed.contentEditable = "true";
        await typeFor(win, ed, 2600);
        expect(NP.api.saveNote).toHaveBeenCalledTimes(1);
        expect(NP.api.saveNote.mock.calls[0][1]).toMatch(/^xa{8,}/);
        await wait(1300);                               // the pause after the last key, as before
        expect(NP.api.saveNote).toHaveBeenCalledTimes(2);
    }, 10000);

    it("Markdown: the same", async () => {
        const { win, NP } = await boot("m");
        await typeFor(win, win.document.getElementById("editor-md"), 2600);
        expect(NP.api.saveNote).toHaveBeenCalledTimes(1);
        expect(NP.api.saveNote.mock.calls[0][1]).toMatch(/^xa{8,}/);
    }, 10000);

    it("a locked note: every one of those saves goes through the encryption, never a plain save", async () => {
        const { win, NP } = await boot("L");
        const ed = win.document.getElementById("editor");
        ed.contentEditable = "true";
        await typeFor(win, ed, 2600);
        await wait(1300);
        expect(NP.api.saveEncrypted.mock.calls.length).toBe(2);
        for (const call of NP.api.saveEncrypted.mock.calls) expect(call.slice(0, 2)).toEqual(["L", "tok"]);
        expect(NP.api.saveNote).not.toHaveBeenCalled();
    }, 10000);

    it("a single key still waits for the pause (1 s), one save", async () => {
        const { win, NP } = await boot("r");
        const ed = win.document.getElementById("editor");
        ed.contentEditable = "true";
        await typeFor(win, ed, 50);
        await wait(700);
        expect(NP.api.saveNote).not.toHaveBeenCalled();
        await wait(500);
        expect(NP.api.saveNote).toHaveBeenCalledTimes(1);
    });
});

describe("NP.debounce", () => {
    it("without a limit waits for the pause, with one never longer than that", async () => {
        const win = loadApp(["js/utils.js"]);
        const plain = vi.fn(), limited = vi.fn();
        const a = win.NP.debounce(plain, 100), b = win.NP.debounce(limited, 100, 250);
        for (let i = 0; i < 10; i++) { a(i); b(i); await wait(50); }
        expect(plain).not.toHaveBeenCalled();
        const during = limited.mock.calls.length;
        expect(during).toBeGreaterThanOrEqual(1);
        expect(during).toBeLessThanOrEqual(4);
        await wait(200);
        expect(plain).toHaveBeenCalledTimes(1);
        expect(limited.mock.calls.at(-1)).toEqual([9]);          // the last key is never lost
    });
});

describe("after the window was restored (notice view_restored)", () => {
    async function start(notice, recent) {
        const app = startApp({ tree: TREE, notes: { r: "saved text", m: "x", L: ENVELOPE }, scripts: SCRIPTS, body: BODY });
        const { NP, win } = app;
        const auth = NP.auth;
        NP.auth = { start() {} };
        NP.i18n.init = () => Promise.resolve();
        NP.toast = vi.fn();
        NP.dialog.alert = vi.fn(() => Promise.resolve());
        await app.ready();
        NP.state.data.recent_notes = recent;
        NP.app.init = () => Promise.resolve();
        NP.api.hasToken = () => false;
        NP.api.dismissNotice = vi.fn(() => Promise.resolve());
        NP.api.session = () => Promise.resolve({ mode: "desktop", authenticated: true, data_notice: notice, app_lock: {} });
        auth.start();
        await wait(500);
        await flush();
        return app;
    }
    const NOTICE = { code: "view_restored", params: {} };

    it("the last note opens with its saved text and a toast says what may be missing", async () => {
        const { win, NP } = await start(NOTICE, [{ id: "r", at: Date.now() }]);
        expect(NP.toast).toHaveBeenCalledWith(
            "The display was restored. The last second of typing may be missing.", expect.anything());
        expect(NP.dialog.alert).not.toHaveBeenCalled();
        expect(NP.state.activeTabId).toBe("r");
        expect(win.document.getElementById("editor").textContent).toBe("saved text");
        expect(NP.api.dismissNotice).toHaveBeenCalled();
    });

    it("no recent note: just the toast", async () => {
        const { NP } = await start(NOTICE, []);
        expect(NP.toast).toHaveBeenCalledTimes(1);
        expect(NP.state.activeTabId || null).toBeNull();
    });

    it("another notice opens nothing", async () => {
        const { NP } = await start({ code: "github_imported", params: {} }, [{ id: "r", at: Date.now() }]);
        expect(NP.state.activeTabId || null).toBeNull();
    });

    it("text in both languages", () => {
        expect(locale("en").notice.view_restored).toBe("The display was restored. The last second of typing may be missing.");
        expect(locale("cs").notice.view_restored).toBe("Zobrazení bylo obnoveno. Mohla chybět poslední sekunda psaní.");
    });
});
