// 1.1.0: opening a link from a note (Ctrl+click or "Open link" in the context
// menu in rich text, a click in the Markdown preview) is confirmed: the link
// lights up for ~300 ms and a toast names the address for ~2 s. An address
// that is not valid or not allowed opens nothing and says so. No glow with
// prefers-reduced-motion or forced colours; the toast stays.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";
import { locale } from "./harness.js";

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/links.js", "js/focus-mode.js", "js/encryption.js", "js/app.js"];
const TOOLS = `<div id="top-tools">
  <button class="tb-btn" id="btn-format" type="button" data-label="ui.topBar.format" aria-haspopup="menu" aria-expanded="false" disabled></button>
  <button class="tb-btn" id="btn-md-toggle" type="button" data-label="ui.topBar.markdown"></button>
</div>`;
const TREE = [{ id: "r", name: "Rich", type: "note" }, { id: "m", name: "Md", type: "note" }];
const URL_OK = "https://example.org/a?q=<b>x</b>";
const CSS = fs.readFileSync(path.resolve(import.meta.dirname, "../../static/css/noirpad.css"), "utf8");

async function boot({ reduced = false, forced = false, note = "r" } = {}) {
    const app = startApp({
        tree: TREE, notes: { r: "x", m: "see [docs](https://example.org/md) and [broken](http://)" },
        modes: { m: "markdown" }, scripts: SCRIPTS, body: TOOLS + BODY,
    });
    const { NP, win } = app;
    win.matchMedia = (q) => ({
        media: q,
        matches: (reduced && /prefers-reduced-motion:\s*reduce/.test(q)) || (forced && /forced-colors:\s*active/.test(q)),
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    });
    // jsdom has neither isContentEditable nor innerText
    Object.defineProperty(win.HTMLElement.prototype, "isContentEditable", {
        configurable: true,
        get() { const h = this.closest("[contenteditable]"); return !!h && h.getAttribute("contenteditable") === "true"; },
    });
    Object.defineProperty(win.HTMLElement.prototype, "innerText", {
        configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; },
    });
    NP.auth = { start() {} };
    NP.api.hasToken = () => true;
    win.open = vi.fn(() => null);
    await app.ready();
    NP.app.bindKeys();
    NP.markdown.registerShortcuts();
    NP.shortcuts.init();
    NP.topbar.init();
    NP.paste.init();
    await NP.tabs.add(note, note === "r" ? "Rich" : "Md");
    await flush(100);
    if (note === "r") {
        const ed = win.document.getElementById("editor");
        ed.setAttribute("contenteditable", "true");
        ed.textContent = "see ";
        for (const href of [URL_OK, "javascript:alert(1)", "http://", "mailto:test@example.org",
            "https://example.org/" + "x".repeat(300) + "END"]) {
            const a = win.document.createElement("a");
            a.setAttribute("href", href);
            a.textContent = "link";
            ed.append(a, " ");
        }
        ed.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    return app;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const links = (win) => [...win.document.querySelectorAll("#editor a[href]")];
const toast = (win) => win.document.querySelector(".np-toast");
const toastText = (win) => toast(win)?.querySelector(".np-toast-text").firstChild.textContent;
const detail = (win) => toast(win)?.querySelector(".np-toast-detail")?.textContent;
const glowing = (win) => [...win.document.querySelectorAll(".np-link-flash")];
const ctrlClick = (win, a) => a.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));

const OPENING = "Opening link in your browser…";
const BLOCKED = "This link cannot be opened: its address is not valid or not allowed.";

function menuOpen(win, a) {
    a.firstChild.dispatchEvent(new win.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    win.document.querySelector('.np-menu [data-id="link-open"]').click();
}

describe("opening a link: feedback", () => {
    it("rich text, Ctrl+click: the link lights up, a toast names the address as text, both go away", async () => {
        const { win } = await boot();
        const a = links(win)[0];
        ctrlClick(win, a);
        expect(win.open).toHaveBeenCalledTimes(1);
        expect(win.open).toHaveBeenCalledWith(URL_OK, "_blank", "noopener,noreferrer");
        expect(glowing(win)).toEqual([a]);
        expect(toastText(win)).toBe(OPENING);
        expect(detail(win)).toBe(URL_OK);
        expect(toast(win).querySelector("b")).toBeNull();          // text, never markup
        await wait(500);
        expect(glowing(win)).toEqual([]);
        expect(a.hasAttribute("class")).toBe(false);               // nothing stays in the note
        expect(toast(win)).not.toBeNull();
        await wait(1800);
        expect(toast(win)).toBeNull();
    });

    it("rich text, context menu Open link: the same", async () => {
        const { win } = await boot();
        const a = links(win)[0];
        menuOpen(win, a);
        expect(win.open).toHaveBeenCalledTimes(1);
        expect(glowing(win)).toEqual([a]);
        expect(toastText(win)).toBe(OPENING);
        expect(detail(win)).toBe(URL_OK);
    });

    it("Markdown preview: the same; an invalid address opens nothing and says so", async () => {
        const { win } = await boot({ note: "m" });
        const [docs, broken] = win.document.querySelectorAll("#md-preview a[href]");
        docs.click();
        expect(win.open).toHaveBeenCalledWith("https://example.org/md", "_blank", "noopener,noreferrer");
        expect(glowing(win)).toEqual([docs]);
        expect(toastText(win)).toBe(OPENING);
        expect(detail(win)).toBe("https://example.org/md");
        win.open.mockClear();
        await wait(450);
        expect(docs.className).toBe("md-link");                    // its own class stays
        ctrlClick(win, broken);
        expect(win.open).not.toHaveBeenCalled();
        expect(glowing(win)).toEqual([]);
        expect(toastText(win)).toBe(BLOCKED);
    });

    it("rich text: not allowed (javascript:) and invalid (http://): an error toast, nothing opens", async () => {
        const { win } = await boot();
        const [, bad, invalid] = links(win);
        for (const a of [bad, invalid]) {
            toast(win)?.remove();
            ctrlClick(win, a);
            expect(win.open).not.toHaveBeenCalled();
            expect(glowing(win)).toEqual([]);
            expect(toastText(win)).toBe(BLOCKED);
            expect(detail(win)).toBe(a.getAttribute("href"));
        }
        toast(win).remove();
        menuOpen(win, invalid);
        expect(win.open).not.toHaveBeenCalled();
        expect(toastText(win)).toBe(BLOCKED);
    });

    it("a plain click in the note only edits: no toast, no glow", async () => {
        const { win } = await boot();
        for (const a of links(win)) a.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(win.open).not.toHaveBeenCalled();
        expect(toast(win)).toBeNull();
        expect(glowing(win)).toEqual([]);
    });

    it("a long address is shortened in the middle; mailto: does not claim a browser", async () => {
        const { win } = await boot();
        const [, , , mail, long] = links(win);
        ctrlClick(win, long);
        expect(detail(win).length).toBeLessThan(80);
        expect(detail(win)).toMatch(/^https:\/\/example\.org\/x+…x+END$/);
        ctrlClick(win, mail);
        expect(win.open).toHaveBeenLastCalledWith("mailto:test@example.org", "_blank", "noopener,noreferrer");
        expect(toastText(win)).toBe("Opening your e-mail app…");
    });

    it("an address that opened before still opens (a space in the path, several mail recipients)", async () => {
        const { win } = await boot();
        const a = links(win)[0];
        for (const href of ["https://example.org/a b", "mailto:a@example.org,b@example.org?subject=x", "http://localhost:8080/"]) {
            a.setAttribute("href", href);
            ctrlClick(win, a);
            expect(win.open).toHaveBeenLastCalledWith(href, "_blank", "noopener,noreferrer");
        }
    });

    it.each([["prefers-reduced-motion", { reduced: true }], ["forced colours", { forced: true }]])(
        "%s: no glow, the toast stays", async (_name, opts) => {
            const { win } = await boot(opts);
            ctrlClick(win, links(win)[0]);
            expect(win.open).toHaveBeenCalledTimes(1);
            expect(glowing(win)).toEqual([]);
            expect(toastText(win)).toBe(OPENING);
        });

    it("the glow never reaches the saved note", async () => {
        const { win, NP } = await boot();
        ctrlClick(win, links(win)[0]);
        expect(glowing(win).length).toBe(1);
        await NP.editor.save();
        expect(JSON.stringify(NP.api.saveNote.mock.calls.at(-1))).not.toContain("np-link-flash");
    });

    it("links outside a note (About, the start page) open as before, without a toast", async () => {
        const { win } = await boot();
        const a = win.document.createElement("a");
        a.setAttribute("href", "https://example.org/about");
        const wrap = win.document.createElement("div");
        wrap.className = "welcome-wrap";
        wrap.append(a);
        for (const parent of [win.document.body, win.document.getElementById("md-preview")]) {
            parent.append(wrap);
            win.open.mockClear();
            a.click();
            expect(win.open).toHaveBeenCalledTimes(1);
            expect(toast(win)).toBeNull();
        }
    });

    it("texts in both languages", () => {
        expect(locale("en").format.link.opening).toBe(OPENING);
        expect(locale("cs").format.link.opening).toBe("Otevírám odkaz v prohlížeči…");
    });

    it("CSS: only box-shadow moves, ~300 ms, tokens only, off for reduced motion and forced colours", () => {
        const body = CSS.match(/@keyframes np-link-flash \{([\s\S]*?)\n\}/)[1];
        expect([...new Set([...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]))]).toEqual(["box-shadow"]);
        expect(body).toContain("var(--link)");
        expect(body).toContain("var(--accent-soft)");
        expect(body).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
        expect(CSS).toMatch(/\.np-link-flash \{[^}]*animation: np-link-flash 300ms/);
        for (const media of ["prefers-reduced-motion: reduce", "forced-colors: active"]) {
            const blocks = CSS.match(new RegExp(`@media \\(${media}\\) \\{([\\s\\S]*?)\\n\\}`, "g")).join("\n");
            expect(blocks).toMatch(/\.np-link-flash[^}]*animation: none/);
        }
    });
});
