// The coloured Markdown source (md-source.js): plain text vs. headings,
// markup and code, built from text nodes only.
import { beforeEach, describe, expect, it } from "vitest";
import { dangers, loadApp } from "./harness.js";

let win;

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/md-source.js"], {
        body: '<div id="md-source"><div id="md-highlight"></div><textarea id="editor-md"></textarea></div>' });
});

const tok = (src) => win.NP.mdSource._tokenize(src).filter((s) => s[1] !== "\n");
const marked = (src) => tok(src).filter((s) => s[0]).map((s) => `${s[0]}:${s[1]}`);

describe("md-source tokenizer", () => {
    it("plain prose has no colour class", () => {
        expect(marked("The nightly job pulls the export.")).toEqual([]);
    });

    it("headings are one accent run", () => {
        expect(marked("# Title\n## Sub")).toEqual(["head:# Title", "head:## Sub"]);
        expect(marked("#hashtag")).toEqual([]);              // not a heading
    });

    it("fenced code, including the fences, is code; # inside stays code", () => {
        expect(marked("```py\n# comment\nx = 1\n```\nafter")).toEqual(
            ["code:```py", "code:# comment", "code:x = 1", "code:```"]);
    });

    it("an unclosed fence runs to the end; ~~~ does not close ```", () => {
        expect(marked("```\na\n~~~\nb")).toEqual(["code:```", "code:a", "code:~~~", "code:b"]);
    });

    it("list markers, task boxes and quotes are marks; the text stays plain", () => {
        expect(marked("- [x] done\n1. one\n> quoted")).toEqual(["mark:- [x]", "mark:1.", "mark:> "]);
        expect(tok("- [x] done").find((s) => !s[0])[1]).toBe(" done");
    });

    it("inline code, emphasis markers and link syntax", () => {
        expect(marked("use `npm test` now")).toEqual(["code:`npm test`"]);
        expect(marked("**bold** and *it* and ~~gone~~")).toEqual(
            ["mark:**", "mark:**", "mark:*", "mark:*", "mark:~~", "mark:~~"]);
        expect(marked("see [docs](https://x.y) here")).toEqual(["mark:[", "mark:](https://x.y)"]);
        expect(marked("![alt](a.png)")).toEqual(["mark:![", "mark:](a.png)"]);
    });

    it("snake_case words and escapes are not emphasis", () => {
        expect(marked("a snake_case_name here")).toEqual([]);
        expect(marked("\\*not\\*")).toEqual([]);
        expect(marked("2 * 3 * 4")).toEqual([]);
    });

    it("table pipes and rules are marks", () => {
        expect(marked("| a | b |")).toEqual(["mark:|", "mark:|", "mark:|"]);
        expect(marked("---")).toEqual(["mark:---"]);
    });

    it("a very long line gets no inline parsing (no regex blow-up)", () => {
        const line = "`*_[".repeat(5000);
        const t0 = Date.now();
        expect(marked(line)).toEqual([]);
        expect(Date.now() - t0).toBeLessThan(2000);   // a regex blow-up takes seconds to minutes
        expect(marked("# " + line)[0]).toMatch(/^head:/);   // headings still coloured
    });

    it("a trailing newline keeps the copy as tall as the textarea", () => {
        const ta = win.document.getElementById("editor-md");
        ta.value = "a\n";
        win.NP.mdSource.refresh();
        expect(win.document.getElementById("md-highlight").textContent).toBe("a\n​");
    });

    it("the segments add up to the source exactly", () => {
        const src = "# H\n\n- [ ] x `y` **z**\n```\ncode\n```\n> q [l](u)\ntext_\n";
        expect(win.NP.mdSource._tokenize(src).map((s) => s[1]).join("")).toBe(src);
    });
});

describe("md-source rendering", () => {
    it("copies the textarea into #md-highlight with spans and text nodes only", () => {
        const ta = win.document.getElementById("editor-md");
        ta.value = "# <img src=x onerror=alert(1)>\nplain <b>x</b>";
        win.NP.mdSource.refresh();
        const hl = win.document.getElementById("md-highlight");
        expect(hl.textContent).toBe(ta.value);
        expect(dangers(hl)).toEqual([]);
        expect([...hl.querySelectorAll("*")].map((e) => e.tagName)).toEqual(["SPAN"]);
        expect(win.document.getElementById("md-source").classList.contains("md-hl-on")).toBe(true);
    });

    it("a huge note falls back to the plain textarea", () => {
        const ta = win.document.getElementById("editor-md");
        ta.value = "x".repeat(60001);
        win.NP.mdSource.refresh();
        expect(win.document.getElementById("md-source").classList.contains("md-hl-on")).toBe(false);
        expect(win.document.getElementById("md-highlight").childNodes).toHaveLength(0);
    });
});

// Desktop zoom (Ctrl+= / Ctrl+-, 70-200 %): getBoundingClientRect already contains
// the zoom, a style width does not. Undivided, the visible text wrapped elsewhere
// than the textarea's: the caret and the selection were off.
describe("the underlay is as wide as the textarea at every zoom", () => {
    function sizes(zoom, cssWidth, scrollbar) {
        const ta = win.document.getElementById("editor-md");
        Object.defineProperty(win.document.body, "currentCSSZoom", { configurable: true, value: zoom });
        Object.defineProperty(ta, "offsetWidth", { configurable: true, value: Math.round(cssWidth) });
        Object.defineProperty(ta, "clientWidth", { configurable: true, value: Math.round(cssWidth) - scrollbar });
        ta.getBoundingClientRect = () => ({ width: cssWidth * (zoom || 1), left: 0, top: 0, right: 0, bottom: 0, height: 0 });
        win.dispatchEvent(new win.Event("resize"));
        return parseFloat(win.document.getElementById("md-highlight").style.width);
    }

    beforeEach(() => win.document.dispatchEvent(new win.Event("DOMContentLoaded")));

    it.each([0.7, 1, 1.25, 1.5, 2])("zoom %s: the CSS width, to a fraction of a pixel, minus the scrollbar", (zoom) => {
        expect(sizes(zoom, 502.4, 0)).toBeCloseTo(502.4, 3);
        expect(sizes(zoom, 502.4, 10)).toBeCloseTo(492.4, 3);
    });

    it("an engine without currentCSSZoom (its rects are unzoomed): as before", () => {
        expect(sizes(undefined, 502.4, 10)).toBeCloseTo(492.4, 3);
    });
});
