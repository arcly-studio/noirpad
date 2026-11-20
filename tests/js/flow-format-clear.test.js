// 1.1.0 manual test: "Clear formatting" (Format menu, Ctrl+Space, context
// menu) over a selection with bold, italic, underline and a link left them
// all. It now removes every format of the selection, links included, also
// when the selection starts or ends inside a formatted run; text outside
// the selection keeps its formats, a code block stays as it is.
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/focus-mode.js", "js/encryption.js", "js/app.js"];
const TOOLS = `<div id="top-tools">
  <button class="tb-btn" id="btn-format" type="button" data-label="ui.topBar.format" aria-haspopup="menu" aria-expanded="false" disabled></button>
  <button class="tb-btn" id="btn-md-toggle" type="button" data-label="ui.topBar.markdown"></button>
</div>`;
const ENVELOPE = JSON.stringify({ encrypted: true, data: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
const TREE = [{ id: "r", name: "Rich", type: "note" }, { id: "L", name: "Locked", type: "note" }];
const MIXED = '<b>alfa beta</b> <i>gama</i> <u>delta</u> <a href="https://example.org/x">epsilon zeta</a>' +
    ' <span style="color: red; font-family: serif">omega</span>';

async function boot(id, html = MIXED) {
    const app = startApp({ tree: TREE, notes: { r: "x", L: ENVELOPE }, scripts: SCRIPTS, body: TOOLS + BODY });
    const { NP } = app;
    NP.auth = { start() {} };
    NP.api.hasToken = () => true;
    NP.toast = vi.fn();
    NP.passwordDialog = { ask: vi.fn(() => Promise.resolve("heslo-dlouhe")) };
    NP.api.unlock = vi.fn(() => Promise.resolve({ content: "x", formats: [], unlock_token: "tok" }));
    NP.api.saveEncrypted = vi.fn(() => Promise.resolve({ ok: true }));
    await app.ready();
    NP.app.bindKeys();
    NP.markdown.registerShortcuts();
    NP.shortcuts.init();
    NP.topbar.init();
    NP.paste.init();
    await NP.tabs.add(id, TREE.find((t) => t.id === id).name);
    await flush();
    const ed = app.win.document.getElementById("editor");
    ed.setAttribute("contenteditable", ed.contentEditable);
    ed.innerHTML = html;
    ed.dispatchEvent(new app.win.Event("input", { bubbles: true }));
    return app;
}

function textNode(win, text) {
    const ed = win.document.getElementById("editor");
    const walker = win.document.createTreeWalker(ed, 4);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.data.indexOf(text);
        if (i !== -1) return [n, i];
    }
    throw new Error("not found: " + text);
}

/* From *a* (offset *ai* in the text node holding it) to *b*. */
function select(win, a, ai, b, bi) {
    const ed = win.document.getElementById("editor");
    ed.focus();
    const [na, ia] = textNode(win, a);
    const [nb, ib] = textNode(win, b);
    const r = win.document.createRange();
    r.setStart(na, ia + ai);
    r.setEnd(nb, ib + bi);
    win.getSelection().removeAllRanges();
    win.getSelection().addRange(r);
}

/* The formats around each character of *text*. */
function formatsOf(win, text) {
    const ed = win.document.getElementById("editor");
    const [n, i] = textNode(win, text);
    const out = new Set();
    for (let p = n.parentNode; p && p !== ed; p = p.parentNode) {
        if (/^(B|STRONG)$/.test(p.nodeName)) out.add("bold");
        if (/^(I|EM)$/.test(p.nodeName)) out.add("italic");
        if (p.nodeName === "U") out.add("underline");
        if (/^(S|STRIKE|DEL)$/.test(p.nodeName)) out.add("strike");
        if (p.nodeName === "A") out.add("link");
        if (p.nodeName === "SPAN" && p.getAttribute("style")) out.add("style");
    }
    expect(n.data.slice(i, i + text.length)).toBe(text);
    return [...out].sort();
}

const ctrlSpace = (win) => win.document.getElementById("editor").dispatchEvent(
    new win.KeyboardEvent("keydown", { key: " ", code: "Space", ctrlKey: true, bubbles: true, cancelable: true }));

function expectCleared(win) {
    // inside the selection: nothing
    for (const t of ["beta", "gama", "delta", "epsilon"]) expect(formatsOf(win, t)).toEqual([]);
    // outside: as before (the run was split at the selection's edges)
    expect(formatsOf(win, "alfa")).toEqual(["bold"]);
    expect(formatsOf(win, "zeta")).toEqual(["link"]);
    expect(formatsOf(win, "omega")).toEqual(["style"]);
    expect(win.document.getElementById("editor").textContent)
        .toBe("alfa beta gama delta epsilon zeta omega");
    expect(win.getSelection().toString()).toBe("beta gama delta epsilon");
}

describe("Clear formatting removes every format of the selection", () => {
    it("Format menu: from the middle of a bold run to the middle of a link", async () => {
        const { win, NP } = await boot("r");
        select(win, "alfa beta", 5, "epsilon zeta", 7);
        win.document.getElementById("btn-format").click();
        win.document.querySelector('.np-menu [data-id="clear-formatting"]').click();
        expectCleared(win);
        await NP.editor.save();
        const formats = NP.api.saveNote.mock.calls.at(-1)[2];
        // only "alfa " bold, " zeta" link and "eta" coloured stay
        expect(formats.filter((f) => f.bold)).toEqual([expect.objectContaining({ start: "1.0", end: "1.5" })]);
        expect(formats.filter((f) => f.italic || f.underline || f.strike)).toEqual([]);
        expect(formats.filter((f) => f.link)).toEqual([expect.objectContaining({ start: "1.28", end: "1.33" })]);
    });

    it("Ctrl+Space does the same", async () => {
        const { win } = await boot("r");
        select(win, "alfa beta", 5, "epsilon zeta", 7);
        ctrlSpace(win);
        expectCleared(win);
    });

    it("context menu: Clear formatting does the same", async () => {
        const { win } = await boot("r");
        select(win, "alfa beta", 5, "epsilon zeta", 7);
        win.document.getElementById("editor").dispatchEvent(
            new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
        win.document.querySelector('.np-menu [data-id="clear"]').click();
        expectCleared(win);
    });

    it("a selection inside one run: the run is split, the middle loses every format", async () => {
        const { win } = await boot("r", '<a href="https://example.org/"><b><i>one two three</i></b></a>');
        select(win, "one two three", 4, "one two three", 7);
        ctrlSpace(win);
        expect(formatsOf(win, "one")).toEqual(["bold", "italic", "link"]);
        expect(formatsOf(win, "two")).toEqual([]);
        expect(formatsOf(win, "three")).toEqual(["bold", "italic", "link"]);
        expect(win.getSelection().toString()).toBe("two");
        // no empty leftovers
        expect([...win.document.querySelectorAll("#editor b, #editor i, #editor a")]
            .filter((e) => e.textContent === "")).toEqual([]);
    });

    it("a code block in the selection stays as it is", async () => {
        const html = '<b>bold</b><br><pre class="np-code" contenteditable="false"><span class="tok-lang">js</span>let a = 1;</pre><br><i>after</i>';
        const { win } = await boot("r", html);
        select(win, "bold", 0, "after", 5);
        ctrlSpace(win);
        expect(formatsOf(win, "bold")).toEqual([]);
        expect(formatsOf(win, "after")).toEqual([]);
        const pre = win.document.querySelector("#editor pre.np-code");
        expect(pre.outerHTML).toBe('<pre class="np-code" contenteditable="false"><span class="tok-lang">js</span>let a = 1;</pre>');
    });

    it("an unlocked locked note: cleared and saved encrypted", async () => {
        const { win, NP } = await boot("L");
        const ed = win.document.getElementById("editor");
        ed.setAttribute("contenteditable", "true");
        ed.innerHTML = MIXED;
        ed.dispatchEvent(new win.Event("input", { bubbles: true }));
        select(win, "alfa beta", 5, "epsilon zeta", 7);
        ctrlSpace(win);
        expectCleared(win);
        expect(NP.editor._unlockToken).toBe("tok");
        await NP.editor.save();
        const call = NP.api.saveEncrypted.mock.calls.at(-1);
        expect(call[2]).toBe("alfa beta gama delta epsilon zeta omega");
        expect(call[3].filter((f) => f.italic || f.underline || f.strike)).toEqual([]);
        expect(call[3].filter((f) => f.bold)).toEqual([expect.objectContaining({ start: "1.0", end: "1.5" })]);
    });
});
