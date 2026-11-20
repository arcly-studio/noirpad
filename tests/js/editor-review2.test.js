// Review 2, editor: E5 (a picture into the note it was pasted in), E6 (a
// locked Markdown note's text gone from the underlay), E7 (Clear formatting
// at a code block keeps the line breaks), E11 (a linked picture keeps its
// link), E13 (an HTML paste never falls through uncleaned), E14 (lock icon).
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";
import { flush, startApp } from "./flow.js";

const IMG = "0f8e1c2a-1111-4222-8333-444455556666.png";
const MD = ["vendor/markdown-it/markdown-it.min.js", "vendor/markdown-it-task-lists/markdown-it-task-lists.min.js",
    "vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/syntax-highlight.js",
    "js/md-source.js", "js/markdown.js"];
const TREE = [{ id: "A", name: "Alpha", type: "note" }, { id: "B", name: "Beta", type: "note" }];

describe("a pasted picture goes into the note it was pasted into (E5)", () => {
    it("a tab switch during the upload does not put it into the next note", async () => {
        const a = startApp({ tree: TREE, notes: { A: "text of A", B: "text of B" }, scripts: ["js/images.js"] });
        await a.ready();
        a.NP.toast = vi.fn();
        await a.open("A");
        let finish;
        a.NP.api.uploadImage = vi.fn(() => new Promise((r) => { finish = r; }));
        const up = a.NP.images.upload(new a.win.Blob(["x"], { type: "image/png" }));
        await a.NP.tabs.activate("B");
        finish({ url: "/images/" + IMG, filename: IMG });
        await up;
        await flush();
        expect(a.NP.editor.el.querySelector("img")).toBeNull();
        expect(a.NP.toast).toHaveBeenCalledWith(a.NP.t("images.notInserted"));
        await a.NP.editor.save(true);
        expect(a.srv.notes.B).toBe("text of B");
    });
});

describe("leaving a Markdown note empties the coloured source copy (E6)", () => {
    async function mdOpen() {
        const body = '<div id="tab-bar"></div><div id="tree-container"></div><input id="note-title-input">' +
            '<div id="editor" contenteditable="false"></div><div id="md-stack"><div id="md-source">' +
            '<div id="md-highlight"></div><textarea id="editor-md"></textarea></div><div id="md-preview"></div></div>' +
            '<div id="status-label"></div><div id="mode-label"></div>';
        const a = startApp({ tree: TREE, notes: { A: "# Secret plan\nsecret text", B: "plain B" },
            modes: { A: "markdown" }, scripts: MD, body });
        a.win.requestAnimationFrame = (fn) => setTimeout(fn, 0);
        await a.ready();
        await a.open("A");
        a.NP.mdSource.refresh();
        expect(a.win.document.getElementById("md-highlight").textContent).toContain("secret text");
        return a;
    }

    it("the lock screen (lock / auto-lock)", async () => {
        const a = await mdOpen();
        a.NP.editor._showLockScreen();
        expect(a.win.document.getElementById("md-highlight").textContent).toBe("");
        await flush(5);   // a render that was already scheduled does not bring it back
        expect(a.win.document.getElementById("md-highlight").textContent).toBe("");
    });

    it("another (rich-text) note", async () => {
        const a = await mdOpen();
        await a.NP.tabs.activate("B");
        await flush(5);
        expect(a.win.document.getElementById("md-highlight").textContent).not.toContain("secret");
    });
});

describe("Clear formatting next to a code block (E7, E11)", () => {
    function setup() {
        const win = loadApp(["vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/utils.js",
            "js/syntax-highlight.js", "js/editor.js", "js/paste.js", "js/format.js", "js/shortcuts.js"]);
        const ed = win.document.getElementById("editor");
        win.NP.editor.el = ed;
        win.NP.editor.renderContent(ed, "intro\n```js\nx=1\n```\nafter more\nend", []);
        ed.contentEditable = "true";
        /* What Chrome's insertHTML is asked to replace: the selection then. */
        const replaced = [];
        win.document.execCommand = () => {
            const r = win.getSelection().getRangeAt(0);
            replaced.push({ first: r.startContainer.childNodes[r.startOffset],
                last: r.endContainer.childNodes[r.endOffset - 1] });
            return false;                               // the range fallback does the work
        };
        return { win, ed, replaced };
    }
    const select = (win, set) => {
        const r = win.document.createRange();
        set(r);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
    };

    it("a selection starting at the block takes the line break before it", () => {
        const { win, ed, replaced } = setup();
        const pre = ed.querySelector("pre");
        select(win, (r) => { r.setStartBefore(pre); r.setEnd(ed.lastChild, ed.lastChild.length); });
        win.NP.paste.clearFormatting();
        expect(replaced[0].first.tagName).toBe("BR");
        expect(win.NP.editor._htmlToTextWithImages().text).toBe("intro\n```js\nx=1\n```\nafter more\nend");
    });

    it("a selection ending at the block takes the line break after it", () => {
        const { win, ed, replaced } = setup();
        const pre = ed.querySelector("pre");
        select(win, (r) => { r.setStart(ed.firstChild, 2); r.setEndAfter(pre); });
        win.NP.paste.clearFormatting();
        expect(replaced[0].last.tagName).toBe("BR");
        expect(win.NP.editor._htmlToTextWithImages().text).toBe("intro\n```js\nx=1\n```\nafter more\nend");
    });

    it("a linked picture keeps its link (E11)", () => {
        const { win } = setup();
        const frag = win.NP.paste.cleanHtml(`<a href="https://example.com/"><img src="/images/${IMG}"></a>`);
        const a = frag.querySelector("a");
        expect(a && a.getAttribute("href")).toBe("https://example.com/");
        expect(a.querySelector("img")).not.toBeNull();
    });
});

describe("an HTML paste is always handled by NoirPad (E13)", () => {
    it("HTML that cleans down to nothing is not left to the browser", () => {
        const win = loadApp(["vendor/dompurify/purify.min.js", "js/utils.js", "js/editor.js", "js/paste.js"]);
        const ed = win.document.getElementById("editor");
        win.NP.editor.el = ed;
        win.NP.paste.init();
        const ev = new win.Event("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clipboardData", {
            value: { getData: (t) => (t === "text/html" ? '<img src="https://evil.example/x.png">' : ""), items: [] },
        });
        ed.dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
        expect(ed.querySelector("img")).toBeNull();
    });
});

describe("the lock icon in the tree (E14)", () => {
    it("only for a real encryption envelope, not for a note that says {\"encrypted\": true}", async () => {
        const env = JSON.stringify({ encrypted: true, data: "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=" });
        const a = startApp({ tree: TREE, notes: { A: '{"encrypted": true}', B: env } });
        await a.ready();
        a.NP.state.data.notes = { A: '{"encrypted": true}', B: env };
        a.NP.tree.render();
        const lock = (id) => !!a.win.document.querySelector(`.tree-item[data-id="${id}"] .tree-badge`);
        expect(lock("A")).toBe(false);
        expect(lock("B")).toBe(true);
    });
});
