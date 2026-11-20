// 1.1.0: switching to Markdown and back (button or Ctrl+M) has a short
// transition, variant B: the source is there at once, the preview slides in
// from the right (~220 ms), the way back fades the editor in (~120 ms), and
// the Markdown icon lights up briefly. The switch itself never waits for
// it; with prefers-reduced-motion or forced colours nothing animates.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";

const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
    "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
    "js/focus-mode.js", "js/encryption.js", "js/app.js"];
const TOOLS = `<div id="top-tools">
  <button class="tb-btn" id="btn-format" type="button" data-label="ui.topBar.format" aria-haspopup="menu" aria-expanded="false" disabled></button>
  <button class="tb-btn" id="btn-md-toggle" type="button" data-label="ui.topBar.markdown"></button>
</div>`;
const TREE = [{ id: "r", name: "Rich", type: "note" }];
const CSS = fs.readFileSync(path.resolve(import.meta.dirname, "../../static/css/noirpad.css"), "utf8");

async function boot({ reduced = false, forced = false } = {}) {
    const app = startApp({ tree: TREE, notes: { r: "hello world" }, scripts: SCRIPTS, body: TOOLS + BODY });
    const { NP, win } = app;
    win.matchMedia = (q) => ({
        media: q,
        matches: (reduced && /prefers-reduced-motion:\s*reduce/.test(q)) || (forced && /forced-colors:\s*active/.test(q)),
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    });
    // jsdom has no innerText (markdown.js reads the editor's text with it)
    Object.defineProperty(win.HTMLElement.prototype, "innerText", {
        configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; },
    });
    NP.auth = { start() {} };
    NP.api.hasToken = () => true;
    NP.toast = vi.fn();
    await app.ready();
    NP.app.bindKeys();
    NP.markdown.registerShortcuts();
    NP.shortcuts.init();
    NP.topbar.init();
    await NP.tabs.add("r", "Rich");
    await flush();
    return app;
}

const $ = (win, id) => win.document.getElementById(id);
const ctrlM = (win) => $(win, "editor").dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "m", code: "KeyM", ctrlKey: true, bubbles: true, cancelable: true }));
const mdOn = (win) => win.document.body.classList.contains("editor-md-active");
const animated = (win) => [...win.document.querySelectorAll(".np-md-anim-slide, .np-md-anim-fade, .np-md-flash")]
    .map((el) => el.id + ":" + [...el.classList].filter((c) => /^np-md-(anim|flash)/.test(c)).join(","));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe("Markdown switch animation", () => {
    it("Ctrl+M: switched at once; the preview slides in, the icon lights up, then the classes go", async () => {
        const { win } = await boot();
        ctrlM(win);
        // the switch is done synchronously, the animation runs on top
        expect(mdOn(win)).toBe(true);
        expect($(win, "editor-md").value).toBe("hello world");
        expect(animated(win).sort()).toEqual(["btn-md-toggle:np-md-flash", "md-preview:np-md-anim-slide"]);
        // the source and its caret never move
        expect($(win, "md-highlight").className).not.toMatch(/np-md-anim/);
        expect($(win, "editor-md").className).not.toMatch(/np-md-anim/);
        $(win, "md-preview").dispatchEvent(new win.Event("animationend"));
        expect($(win, "md-preview").classList.contains("np-md-anim-slide")).toBe(false);
        await wait(450);                              // fallback without animationend
        expect(animated(win)).toEqual([]);
    });

    it("button back to rich text: the editor fades in, the text is the same", async () => {
        const { win } = await boot();
        $(win, "btn-md-toggle").click();
        expect(mdOn(win)).toBe(true);
        await wait(450);
        $(win, "btn-md-toggle").click();
        expect(mdOn(win)).toBe(false);
        expect($(win, "editor").textContent).toBe("hello world");
        expect(animated(win).sort()).toEqual(["btn-md-toggle:np-md-flash", "editor:np-md-anim-fade"]);
    });

    it("preview hidden (split off): the source fades in instead of a slide", async () => {
        const { win } = await boot();
        win.document.body.classList.add("md-no-preview");
        ctrlM(win);
        expect(mdOn(win)).toBe(true);
        expect(animated(win).sort()).toEqual(["btn-md-toggle:np-md-flash", "md-stack:np-md-anim-fade"]);
    });

    it("quick Ctrl+M twice: ends in the right mode, nothing left animating", async () => {
        const { win } = await boot();
        ctrlM(win);
        ctrlM(win);
        expect(mdOn(win)).toBe(false);
        expect($(win, "editor").textContent).toBe("hello world");
        await wait(450);
        expect(animated(win)).toEqual([]);
    });

    it("prefers-reduced-motion: switched, nothing animates", async () => {
        const { win } = await boot({ reduced: true });
        ctrlM(win);
        expect(mdOn(win)).toBe(true);
        expect(animated(win)).toEqual([]);
        $(win, "btn-md-toggle").click();
        expect(mdOn(win)).toBe(false);
        expect(animated(win)).toEqual([]);
    });

    it("high contrast (forced colours): switched, nothing animates", async () => {
        const { win } = await boot({ forced: true });
        ctrlM(win);
        expect(mdOn(win)).toBe(true);
        expect(animated(win)).toEqual([]);
    });

    it("CSS: only opacity and transform, colours from tokens, off for reduced motion and forced colours", () => {
        const frames = [...CSS.matchAll(/@keyframes (np-md-[\w-]+) \{([\s\S]*?)\n\}/g)];
        expect(frames.map((m) => m[1]).sort()).toEqual(["np-md-fade-in", "np-md-flash", "np-md-flash-glow", "np-md-slide-in"]);
        for (const [, name, body] of frames) {
            const props = [...body.matchAll(/([\w-]+)\s*:/g)].map((m) => m[1]);
            const allowed = /slide|fade/.test(name) ? ["opacity", "transform"] : ["color", "background", "box-shadow"];
            for (const p of props) expect(allowed, `${name}: ${p}`).toContain(p);
            expect(body).not.toMatch(/#[0-9a-f]{3,6}\b|rgba?\(/i);
        }
        const reduce = CSS.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g).join("\n");
        const forced = CSS.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g).join("\n");
        for (const block of [reduce, forced]) {
            expect(block).toMatch(/\.np-md-anim-slide[\s\S]*\.np-md-anim-fade[\s\S]*\.np-md-flash[\s\S]*animation: none/);
        }
    });
});
