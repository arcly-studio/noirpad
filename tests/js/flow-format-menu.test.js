// N1.11: formatting without shortcuts. The Formatting menu in the top bar
// (next to Markdown) lists every format the open note's editor has, with the
// current keys; the context menu over selected text has the inline formats.
// Rich text: on the selection, saved as formats; Markdown: the syntax.
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/focus-mode.js", "js/encryption.js", "js/app.js"];
const TOOLS = `<div id="top-tools">
  <button class="tb-btn" id="btn-md-toggle" type="button" data-label="ui.topBar.markdown"></button>
  <button class="tb-btn" id="btn-format" type="button" data-label="ui.topBar.format" aria-haspopup="menu" aria-expanded="false" disabled></button>
  <button class="tb-btn" id="btn-lock" type="button" data-label="ui.topBar.lock"></button>
</div>`;
const ENVELOPE = JSON.stringify({ encrypted: true, data: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
const TREE = [{ id: "r", name: "Rich", type: "note" }, { id: "m", name: "Md", type: "note" },
    { id: "L", name: "Locked", type: "note" }];

async function boot(id) {
    const app = startApp({ tree: TREE, notes: { r: "hello world", m: "hello world", L: ENVELOPE },
        modes: { m: "markdown" }, scripts: SCRIPTS, body: TOOLS + BODY });
    const { NP } = app;
    NP.auth = { start() {} };
    NP.api.hasToken = () => true;
    NP.api.saveSettings = () => Promise.resolve({});
    NP.toast = vi.fn();
    NP.passwordDialog = { ask: vi.fn(() => Promise.resolve("heslo-dlouhe")) };
    NP.api.unlock = vi.fn(() => Promise.resolve({ content: "hello world", formats: [], unlock_token: "tok" }));
    NP.api.saveEncrypted = vi.fn(() => Promise.resolve({ ok: true }));
    await app.ready();
    NP.app.bindKeys();
    NP.markdown.registerShortcuts();
    NP.shortcuts.init();
    NP.topbar.init();
    NP.paste.init();
    await NP.tabs.add(id, TREE.find((t) => t.id === id).name);
    await flush();
    // jsdom does not reflect el.contentEditable (editor.js) into the attribute paste.js reads
    const ed = app.win.document.getElementById("editor");
    ed.setAttribute("contenteditable", ed.contentEditable);
    return app;
}

function selectText(win, text) {
    const ed = win.document.getElementById("editor");
    ed.focus();
    const walker = win.document.createTreeWalker(ed, 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(text);
        if (i === -1) continue;
        const r = win.document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + text.length);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
        return r;
    }
    throw new Error("not found: " + text);
}

function selectInSource(win, text) {
    const ta = win.document.getElementById("editor-md");
    ta.focus();
    const i = ta.value.indexOf(text);
    ta.setSelectionRange(i, i + text.length);
    return ta;
}

const btn = (win) => win.document.getElementById("btn-format");
const menu = (win) => win.document.querySelector(".np-menu");
const item = (win, id) => menu(win).querySelector(`[data-id="${id}"]`);
const ids = (win) => [...menu(win).querySelectorAll(".np-menu-item")].map((b) => b.getAttribute("data-id"));
const keysOf = (win, id) => item(win, id).querySelector(".np-menu-keys")?.textContent || "";
const press = (win, key) => win.document.activeElement.dispatchEvent(
    new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
const openMenu = (win) => { btn(win).click(); return menu(win); };

describe("Formatting menu in the top bar", () => {
    it("rich-text note: the formats with their current keys; without a selection they are off", async () => {
        const { win, NP } = await boot("r");
        expect(btn(win).disabled).toBe(false);
        win.document.getElementById("editor").focus();
        win.getSelection().removeAllRanges();
        const m = openMenu(win);
        expect(m.getAttribute("role")).toBe("menu");
        expect(m.getAttribute("aria-label")).toBe("Formatting");
        expect(btn(win).getAttribute("aria-expanded")).toBe("true");
        expect(ids(win)).toEqual(["md-bold", "md-italic", "fmt-underline", "md-strikethrough", "md-link", "clear-formatting"]);
        expect(keysOf(win, "md-bold")).toBe("Ctrl+B");
        expect(keysOf(win, "md-italic")).toBe("Ctrl+I");
        expect(keysOf(win, "fmt-underline")).toBe("Ctrl+U");
        expect(keysOf(win, "md-strikethrough")).toBe("Ctrl+Shift+X");
        expect(keysOf(win, "md-link")).toBe("Ctrl+K");
        expect(keysOf(win, "clear-formatting")).toBe("Ctrl+Space");
        for (const b of m.querySelectorAll(".np-menu-item")) expect(b.disabled).toBe(true);
        expect(item(win, "md-bold").getAttribute("role")).toBe("menuitemcheckbox");
        expect(item(win, "md-bold").getAttribute("aria-checked")).toBe("false");
        // the key shown follows the shortcut list
        NP.menu.close();
        NP.shortcuts.setCurrent("md-bold", "Ctrl+Alt+B");
        openMenu(win);
        expect(keysOf(win, "md-bold")).toBe("Ctrl+Alt+B");
    });

    it("keyboard: arrows and Enter format the selection, the focus and selection go back to the editor", async () => {
        const { win, NP } = await boot("r");
        selectText(win, "world");
        btn(win).focus();
        openMenu(win);
        expect(win.document.activeElement).toBe(item(win, "md-bold"));
        press(win, "ArrowDown");
        expect(win.document.activeElement.getAttribute("data-id")).toBe("md-italic");
        press(win, "ArrowUp");
        win.document.activeElement.click();         // Enter on a <button> = click
        expect(menu(win)).toBeNull();
        expect(win.document.activeElement.id).toBe("editor");
        expect(win.getSelection().toString()).toBe("world");
        expect(win.document.querySelector("#editor b").textContent).toBe("world");
        // shown as on, and off again from the menu
        openMenu(win);
        expect(item(win, "md-bold").getAttribute("aria-checked")).toBe("true");
        expect(item(win, "md-italic").getAttribute("aria-checked")).toBe("false");
        item(win, "md-strikethrough").click();
        await NP.editor.save();
        const formats = NP.api.saveNote.mock.calls.at(-1)[2];
        expect(formats).toEqual(expect.arrayContaining([
            expect.objectContaining({ bold: true, start: "1.6", end: "1.11" }),
            expect.objectContaining({ strike: true, start: "1.6", end: "1.11" })]));
    });

    it("Escape closes the menu and gives the editor its selection back", async () => {
        const { win } = await boot("r");
        selectText(win, "hello");
        openMenu(win);
        expect(win.document.activeElement).toBe(item(win, "md-bold"));
        press(win, "Escape");
        expect(menu(win)).toBeNull();
        expect(win.document.activeElement.id).toBe("editor");
        expect(win.getSelection().toString()).toBe("hello");
        expect(btn(win).getAttribute("aria-expanded")).toBe("false");
    });

    it("Link… opens the link window for the selection", async () => {
        const { win } = await boot("r");
        selectText(win, "hello");
        openMenu(win);
        item(win, "md-link").click();
        const dlg = win.document.querySelector(".np-link-dialog");
        expect(dlg).not.toBeNull();
        dlg.querySelector("#np-link-url").value = "https://example.org/f2";
        dlg.querySelector("form").dispatchEvent(new win.Event("submit", { cancelable: true }));
        await flush();
        expect(win.document.querySelector("#editor a").getAttribute("href")).toBe("https://example.org/f2");
        expect(win.document.querySelector("#editor a").textContent).toBe("hello");
    });

    it("Markdown note: every Markdown format, the syntax goes into the source", async () => {
        const { win } = await boot("m");
        expect(btn(win).disabled).toBe(false);
        const ta = selectInSource(win, "world");
        openMenu(win);
        expect(ids(win)).toEqual(["md-bold", "md-italic", "md-strikethrough", "md-code-inline", "md-link", "md-image",
            "md-h1", "md-h2", "md-h3", "md-quote", "md-list-bullet", "md-list-numbered", "md-task",
            "md-code-block", "md-horizontal-rule"]);
        expect(keysOf(win, "md-code-inline")).toBe("Ctrl+E");
        expect(keysOf(win, "md-code-block")).toBe("Ctrl+Shift+E");
        expect(keysOf(win, "md-h1")).toBe("");
        for (const b of menu(win).querySelectorAll(".np-menu-item")) expect(b.disabled).toBe(false);
        expect(item(win, "md-bold").getAttribute("role")).toBe("menuitem");
        item(win, "md-bold").click();
        expect(ta.value).toBe("hello **world**");
        expect(win.document.activeElement).toBe(ta);
        openMenu(win);
        item(win, "md-h1").click();
        expect(ta.value).toBe("# hello **world**");
        openMenu(win);
        item(win, "md-task").click();
        expect(ta.value).toBe("- [ ] # hello **world**");
        selectInSource(win, "hello");
        openMenu(win);
        item(win, "md-code-inline").click();
        expect(ta.value).toBe("- [ ] # `hello` **world**");
    });

    it("an unlocked locked note: formats from the menu are saved encrypted like the rest", async () => {
        const { win, NP } = await boot("L");
        expect(NP.editor._unlockToken).toBe("tok");
        expect(btn(win).disabled).toBe(false);
        selectText(win, "hello");
        openMenu(win);
        item(win, "md-italic").click();
        await NP.editor.save();
        const call = NP.api.saveEncrypted.mock.calls.at(-1);
        expect(call[2]).toBe("hello world");
        expect(call[3]).toEqual([{ italic: true, start: "1.0", end: "1.5" }]);
    });

    it("no note open for editing: the button is off", async () => {
        const { win, NP } = await boot("r");
        expect(btn(win).disabled).toBe(false);
        const ed = win.document.getElementById("editor");
        ed.contentEditable = "false";
        ed.setAttribute("contenteditable", "false");
        NP.topbar.refresh();
        expect(btn(win).disabled).toBe(true);
    });
});

describe("context menu over selected text", () => {
    const rightClick = (win, el, init = {}) => {
        const ev = new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10, ...init });
        el.dispatchEvent(ev);
        return ev;
    };

    it("rich text: the old items stay, the formats come between them", async () => {
        const { win, NP } = await boot("r");
        selectText(win, "world");
        expect(rightClick(win, win.document.getElementById("editor")).defaultPrevented).toBe(true);
        expect(ids(win)).toEqual(["cut", "copy", "paste", "paste-plain",
            "md-bold", "md-italic", "fmt-underline", "md-strikethrough", "md-link", "clear"]);
        expect(keysOf(win, "md-bold")).toBe("Ctrl+B");
        item(win, "fmt-underline").click();
        expect(win.document.querySelector("#editor u").textContent).toBe("world");
        // Shift+right-click: the system menu
        NP.menu.close();
        selectText(win, "hello");
        expect(rightClick(win, win.document.getElementById("editor"), { shiftKey: true }).defaultPrevented).toBe(false);
        expect(menu(win)).toBeNull();
    });

    it("Markdown source: cut / copy / paste and the inline formats", async () => {
        const { win } = await boot("m");
        const ta = selectInSource(win, "world");
        expect(rightClick(win, ta).defaultPrevented).toBe(true);
        expect(ids(win)).toEqual(["cut", "copy", "paste", "md-bold", "md-italic", "md-strikethrough", "md-code-inline", "md-link"]);
        expect(menu(win).querySelector(".np-menu-footer").textContent).toBe("Shift+right-click: system menu");
        item(win, "md-strikethrough").click();
        expect(ta.value).toBe("hello ~~world~~");
        // no selection or Shift: the system menu
        ta.setSelectionRange(2, 2);
        expect(rightClick(win, ta).defaultPrevented).toBe(false);
        ta.setSelectionRange(0, 5);
        expect(rightClick(win, ta, { shiftKey: true }).defaultPrevented).toBe(false);
    });
});
