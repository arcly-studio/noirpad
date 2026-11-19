// N1.11 manual test: Ctrl+B in a rich-text note turned focus mode on instead
// of bold, Ctrl+K did nothing. Now the formatting keys work in rich-text and
// Markdown notes alike (format.js), focus mode is Ctrl+Shift+B, and a key the
// user already gave another action wins over the new default.
import { describe, expect, it } from "vitest";
import { flush, startApp } from "./flow.js";

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/focus-mode.js", "js/app.js"];
const TREE = [{ id: "r", name: "Rich", type: "note" }, { id: "m", name: "Md", type: "note" }];

export async function boot({ custom } = {}) {
    const app = startApp({ tree: TREE, notes: { r: "hello world", m: "hello world" },
        modes: { m: "markdown" }, scripts: SCRIPTS });
    const { win, NP } = app;
    NP.auth = { start() {} };          // app.js starts the app on DOMContentLoaded
    NP.api.hasToken = () => true;
    NP.api.saveSettings = () => Promise.resolve({});
    NP.toast = () => {};
    await app.ready();
    if (custom) NP.state.data.custom_shortcuts = custom;
    NP.app.bindKeys();
    NP.markdown.registerShortcuts();
    NP.shortcuts.init();
    return app;
}

export function key(win, keyName, mods = {}) {
    const target = win.document.activeElement || win.document.body;
    const ev = new win.KeyboardEvent("keydown", { key: keyName, ctrlKey: true, bubbles: true, cancelable: true, ...mods });
    target.dispatchEvent(ev);
    return ev;
}

/* Select *text* in the rich-text editor and give it the focus. */
export function selectText(win, text) {
    const ed = win.document.getElementById("editor");
    ed.focus();
    const walker = win.document.createTreeWalker(ed, 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(text);
        if (i === -1) continue;
        const r = win.document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + text.length);
        const sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        return r;
    }
    throw new Error("not found: " + text);
}

export function selectInSource(win, text) {
    const ta = win.document.getElementById("editor-md");
    ta.focus();
    const i = ta.value.indexOf(text);
    ta.setSelectionRange(i, i + text.length);
    return ta;
}

const lastFormats = (NP) => NP.api.saveNote.mock.calls.at(-1)[2];

describe("formatting keys (N1.11)", () => {
    it("Ctrl+B in a rich-text note makes the selection bold, saved as a format; focus mode stays off", async () => {
        const { win, NP } = await boot();
        await NP.tabs.add("r", "Rich");
        await flush();
        selectText(win, "world");
        expect(key(win, "b").defaultPrevented).toBe(true);
        expect(NP.focusMode.active).toBe(false);
        expect(win.document.querySelector("#editor b").textContent).toBe("world");
        await NP.editor.save();
        expect(lastFormats(NP)).toEqual([{ bold: true, start: "1.6", end: "1.11" }]);
        // again: off
        selectText(win, "world");
        key(win, "b");
        expect(win.document.querySelector("#editor b")).toBeNull();
    });

    it("Ctrl+I, Ctrl+U, Ctrl+Shift+X: italic, underline, strikethrough", async () => {
        const { win, NP } = await boot();
        await NP.tabs.add("r", "Rich");
        await flush();
        selectText(win, "hello");
        key(win, "i");
        selectText(win, "hello");
        key(win, "u");
        selectText(win, "hello");
        key(win, "X", { shiftKey: true });
        await NP.editor.save();
        const f = lastFormats(NP);
        expect(f.some((x) => x.italic)).toBe(true);
        expect(f.some((x) => x.underline)).toBe(true);
        expect(f.some((x) => x.strike)).toBe(true);
        expect(f.every((x) => x.start === "1.0" && x.end === "1.5")).toBe(true);
    });

    it("Ctrl+Shift+B is focus mode; Ctrl+B outside the editor does nothing", async () => {
        const { win, NP } = await boot();
        await NP.tabs.add("r", "Rich");
        await flush();
        win.document.activeElement.blur();
        expect(key(win, "B", { shiftKey: true }).defaultPrevented).toBe(true);
        expect(NP.focusMode.active).toBe(true);
        expect(win.document.getElementById("focus-mode-exit-btn").title).toBe("Exit focus mode (Ctrl+Shift+B)");
        key(win, "B", { shiftKey: true });
        expect(NP.focusMode.active).toBe(false);
        expect(key(win, "b").defaultPrevented).toBe(false);
        expect(NP.focusMode.active).toBe(false);
    });

    it("Ctrl+K opens the link window; a bare address gets https:// offered; edit and remove", async () => {
        const { win, NP } = await boot();
        await NP.tabs.add("r", "Rich");
        await flush();
        selectText(win, "world");
        key(win, "k");
        const dlg = win.document.querySelector(".np-link-dialog");
        expect(dlg).not.toBeNull();
        expect(dlg.getAttribute("role")).toBe("dialog");
        const input = dlg.querySelector("#np-link-url");
        expect(win.document.activeElement).toBe(input);
        input.value = "example.org";
        dlg.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
        expect(dlg.querySelector(".np-link-error").textContent).toContain("https://");
        expect(input.getAttribute("aria-invalid")).toBe("true");
        dlg.querySelector(".np-link-fix").click();
        expect(input.value).toBe("https://example.org");
        dlg.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
        await flush();
        expect(win.document.querySelector(".np-link-dialog")).toBeNull();
        const a = win.document.querySelector("#editor a");
        expect(a.getAttribute("href")).toBe("https://example.org");
        expect(a.textContent).toBe("world");
        await NP.editor.save();
        expect(lastFormats(NP)).toEqual([{ link: "https://example.org", start: "1.6", end: "1.11" }]);

        // caret inside the link: edit
        selectText(win, "wor").collapse(true);
        key(win, "k");
        let d2 = win.document.querySelector(".np-link-dialog");
        expect(d2.querySelector("#np-link-url").value).toBe("https://example.org");
        d2.querySelector("#np-link-url").value = "mailto:a@b.cz";
        d2.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
        await flush();
        expect(win.document.querySelector("#editor a").getAttribute("href")).toBe("mailto:a@b.cz");

        // and remove
        selectText(win, "wor").collapse(true);
        key(win, "k");
        d2 = win.document.querySelector(".np-link-dialog");
        d2.querySelector(".np-link-remove").click();
        await flush();
        expect(win.document.querySelector("#editor a")).toBeNull();
        expect(win.document.getElementById("editor").textContent).toBe("hello world");
    });

    it("the link window refuses other schemes and closes with Escape without a change", async () => {
        const { win, NP } = await boot();
        await NP.tabs.add("r", "Rich");
        await flush();
        selectText(win, "world");
        key(win, "k");
        const dlg = win.document.querySelector(".np-link-dialog");
        const input = dlg.querySelector("#np-link-url");
        for (const bad of ["javascript:alert(1)", "", "https://", "ftp://x.cz", "mailto:nobody"]) {
            input.value = bad;
            dlg.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
            expect(win.document.querySelector(".np-link-dialog")).not.toBeNull();
            expect(dlg.querySelector(".np-link-error").textContent).not.toBe("");
        }
        input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await flush();
        expect(win.document.querySelector(".np-link-dialog")).toBeNull();
        expect(win.document.querySelector("#editor a")).toBeNull();
        // the selection is back in the editor
        expect(win.getSelection().toString()).toBe("world");
    });

    it("Markdown note: the same keys write the syntax", async () => {
        const { win, NP } = await boot();
        await NP.tabs.add("m", "Md");
        await flush();
        const ta = selectInSource(win, "world");
        key(win, "b");
        expect(ta.value).toBe("hello **world**");
        selectInSource(win, "hello");
        key(win, "X", { shiftKey: true });
        expect(ta.value).toBe("~~hello~~ **world**");
        selectInSource(win, "world");
        key(win, "k");
        expect(ta.value).toContain("[world](url)");
        expect(win.document.querySelector(".np-link-dialog")).toBeNull();
        const before = ta.value;
        expect(key(win, "u").defaultPrevented).toBe(true);
        expect(ta.value).toBe(before);
        expect(NP.focusMode.active).toBe(false);
    });

    it("a key the user gave another action wins over the new default", async () => {
        const { win, NP } = await boot({ custom: { "find-all": "Ctrl+Shift+B" } });
        expect(NP.shortcuts.getCurrent("toggle-sidebar")).toBe("");
        expect(NP.shortcuts.getCurrent("find-all")).toBe("Ctrl+Shift+B");
        let opened = 0;
        NP.findAll = { show: () => { opened++; } };
        win.document.activeElement.blur();
        key(win, "B", { shiftKey: true });
        expect(opened).toBe(1);
        expect(NP.focusMode.active).toBe(false);
    });

    it("an own key for focus mode stays", async () => {
        const { NP } = await boot({ custom: { "toggle-sidebar": "Ctrl+Alt+F" } });
        expect(NP.shortcuts.getCurrent("toggle-sidebar")).toBe("Ctrl+Alt+F");
        expect(NP.shortcuts.getCurrent("md-bold")).toBe("Ctrl+B");
    });
});
