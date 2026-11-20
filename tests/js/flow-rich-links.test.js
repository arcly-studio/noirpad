// 1.1.0 manual test: a link in a rich-text note "could not be used" - the
// pointer over it showed nothing, a click only placed the caret, and in the
// green default theme it had the text colour. Now: a tooltip with the address and
// "Ctrl+click opens the link" (pointer over the link or the caret in it),
// Ctrl+click opens it (https/http/mailto only, links.js), a plain click
// still edits, the hand cursor while Ctrl is held, and Open / Edit… /
// Remove in the context menu over a link, also in an unlocked locked note.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/links.js", "js/focus-mode.js", "js/encryption.js", "js/app.js"];
const TOOLS = `<div id="top-tools">
  <button class="tb-btn" id="btn-format" type="button" data-label="ui.topBar.format" aria-haspopup="menu" aria-expanded="false" disabled></button>
  <button class="tb-btn" id="btn-md-toggle" type="button" data-label="ui.topBar.markdown"></button>
</div>`;
const ENVELOPE = JSON.stringify({ encrypted: true, data: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
const TREE = [{ id: "r", name: "Rich", type: "note" }, { id: "L", name: "Locked", type: "note" }];
const URL = "https://example.org/a?q=<b>x</b>";
const HTML = `see <a href="${URL.replace(/</g, "&lt;").replace(/>/g, "&gt;")}">the docs</a> and <a href="javascript:alert(1)">bad</a> end`;
const CSS = fs.readFileSync(path.resolve(import.meta.dirname, "../../static/css/noirpad.css"), "utf8");

async function boot(id) {
    const app = startApp({ tree: TREE, notes: { r: "x", L: ENVELOPE }, scripts: SCRIPTS, body: TOOLS + BODY });
    const { NP, win } = app;
    // jsdom has no isContentEditable (links.js: a plain click in the note only edits)
    Object.defineProperty(win.HTMLElement.prototype, "isContentEditable", {
        configurable: true,
        get() { const h = this.closest("[contenteditable]"); return !!h && h.getAttribute("contenteditable") === "true"; },
    });
    NP.auth = { start() {} };
    NP.api.hasToken = () => true;
    NP.toast = vi.fn();
    NP.passwordDialog = { ask: vi.fn(() => Promise.resolve("heslo-dlouhe")) };
    NP.api.unlock = vi.fn(() => Promise.resolve({ content: "x", formats: [], unlock_token: "tok" }));
    NP.api.saveEncrypted = vi.fn(() => Promise.resolve({ ok: true }));
    win.open = vi.fn(() => null);
    await app.ready();
    NP.app.bindKeys();
    NP.markdown.registerShortcuts();
    NP.shortcuts.init();
    NP.topbar.init();
    NP.paste.init();
    await NP.tabs.add(id, TREE.find((t) => t.id === id).name);
    await flush();
    const ed = win.document.getElementById("editor");
    ed.setAttribute("contenteditable", "true");
    ed.innerHTML = HTML;
    ed.dispatchEvent(new win.Event("input", { bubbles: true }));
    return app;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const link = (win) => win.document.querySelector("#editor a[href^='https']");
const tip = (win) => win.document.getElementById("np-link-tip");
const menu = (win) => win.document.querySelector(".np-menu");
const ids = (win) => [...menu(win).querySelectorAll(".np-menu-item")].map((b) => b.getAttribute("data-id"));
const item = (win, id) => menu(win).querySelector(`[data-id="${id}"]`);
const keysOf = (win, id) => item(win, id).querySelector(".np-menu-keys")?.textContent || "";

function caretIn(win, node, offset) {
    win.document.getElementById("editor").focus();
    const r = win.document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    win.getSelection().removeAllRanges();
    win.getSelection().addRange(r);
    win.document.dispatchEvent(new win.Event("selectionchange"));
}

function rightClick(win, target, opts = {}) {
    const e = new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5, ...opts });
    target.dispatchEvent(e);
    return e;
}

describe("links in a rich-text note", () => {
    it("pointer over a link: a tooltip with the address (as text) and how to open it", async () => {
        const { win } = await boot("r");
        const a = link(win);
        a.firstChild.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
        expect(tip(win)).toBeNull();                 // not at once: no flicker while moving over text
        await wait(450);
        const t = tip(win);
        expect(t).not.toBeNull();
        expect(t.getAttribute("role")).toBe("tooltip");
        expect(t.querySelector(".np-link-tip-url").textContent).toBe(URL);
        expect(t.querySelector("b")).toBeNull();     // the address is text, never markup
        expect(t.querySelector(".np-link-tip-hint").textContent).toBe("Ctrl+click opens the link");
        a.dispatchEvent(new win.MouseEvent("mouseout", { bubbles: true, relatedTarget: win.document.getElementById("editor") }));
        expect(tip(win)).toBeNull();
        // a javascript: link is no link here: no tooltip
        win.document.querySelector("#editor a[href^='javascript']")
            .dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
        await wait(450);
        expect(tip(win)).toBeNull();
    });

    it("the caret in a link shows the tooltip too (keyboard), leaving it hides it", async () => {
        const { win } = await boot("r");
        caretIn(win, link(win).firstChild, 2);
        await wait(450);
        expect(tip(win).querySelector(".np-link-tip-url").textContent).toBe(URL);
        caretIn(win, win.document.getElementById("editor").firstChild, 1);
        expect(tip(win)).toBeNull();
    });

    it("Ctrl+click opens the address outside the app, a plain click only edits", async () => {
        const { win } = await boot("r");
        const a = link(win);
        const plain = new win.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
        a.dispatchEvent(plain);
        expect(win.open).not.toHaveBeenCalled();
        a.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
        expect(win.open).toHaveBeenCalledWith(URL, "_blank", "noopener,noreferrer");
        win.open.mockClear();
        win.document.querySelector("#editor a[href^='javascript']")
            .dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
        expect(win.open).not.toHaveBeenCalled();
    });

    it("Ctrl held: the hand cursor over links", async () => {
        const { win } = await boot("r");
        const body = win.document.body;
        win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Control", ctrlKey: true, bubbles: true }));
        expect(body.classList.contains("np-ctrl-down")).toBe(true);
        win.document.dispatchEvent(new win.KeyboardEvent("keyup", { key: "Control", bubbles: true }));
        expect(body.classList.contains("np-ctrl-down")).toBe(false);
        expect(CSS).toMatch(/body\.np-ctrl-down #editor a\[href\] \{\s*cursor: pointer;/);
    });

    it("its own colour: --link, not the text colour, in the note and in the Markdown preview", () => {
        const rule = (sel) => CSS.match(new RegExp(sel.replace(/[.[\]#]/g, "\\$&") + " \\{([^}]*)\\}"))[1];
        expect(rule("#editor a[href]")).toMatch(/color: var\(--link\)/);
        expect(rule("#md-preview .md-link")).toMatch(/color: var\(--link\)/);
    });

    it("context menu over a link without a selection: Open, Edit…, Remove", async () => {
        const { win, NP } = await boot("r");
        const a = link(win);
        caretIn(win, a.firstChild, 1);
        const e = rightClick(win, a.firstChild);
        expect(e.defaultPrevented).toBe(true);
        expect(ids(win)).toEqual(["link-open", "link-edit", "link-remove"]);
        expect(keysOf(win, "link-open")).toBe("Ctrl+click");
        expect(keysOf(win, "link-edit")).toBe("Ctrl+K");
        // the caret in the link must not bring the tooltip back under the menu
        caretIn(win, a.firstChild, 2);
        await wait(450);
        expect(tip(win)).toBeNull();
        item(win, "link-open").click();
        expect(win.open).toHaveBeenCalledWith(URL, "_blank", "noopener,noreferrer");

        // Edit…: the link window with the address, saved to the link
        rightClick(win, a.firstChild);
        item(win, "link-edit").click();
        await flush();
        const input = win.document.getElementById("np-link-url");
        expect(input.value).toBe(URL);
        expect(win.document.getElementById("np-link-title").textContent).toBe("Edit link");
        input.value = "mailto:test@example.org";
        win.document.querySelector(".np-link-dialog form").dispatchEvent(
            new win.Event("submit", { bubbles: true, cancelable: true }));
        await flush();
        expect(link(win)).toBeNull();
        expect(win.document.querySelector("#editor a[href='mailto:test@example.org']").textContent).toBe("the docs");

        // Remove: the text stays, the link goes
        const m = win.document.querySelector("#editor a[href^='mailto']");
        rightClick(win, m.firstChild);
        item(win, "link-remove").click();
        expect(win.document.querySelector("#editor a[href^='mailto']")).toBeNull();
        expect(win.document.getElementById("editor").textContent).toBe("see the docs and bad end");
        await NP.editor.save();
        expect(NP.api.saveNote.mock.calls.at(-1)[2].filter((f) => f.link)).toEqual([]);
    });

    it("with a selection over a link: the link items first, then the usual ones; Shift: the system menu", async () => {
        const { win } = await boot("r");
        const a = link(win);
        win.document.getElementById("editor").focus();
        const r = win.document.createRange();
        r.selectNodeContents(a);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
        rightClick(win, a.firstChild);
        expect(ids(win).slice(0, 4)).toEqual(["link-open", "link-edit", "link-remove", "cut"]);
        win.NP.menu.close();
        expect(rightClick(win, a.firstChild, { shiftKey: true }).defaultPrevented).toBe(false);
        // no link, no selection: the system menu as before
        caretIn(win, win.document.getElementById("editor").firstChild, 1);
        expect(rightClick(win, win.document.getElementById("editor")).defaultPrevented).toBe(false);
    });

    it("an unlocked locked note: tooltip and context menu work the same", async () => {
        const { win, NP } = await boot("L");
        expect(NP.editor._unlockToken).toBe("tok");
        const a = link(win);
        a.firstChild.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
        await wait(450);
        expect(tip(win).querySelector(".np-link-tip-url").textContent).toBe(URL);
        caretIn(win, a.firstChild, 1);
        rightClick(win, a.firstChild);
        item(win, "link-remove").click();
        expect(link(win)).toBeNull();
        await NP.editor.save();
        const call = NP.api.saveEncrypted.mock.calls.at(-1);
        expect(call[3].filter((f) => f.link)).toEqual([]);
    });
});
