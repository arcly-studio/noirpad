import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dangers, loadApp } from "./harness.js";

let win, preview;

function render(src) {
    win.NP.markdown.renderInto(preview, src);
    preview.dispatchEvent(new win.CustomEvent("np-md-rendered", { bubbles: true }));
    return preview;
}

beforeEach(() => {
    win = loadApp(["vendor/markdown-it/markdown-it.min.js", "vendor/markdown-it-task-lists/markdown-it-task-lists.min.js", "vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/utils.js", "js/syntax-highlight.js", "js/markdown.js"]);
    preview = win.document.getElementById("md-preview");
});

describe("markdown preview", () => {
    it("renders headings, emphasis and lists", () => {
        render("# Nadpis\n\n**tučně** a *kurzíva*\n\n- jedna\n- dvě");
        expect(preview.querySelector("h1, .md-h1").textContent).toContain("Nadpis");
        expect(preview.querySelector("strong, .md-bold").textContent).toContain("tučně");
        expect(preview.querySelector("em, .md-italic").textContent).toContain("kurzíva");
        expect(preview.textContent).toContain("jedna");
        expect(preview.textContent).toContain("dvě");
    });

    it("keeps the code-block contract used by syntax-highlight.js", () => {
        render("```python\nprint('<b>')\n```");
        const block = preview.querySelector(".md-codeblock");
        expect(block.getAttribute("data-lang")).toBe("python");
        expect(block.textContent).toContain("print('<b>')");
        expect(block.querySelector("b")).toBeNull();
    });

    it("highlights code blocks with highlight.js", () => {
        render("```python\ndef f():\n    return 'x'\n```");
        const block = preview.querySelector(".md-codeblock");
        expect(block.classList.contains("hljs")).toBe(true);
        expect(block.querySelector(".hljs-keyword").textContent).toBe("def");
        expect(dangers(preview)).toEqual([]);
    });

    it("renders safe links and images", () => {
        render("[web](https://example.com) ![obr](/images/0f8e1c2a-1111-4222-8333-444455556666.png)");
        expect(preview.querySelector("a").getAttribute("href")).toBe("https://example.com");
        expect(preview.querySelector("img").getAttribute("src"))
            .toBe("/images/0f8e1c2a-1111-4222-8333-444455556666.png");
    });

    it("shows remote images as text (the CSP would block them anyway)", () => {
        render("![logo](https://example.com/logo.png)");
        expect(preview.querySelector("img")).toBeNull();
        expect(preview.textContent).toContain("![logo](https://example.com/logo.png)");
    });

    it("escapes raw HTML", () => {
        render('<img src=x onerror=alert(1)>\n<script>alert(1)</script>\n<svg onload=alert(1)>');
        expect(dangers(preview)).toEqual([]);
    });
});

describe("audit regressions", () => {
    // K3 – stored XSS v markdown náhledu: regexy běží nad hotovým HTML
    it("K3: nested image/link payload does not create event handlers", () => {
        render("![a]([z](onerror=onerror=alert;throw-1 x) y)");
        expect(dangers(preview)).toEqual([]);
        expect(preview.querySelectorAll("img").length).toBeLessThanOrEqual(1);
        for (const img of preview.querySelectorAll("img")) {
            expect(img.getAttribute("src")).not.toMatch(/[<>"]/);
        }
    });

    // K4 – javascript:/data:/file: odkazy se nesmí vykreslit jako odkaz
    it.each([
        "[x](javascript:alert(1))",
        "[x](JaVaScRiPt:alert(1))",
        "[x](data:text/html,<script>alert(1)</script>)",
        "[x](file:///C:/Windows/win.ini)",
        "[x](vbscript:msgbox)",
        "[x](notes/relative.html)",
        "![x](javascript:alert(1))",
    ])("K4: %s is not a live link", (src) => {
        render(src);
        expect(dangers(preview)).toEqual([]);
        for (const a of preview.querySelectorAll("a[href]")) {
            expect(a.getAttribute("href")).toMatch(/^(https?:|mailto:|\/images\/)/i);
        }
        for (const img of preview.querySelectorAll("img[src]")) {
            expect(img.getAttribute("src")).toMatch(/^(https?:|\/images\/|data:image\/)/i);
        }
    });

    it("renders task lists as read-only checkboxes", () => {
        render("- [ ] koupit mléko\n- [x] hotovo\n- obyčejná položka");
        const boxes = preview.querySelectorAll("input");
        expect(boxes.length).toBe(2);
        for (const box of boxes) {
            expect(box.type).toBe("checkbox");
            expect(box.disabled).toBe(true);
        }
        expect(boxes[0].checked).toBe(false);
        expect(boxes[1].checked).toBe(true);
        expect(preview.textContent).toContain("koupit mléko");
        expect(dangers(preview)).toEqual([]);
    });

    it("never lets a real form control through the sanitizer", () => {
        const html = win.NP.sanitizeHtml('<input type="text" name="pw" value="x" autofocus><button>b</button>');
        const box = win.document.createElement("div");
        box.innerHTML = html;
        const input = box.querySelector("input");
        expect(input.type).toBe("checkbox");
        expect(input.disabled).toBe(true);
        expect(input.hasAttribute("name") || input.hasAttribute("value")).toBe(false);
        expect(box.querySelector("button")).toBeNull();
    });
});

describe("Ctrl+M on a locked note (K2)", () => {
    function setup(encrypted, token) {
        const calls = [];
        win.NP.state = { currentNoteId: "n1", data: { note_modes: {} } };
        win.NP.editor = {
            _currentNoteId: "n1", _loadedNoteId: "n1",
            _currentNoteEncrypted: encrypted, _unlockToken: token,
            _htmlToTextWithImages: () => ({ text: "tajný text" }), _extractFormats: () => [],
        };
        win.NP.api = {
            saveNote: (...a) => { calls.push(["saveNote", ...a]); return Promise.resolve({}); },
            saveEncrypted: (...a) => { calls.push(["saveEncrypted", ...a]); return Promise.resolve({}); },
        };
        win.NP.dialog = { failed: () => {} };
        win.document.getElementById("editor-md").value = "tajný text";
        return calls;
    }

    it("an unlocked locked note is re-encrypted, never saved as plain text", () => {
        const calls = setup(true, "tok");
        win.NP.markdown.toggleForCurrentNote();
        expect(calls.map((c) => c[0])).toEqual(["saveEncrypted"]);
        expect(calls[0][1]).toBe("n1");
        expect(calls[0][2]).toBe("tok");
        expect(calls[0][5]).toEqual({ mode: "markdown" });
    });

    it("a locked note without its key is not switched at all", () => {
        const calls = setup(true, null);
        win.NP.markdown.toggleForCurrentNote();
        expect(calls).toEqual([]);
        expect(win.NP.state.data.note_modes.n1).toBeUndefined();
    });

    it("a plain note is saved normally", () => {
        const calls = setup(false, null);
        win.NP.markdown.toggleForCurrentNote();
        expect(calls.map((c) => c[0])).toEqual(["saveNote"]);
    });
});

describe("locking a note that is open in Markdown (K3)", () => {
    function openLockedInMarkdown() {
        win.eval(fs.readFileSync(path.resolve(import.meta.dirname, "../../static/js/editor.js"), "utf8"));
        win.NP.state = { currentNoteId: "n1", data: { tree: [], note_modes: { n1: "markdown" } } };
        win.NP.editor.init();
        win.NP.editor._currentNoteId = "n1";
        win.NP.editor._currentNoteEncrypted = true;
        win.NP.editor._unlockToken = "tok";
        win.NP.markdown.enableForEditor("# Deník\nTAJNÝ TEXT");
    }

    it("the lock screen hides the Markdown source and preview too", () => {
        openLockedInMarkdown();
        expect(win.document.body.classList.contains("editor-md-active")).toBe(true);
        expect(win.document.getElementById("editor-md").value).toContain("TAJNÝ TEXT");
        win.NP.editor._showLockScreen();
        expect(win.document.body.classList.contains("editor-md-active")).toBe(false);
        expect(win.document.getElementById("editor-md").value).toBe("");
        expect(win.document.getElementById("md-preview").textContent).not.toContain("TAJNÝ TEXT");
        expect(win.document.body.textContent).not.toContain("TAJNÝ TEXT");
    });
});

describe("opening a locked note from a Markdown note (K3)", () => {
    it("the previous note's source is gone while the password is asked", async () => {
        win.eval(fs.readFileSync(path.resolve(import.meta.dirname, "../../static/js/editor.js"), "utf8"));
        win.NP.state = { data: { tree: [], note_modes: { a: "markdown" } } };
        win.NP.editor.init();
        win.NP.markdown.enableForEditor("PŘEDCHOZÍ POZNÁMKA");
        win.NP.api = { getNote: () => Promise.resolve({ content: '{"encrypted": true, "data": "x"}', formats: [] }) };
        win.NP.encryption = { askAndUnlock: () => new Promise(() => {}), updateLockButtonState: () => {} };
        win.NP.editor.loadNote("locked");
        await new Promise((r) => setTimeout(r, 0));
        expect(win.document.getElementById("editor-md").value).toBe("");
        expect(win.document.body.textContent).not.toContain("PŘEDCHOZÍ POZNÁMKA");
    });
});

describe("status bar counts in Markdown mode (D1)", () => {
    it("counts the Markdown source, also while typing", async () => {
        win.document.body.insertAdjacentHTML("beforeend",
            '<span id="char-count"></span><span id="word-count"></span><span id="line-count"></span>');
        win.eval(fs.readFileSync(path.resolve(import.meta.dirname, "../../static/js/editor.js"), "utf8"));
        win.NP.state = { currentNoteId: "n1", data: { tree: [], note_modes: {} } };
        win.NP.editor.init();
        win.NP.editor._currentNoteId = "n1";
        win.NP.editor._loadedNoteId = "n1";
        win.NP.editor.el.contentEditable = "true";
        win.NP.api = { saveNote: () => Promise.resolve({}) };
        win.NP.markdown.toggleForCurrentNote();          // → Markdown, empty note
        const ta = win.document.getElementById("editor-md");
        ta.value = "hello brave new world";
        ta.dispatchEvent(new win.Event("input", { bubbles: true }));
        await vi.waitFor(() => expect(win.document.getElementById("char-count").textContent).toBe("21 chars"),
            { timeout: 3000, interval: 25 });
        expect(win.document.getElementById("word-count").textContent).toBe("4 words");
        win.NP.markdown.toggleForCurrentNote();          // back to rich text keeps the count
        expect(win.document.getElementById("char-count").textContent).toBe("21 chars");
    });
});

describe("Ctrl+Shift+E code block (C13)", () => {
    function run(value, start, end) {
        const ta = win.document.getElementById("editor-md");
        ta.value = value;
        ta.setSelectionRange(start, end);
        return ta;
    }

    it("wraps the selected lines and keeps them selected", () => {
        win.document.body.classList.add("editor-md-active");
        const ta = run("intro\nprint(1)\nprint(2)\nend", 6, 23);
        win.NP.markdown._insertCodeBlock(ta);
        expect(ta.value).toBe("intro\n```\nprint(1)\nprint(2)\n```\n\nend");
        expect(ta.value.substring(ta.selectionStart, ta.selectionEnd)).toBe("print(1)\nprint(2)");
    });

    it("without a selection inserts an empty block with the caret inside", () => {
        const ta = run("abc", 3, 3);
        win.NP.markdown._insertCodeBlock(ta);
        expect(ta.value).toBe("abc\n```\n\n```\n");
        expect(ta.selectionStart).toBe(8);
    });
});
