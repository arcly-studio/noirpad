import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { dangers, loadApp } from "./harness.js";

const FIX = path.resolve(import.meta.dirname, "fixtures/paste");
const fixture = (name) => fs.readFileSync(path.join(FIX, name), "utf8");
const IMG = "0f8e1c2a-1111-4222-8333-444455556666.png";

let win, editor;

beforeEach(() => {
    win = loadApp(["vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/utils.js",
        "js/syntax-highlight.js", "js/editor.js", "js/paste.js", "js/format.js", "js/shortcuts.js"]);
    editor = win.document.getElementById("editor");
    win.NP.editor.el = editor;
});

/* What the note stores after the paste: text + formats as {text, ...flags}. */
function stored() {
    const ed = win.NP.editor;
    const text = ed._htmlToTextWithImages().text;
    const runs = ed._extractFormats().map((f) => {
        const { start, end, ...rest } = f;
        return { text: text.slice(win.NP.lineColToOffset(text, start), win.NP.lineColToOffset(text, end)), ...rest };
    });
    return { text, runs };
}

function paste(html) {
    editor.replaceChildren(win.NP.paste.cleanHtml(html));
    return stored();
}

/* No look survives: no style/class attributes, no <span>/<font>. */
function expectNoLook() {
    for (const el of editor.querySelectorAll("*")) {
        if (el.tagName === "IMG" || el.closest("pre.np-code")) continue;
        expect(el.getAttribute("style"), el.outerHTML).toBeNull();
        expect(el.getAttribute("class"), el.outerHTML).toBeNull();
        expect(["SPAN", "FONT", "P", "DIV", "H1", "H2"]).not.toContain(el.tagName);
    }
}

function setCaret(node, offset) {
    const r = win.document.createRange();
    r.setStart(node, offset);
    r.collapse(true);
    const sel = win.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
}

function firePaste(data) {
    const ev = new win.Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "clipboardData", {
        value: { getData: (t) => data[t] || "", items: [] },
    });
    editor.dispatchEvent(ev);
    return ev;
}

describe("P1: pasted HTML keeps structure, not the source's look", () => {
    // Shape of Chromium's copy serialization of lipsum.com (live DOM values,
    // 2026-10-15): every block carries the page's colour, white background,
    // font and size inline.
    it("lipsum.com front page: no colour/background/font, bold only on <strong>", () => {
        const { text, runs } = paste(fixture("lipsum-home.html"));
        expect(text.startsWith("What is Lorem Ipsum?\n\nLorem Ipsum is simply dummy text")).toBe(true);
        expect(text.endsWith("versions of Lorem Ipsum.")).toBe(true);
        expect(runs).toEqual([{ text: "Lorem Ipsum", bold: true }]);
        expectNoLook();
    });

    it("lipsum.com generator: plain paragraphs, nothing bold", () => {
        const { text, runs } = paste(fixture("lipsum-generator.html"));
        expect(text).toBe(
            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer consequat eros in tellus interdum tempor.\n\n" +
            "Praesent sed lectus eget lectus vehicula laoreet eu et justo. Curabitur condimentum tincidunt laoreet.\n\n" +
            "In ultricies nisi sit amet blandit sagittis. Nam eget tellus ac magna mollis malesuada.");
        expect(runs).toEqual([]);
        expectNoLook();
    });

    // Real clipboard "HTML Format" from Microsoft Word (Office 16), 2026-10-15.
    it("Word: inline formats, link, bullet + numbered list, no colour/background", () => {
        const { text, runs } = paste(fixture("word.html"));
        expect(text).toBe(
            "Nadpis z Wordu\n\n" +
            "Obyčejný text, tučné slovo, kurzíva, podtržené, přeškrtnuté a červený Times 16. odkaz\n\n" +
            "• první odrážka\n• druhá odrážka\n1. číslovaná jedna\n2. číslovaná dvě\n\n" +
            "Odstavec se žlutým pozadím.");
        expect(runs).toEqual([
            { text: "Nadpis z Wordu", bold: true },
            { text: "tučné slovo", bold: true },
            { text: "kurzíva", italic: true },
            { text: "podtržené", underline: true },
            { text: "přeškrtnuté", strike: true },
            { text: "odkaz", link: "https://example.com/" },
        ]);
        expectNoLook();
    });

    // Google Docs: the whole fragment sits in <b style="font-weight:normal">.
    it("Google Docs: the <b font-weight:normal> wrapper is not bold", () => {
        const { text, runs } = paste(fixture("gdocs.html"));
        expect(text).toBe(
            "Nadpis z Google Docs\n\n" +
            "Běžný text, tučně, kurzívou, podtrženě, přeškrtnutě a červeně na žlutém. odkaz\n" +
            "• první položka\n• druhá položka\n\n" +
            "Poslední odstavec.");
        expect(runs).toEqual([
            { text: "tučně", bold: true },
            { text: "kurzívou", italic: true },
            { text: "podtrženě", underline: true },
            { text: "přeškrtnutě", strike: true },
            { text: "odkaz", link: "https://example.com/docs" },
        ]);
        expectNoLook();
    });

    it("bold from a block wrapper is not inherited; from an inline run it is", () => {
        const { runs } = paste(
            '<div style="font-weight:700;color:#000;background:#fff"><p>obyčejný <span style="font-weight:600">tučný</span></p></div>');
        expect(runs).toEqual([{ text: "tučný", bold: true }]);
    });

    it("an empty list item leaves no bullet on the next paragraph", () => {
        expect(paste("<ul><li>a</li><li></li></ul><p>x</p>").text).toBe("• a\n\nx");
    });

    it("drops <font>, classes and sizes, keeps their text", () => {
        const { text, runs } = paste('<font color="red" size="7" face="Arial">velký</font> <span class="x" style="font-size:40px">text</span>');
        expect(text).toBe("velký text");
        expect(runs).toEqual([]);
        expectNoLook();
    });

    it("unsafe links, scripts and foreign images are dropped; own images stay", () => {
        const { text } = paste(
            '<a href="javascript:alert(1)">klik</a><script>alert(1)</script>' +
            '<img src="https://evil.example/x.png" onerror="alert(1)">' +
            `<img src="http://127.0.0.1:8000/images/${IMG}" style="width:120px">` +
            '<img src="http://other.example/images/' + IMG + '">');
        expect(dangers(editor)).toEqual([]);
        expect(editor.querySelector("a")).toBeNull();
        expect(editor.querySelectorAll("img").length).toBe(1);
        expect(text).toBe(`klik<<IMG:${IMG}|w=120>>`);
    });

    it("bold / strike / link survive save + reload; a javascript: link does not render", () => {
        const fmts = [
            { start: "1.0", end: "1.4", bold: true },
            { start: "1.5", end: "1.9", strike: true },
            { start: "1.10", end: "1.15", link: "https://example.com/" },
            { start: "1.16", end: "1.19", link: "javascript:alert(1)" },
        ];
        win.NP.editor.renderContent(editor, "aaaa bbbb ccccc ddd", fmts);
        expect(editor.querySelector("strong").textContent).toBe("aaaa");
        expect(editor.querySelector("s").textContent).toBe("bbbb");
        expect(editor.querySelectorAll("a").length).toBe(1);
        expect(dangers(editor)).toEqual([]);
        expect(stored().runs).toEqual([
            { text: "aaaa", bold: true },
            { text: "bbbb", strike: true },
            { text: "ccccc", link: "https://example.com/" },
        ]);
    });
});

describe("paste event", () => {
    it("Ctrl+V with HTML inserts the cleaned content at the caret", () => {
        win.NP.paste.init();
        win.NP.editor.renderContent(editor, "AB", []);
        setCaret(editor.firstChild, 1);
        const ev = firePaste({
            "text/html": '<span style="color:rgb(0,0,0);background-color:rgb(255,255,255)">x<b>y</b></span>',
            "text/plain": "xy",
        });
        expect(ev.defaultPrevented).toBe(true);
        expect(stored()).toEqual({ text: "AxyB", runs: [{ text: "y", bold: true }] });
        expectNoLook();
    });

    it("Ctrl+Shift+V pastes plain text", () => {
        win.NP.paste.init();
        win.NP.editor.renderContent(editor, "", []);
        setCaret(editor, 0);
        editor.dispatchEvent(new win.KeyboardEvent("keydown", { key: "V", ctrlKey: true, shiftKey: true, bubbles: true }));
        firePaste({ "text/html": "<b>tučně</b><br>řádek", "text/plain": "tučně\r\nřádek" });
        expect(stored()).toEqual({ text: "tučně\nřádek", runs: [] });
    });
});

describe("clear formatting", () => {
    // 1.1.0: every format of the selection goes (before: bold and italic stayed)
    it("removes colour, font, size, bold and italic from the selection, nothing outside it", () => {
        win.NP.editor.renderContent(editor, "ahoj světe konec", [
            { start: "1.0", end: "1.10", color: "#000000", font: "Arial", size: 20 },
            { start: "1.0", end: "1.4", bold: true },
            { start: "1.5", end: "1.10", italic: true },
            { start: "1.11", end: "1.16", color: "#ff0000" },
        ]);
        const r = win.document.createRange();
        r.setStart(editor, 0);
        r.setEnd(editor, 3);   // "ahoj světe" (the black/Arial runs), not " konec"
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
        expect(win.NP.paste.clearFormatting()).toBe(true);
        const { text, runs } = stored();
        expect(text).toBe("ahoj světe konec");
        expect(runs).toEqual([
            { text: "konec", color: "rgb(255, 0, 0)" },
        ]);
    });

    it("keeps the line breaks at the edges of the selection", () => {
        win.NP.editor.renderContent(editor, "a\nbb\ncc", [{ start: "1.0", end: "3.2", color: "#000000" }]);
        const r = win.document.createRange();
        r.selectNodeContents(editor);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
        win.NP.paste.clearFormatting();
        expect(stored()).toEqual({ text: "a\nbb\ncc", runs: [] });

        win.NP.editor.renderContent(editor, "x\n\ny", [{ start: "1.0", end: "3.1", font: "Arial" }]);
        const span = editor.querySelector("span");      // "x"
        const r2 = win.document.createRange();
        r2.setStartAfter(span);                         // the two <br>s and "y"
        r2.setEnd(editor, editor.childNodes.length);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r2);
        win.NP.paste.clearFormatting();
        expect(stored().text).toBe("x\n\ny");
    });

    it("works after the command bar took the focus (saved selection)", () => {
        win.NP.paste.init();
        win.NP.editor.renderContent(editor, "barva", [{ start: "1.0", end: "1.5", color: "#000000" }]);
        const r = win.document.createRange();
        r.selectNodeContents(editor);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
        win.document.dispatchEvent(new win.Event("selectionchange"));
        // focus moves away: the selection is now in the title input
        const title = win.document.getElementById("note-title-input");
        const r2 = win.document.createRange();
        r2.selectNodeContents(title);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r2);
        win.document.dispatchEvent(new win.Event("selectionchange"));
        expect(win.NP.paste.clearFormatting()).toBe(true);
        expect(stored()).toEqual({ text: "barva", runs: [] });
    });

    it("a selection ending inside a code block takes the whole block, never duplicates it", () => {
        win.NP.editor.renderContent(editor, "text\n```js\nconst a = 1;\n```", [{ start: "1.0", end: "1.4", color: "#ff0000" }]);
        const code = editor.querySelector("pre.np-code code");
        const r = win.document.createRange();
        r.setStart(editor, 0);
        const tw = win.document.createTreeWalker(code, 4 /* text */);
        r.setEnd(tw.nextNode(), 2);
        win.getSelection().removeAllRanges();
        win.getSelection().addRange(r);
        win.NP.paste.clearFormatting();
        expect(editor.querySelectorAll("pre.np-code").length).toBe(1);
        expect(stored()).toEqual({ text: "text\n```js\nconst a = 1;\n```", runs: [] });
    });

    it("Ctrl+Space is a valid, recordable binding", () => {
        const ks = win.NP.shortcuts.eventToKeystroke({ ctrlKey: true, key: " " });
        expect(ks).toBe("Ctrl+Space");
        expect(win.NP.shortcuts.getCurrent("clear-formatting")).toBe("Ctrl+Space");
        expect(win.NP.shortcuts.validate(ks).ok).toBe(true);
    });
});

describe("G7: the editor context menu is the shared NP.menu", () => {
    it("right-click on a selection opens NP.menu with clear formatting and a hint", () => {
        const w = loadApp(["vendor/dompurify/purify.min.js", "js/utils.js", "js/topbar.js",
            "js/editor.js", "js/paste.js", "js/shortcuts.js"]);
        const ed = w.document.getElementById("editor");
        w.NP.editor.el = ed;
        w.NP.paste.init();
        w.NP.editor.renderContent(ed, "abc", []);
        const r = w.document.createRange();
        r.selectNodeContents(ed);
        w.getSelection().removeAllRanges();
        w.getSelection().addRange(r);
        ed.dispatchEvent(new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
        const menu = w.document.querySelector(".np-menu");
        expect([...menu.querySelectorAll(".np-menu-item")].map((b) => b.getAttribute("data-id")))
            .toEqual(["cut", "copy", "paste", "paste-plain", "clear"]);
        expect(menu.querySelector(".np-menu-footer").textContent).toContain("Shift");
    });
});
