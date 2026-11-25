// Review 2, speed: R3 (thousands of formats), R4 (a huge Markdown
// paragraph), R5 (find-all while typing, the coloured Markdown source).
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

/* The previous implementations, as the reference for the new ones. */
function oldLineColToOffset(text, lineCol) {
    const [l, c] = lineCol.split(".");
    const line = parseInt(l, 10), col = parseInt(c, 10);
    const lines = text.split("\n");
    let offset = 0;
    for (let i = 0; i < line - 1 && i < lines.length; i++) offset += lines[i].length + 1;
    return offset + col;
}
function oldOffsetToLineCol(text, offset) {
    let line = 1, col = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") { line++; col = 0; } else col++;
    }
    return line + "." + col;
}

describe("formats of a long note (R3)", () => {
    it("line.col <-> offset give exactly what they gave before", () => {
        const win = loadApp(["js/utils.js"]);
        const texts = ["", "a", "\n", "ab\ncd\n", "\n\nx\n\n", "one\ntwo\nthree"];
        for (const t of texts) {
            for (let o = -2; o <= t.length + 2; o++) {
                expect(win.NP.offsetToLineCol(t, o), JSON.stringify([t, o])).toBe(oldOffsetToLineCol(t, o));
            }
            for (let l = 0; l <= 6; l++) {
                for (let c = 0; c <= 4; c++) {
                    expect(win.NP.lineColToOffset(t, l + "." + c), JSON.stringify([t, l, c]))
                        .toBe(oldLineColToOffset(t, l + "." + c));
                }
            }
        }
    });

    // Not a wall-clock limit (the suite runs files in parallel and a busy
    // machine made 2.5 s flaky): the growth from 1 500 to 6 000 formats.
    // Linear is about 4x, the old quadratic code (4-8 s) about 16x.
    it("6 000 formats render and save in linear time (were 4–8 s, quadratic)", () => {
        const win = loadApp(["js/utils.js", "js/editor.js"]);
        const sample = (n) => {
            // A fresh, detached editor each time: emptying 6 000 runs out of
            // the old one is a jsdom cost, not NoirPad's.
            const ed = win.document.createElement("div");
            win.NP.editor.el = ed;
            const lines = Array.from({ length: n }, (_, i) => "line number " + i + " with some words in it ok");
            const fmts = lines.map((_, i) => ({ start: (i + 1) + ".5", end: (i + 1) + ".11", bold: true }));
            let t = performance.now();
            win.NP.editor.renderContent(ed, lines.join("\n"), fmts);
            const render = performance.now() - t;
            t = performance.now();
            const out = win.NP.editor._extractFormats();
            const extract = performance.now() - t;
            expect(out.length).toBe(n);
            expect(out[n - 1]).toMatchObject({ start: n + ".5", end: n + ".11", bold: true });
            return { render, extract };
        };
        const best = { small: { render: Infinity, extract: Infinity }, big: { render: Infinity, extract: Infinity } };
        for (let round = 0; round < 3; round++) {          // best of 3: load only ever adds time
            for (const [key, n] of [["small", 1500], ["big", 6000]]) {
                const r = sample(n);
                best[key].render = Math.min(best[key].render, r.render);
                best[key].extract = Math.min(best[key].extract, r.extract);
            }
        }
        for (const step of ["render", "extract"]) {
            const ratio = best.big[step] / Math.max(best.small[step], 1);
            expect(ratio, step + " grows like " + ratio.toFixed(1) + "x").toBeLessThan(8);
            expect(best.big[step], step + " got stuck").toBeLessThan(15000);
        }
    }, 60000);

    it("each saved format points at exactly the text it covers (line.col kept while walking)", () => {
        const win = loadApp(["js/utils.js", "js/editor.js"]);
        const doc = win.document;
        const ed = doc.createElement("div");
        win.NP.editor.el = ed;
        const el = (tag, ...kids) => {
            const n = doc.createElement(tag);
            for (const k of kids) n.append(typeof k === "string" ? doc.createTextNode(k) : k);
            return n;
        };
        const code = doc.createElement("pre");
        code.className = "np-code";
        code.setAttribute("data-code", encodeURIComponent("x = 1\ny = 2"));
        code.setAttribute("data-lang", "py");
        const img = doc.createElement("img");
        img.setAttribute("data-filename", "11111111-1111-4111-8111-111111111111.png");
        const link = el("a", "the site");
        link.setAttribute("href", "https://example.org/");
        ed.append("first ", el("b", "bold ", el("i", "both")), el("br"), "second line ",
            el("u", "under\nwith newline"), el("div", "block ", el("s", "struck")), el("div", el("em", "next block")),
            img, " after image ", code, el("br"), el("strong", "after code"), " and ", link);
        const { text, formats } = win.NP.editor.htmlToContent();
        const covered = formats.map((f) => text.slice(win.NP.lineColToOffset(text, f.start), win.NP.lineColToOffset(text, f.end)));
        expect(covered).toEqual(["both", "bold both", "under\nwith newline", "struck", "next block", "after code", "the site"]);
        // The same positions NP.offsetToLineCol gives on the finished text.
        for (const f of formats) {
            expect(win.NP.offsetToLineCol(text, win.NP.lineColToOffset(text, f.start))).toBe(f.start);
            expect(win.NP.offsetToLineCol(text, win.NP.lineColToOffset(text, f.end))).toBe(f.end);
        }
    });

    it("overlapping formats still split into the right runs", () => {
        const win = loadApp(["js/utils.js", "js/editor.js"]);
        const ed = win.document.getElementById("editor");
        win.NP.editor.el = ed;
        win.NP.editor.renderContent(ed, "abcdefghij", [
            { start: "1.0", end: "1.6", bold: true }, { start: "1.3", end: "1.9", italic: true }]);
        expect(ed.innerHTML).toBe("<strong>abc</strong><strong><em>def</em></strong><em>ghi</em>j");
    });
});

describe("a Markdown paragraph of 80 000 lines (R4)", () => {
    it("renders instead of 'Maximum call stack size exceeded'", () => {
        const win = loadApp(["vendor/markdown-it/markdown-it.min.js", "vendor/markdown-it-task-lists/markdown-it-task-lists.min.js",
            "vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/utils.js",
            "js/syntax-highlight.js", "js/markdown.js"]);
        const preview = win.document.getElementById("md-preview");
        const src = Array.from({ length: 80000 }, (_, i) => "w" + i).join("\n");
        expect(() => win.NP.markdown.renderInto(preview, src)).not.toThrow();
        expect(preview.textContent).toContain("w79999");
    }, 60000);
});

describe("find-all while typing (R5)", () => {
    function open() {
        const win = loadApp(["js/utils.js", "js/find-all.js"]);
        const notes = {};
        const tree = [];
        for (let i = 0; i < 50; i++) {
            notes["n" + i] = "alpha beta gamma " + i;
            tree.push({ id: "n" + i, name: "Note " + i, type: "note" });
        }
        win.NP.state = { data: { tree, notes } };
        win.NP.findAll.show();
        return { win, input: win.document.querySelector(".np-findall-overlay input") };
    }
    const results = (win) => win.document.querySelectorAll(".np-findall-result").length;

    it("searches once typing pauses, and Enter uses what is typed right now", async () => {
        vi.useFakeTimers();
        try {
            const { win, input } = open();
            const before = results(win);
            for (const ch of "gam") {
                input.value += ch;
                input.dispatchEvent(new win.Event("input"));
            }
            expect(results(win)).toBe(before);           // not yet
            vi.advanceTimersByTime(200);
            expect(results(win)).toBeGreaterThan(0);
            input.value = "nothing-like-this";
            input.dispatchEvent(new win.Event("input"));
            input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
            expect(results(win)).toBe(0);                // fresh, not the "gam" list
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("the coloured Markdown source of a long note (R5)", () => {
    function setup() {
        const win = loadApp(["js/utils.js", "js/md-source.js"], { body:
            '<div id="md-source"><div id="md-highlight"></div><textarea id="editor-md"></textarea></div>' });
        win.document.dispatchEvent(new win.Event("DOMContentLoaded"));
        return { win, ta: win.document.getElementById("editor-md"),
            hl: win.document.getElementById("md-highlight"), box: win.document.getElementById("md-source") };
    }

    it("plain text and line breaks are one text node, not one per line", () => {
        const { win, ta, hl } = setup();
        ta.value = Array.from({ length: 500 }, (_, i) => "plain line " + i).join("\n");
        win.NP.mdSource.refresh();
        expect(hl.childNodes.length).toBe(1);
        expect(hl.textContent).toBe(ta.value);
    });

    it("over 20 000 characters: recoloured after a pause, plain text meanwhile", () => {
        vi.useFakeTimers();
        try {
            const { win, ta, hl, box } = setup();
            ta.value = "# Title\n" + "x".repeat(25000);
            win.NP.mdSource.refresh();
            expect(box.classList.contains("md-hl-on")).toBe(true);
            ta.value += "y";
            ta.dispatchEvent(new win.Event("input"));
            expect(box.classList.contains("md-hl-on")).toBe(false);   // the textarea's own text shows
            vi.advanceTimersByTime(300);
            expect(box.classList.contains("md-hl-on")).toBe(true);
            expect(hl.textContent.endsWith("y")).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});
