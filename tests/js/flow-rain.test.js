// N1.6: the falling-code rain is visible. The canvas sits behind #app; the
// note area (#editor-wrapper) and the start page used to paint an opaque
// background over it. With the rain on they let it through (--rain-veil),
// with it off they are solid again. The cascade is read from the real
// noirpad.css (rules that match the element, by specificity and order).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const INDEX = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];
const CSS = ["css/themes.css", "css/noirpad.css"]
    .map((f) => fs.readFileSync(path.join(STATIC, f), "utf8")).join("\n");

const NOTE = '<div id="editor"><p>text</p></div>';
const WELCOME = '<div id="editor"><div class="welcome-wrap"><div class="welcome-col">NOIRPAD</div></div></div>';

function boot({ content = NOTE, data = {}, forced = false } = {}) {
    const win = loadApp(["js/utils.js", "js/dialog.js", "js/shortcuts.js", "js/effects.js",
        "js/matrix-rain.js", "js/settings.js", "js/themes.js", "js/command-bar.js"],
    { body: `<div id="app"><div id="editor-panel"><div id="editor-wrapper">${content}</div></div></div>`
        + '<canvas id="matrix-canvas"></canvas>' + SETTINGS });
    const style = win.document.createElement("style");
    style.textContent = CSS;
    win.document.head.appendChild(style);
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    win.matchMedia = (q) => ({ matches: forced && q.includes("forced-colors"), addEventListener() {} });
    win.NP.api = { saveSettings: vi.fn(() => Promise.resolve({})), hasToken: () => true,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) };
    win.NP.state = { data: { theme: "matrix", ...data } };
    win.NP.toast = vi.fn();
    win.NP.settings.init();
    win.NP.settings.applyRuntimeState();
    return win;
}

// [ids, classes/attributes/pseudo-classes, elements] of one selector.
function specificity(sel) {
    let s = sel.replace(/:not\(([^)]*)\)/g, " $1").replace(/::[\w-]+/g, " x");
    const has = [];
    s = s.replace(/:has\(([^)]*)\)/g, (m, inner) => { has.push(inner); return " "; });
    const ids = (s.match(/#[\w-]+/g) || []).length;
    const cls = (s.match(/\.[\w-]+|\[[^\]]+\]|:[\w-]+/g) || []).length;
    const els = (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|:[\w-]+/g, " ").match(/[a-z][\w-]*/gi) || []).length;
    return has.map(specificity).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [ids, cls, els]);
}

// a wins over b: higher specificity, or equal and later in the file.
function later(a, b) {
    const i = a.findIndex((v, k) => v !== b[k]);
    return i !== -1 && a[i] > b[i];
}

// The background value the cascade gives *el* (top-level rules, no @media).
function background(win, el) {
    let best = null;
    [...win.document.styleSheets[0].cssRules].forEach((rule, order) => {
        if (!rule.selectorText) return;
        const value = rule.style.getPropertyValue("background") || rule.style.getPropertyValue("background-color");
        if (!value) return;
        for (const sel of rule.selectorText.split(",")) {
            let hit = false;
            try { hit = el.matches(sel); } catch (e) { hit = false; }
            if (!hit) continue;
            const key = [...specificity(sel.trim()), order];
            if (!best || later(key, best.key)) best = { key, value };
        }
    });
    return best && best.value.trim();
}

const wrapper = (win) => win.document.getElementById("editor-wrapper");
const SEE_THROUGH = /^color-mix\(in srgb,\s*var\((--bg|--bg-entry)\)\s+var\(--rain-veil\),\s*transparent\)$/;

describe("falling-code rain is visible (N1.6)", () => {
    it("rain off: the note area is solid", () => {
        const win = boot();
        expect(win.document.body.classList.contains("np-rain-on")).toBe(false);
        expect(background(win, wrapper(win))).toBe("var(--bg)");
    });

    it("rain on in Settings: the note lets it through, off again: solid", () => {
        const win = boot();
        win.document.getElementById("setting-matrix-rain").click();
        expect(win.NP.matrixRain.running).toBe(true);
        expect(win.document.body.classList.contains("np-rain-on")).toBe(true);
        const bg = background(win, wrapper(win));
        expect(bg).toMatch(SEE_THROUGH);
        expect(bg).toContain("var(--bg)");

        win.document.getElementById("setting-matrix-rain").click();
        expect(win.document.body.classList.contains("np-rain-on")).toBe(false);
        expect(background(win, wrapper(win))).toBe("var(--bg)");
    });

    it("start page: solid without the rain, see-through with it", () => {
        const win = boot({ content: WELCOME });
        expect(background(win, wrapper(win))).toBe("var(--bg-entry)");
        win.NP.commandBar.execute(":rain");
        expect(win.NP.matrixRain.running).toBe(true);
        const bg = background(win, wrapper(win));
        expect(bg).toMatch(SEE_THROUGH);
        expect(bg).toContain("var(--bg-entry)");
    });

    it("saved setting on: the rain runs and shows from the start", () => {
        const win = boot({ data: { matrix_rain_enabled: true } });
        expect(win.NP.matrixRain.running).toBe(true);
        expect(background(win, wrapper(win))).toMatch(SEE_THROUGH);
    });

    it(":matrix still toggles (hidden alias)", () => {
        const win = boot();
        win.NP.commandBar.execute(":matrix");
        expect(win.NP.matrixRain.running).toBe(true);
        expect(win.NP.state.data.matrix_rain_enabled).toBe(true);
        win.NP.commandBar.execute(":matrix");
        expect(win.NP.matrixRain.running).toBe(false);
        expect(win.document.body.classList.contains("np-rain-on")).toBe(false);
    });

    it("high contrast: no rain, the background stays solid", () => {
        const win = boot({ data: { matrix_rain_enabled: true }, forced: true });
        expect(win.NP.matrixRain.running).toBe(false);
        expect(win.document.body.classList.contains("np-rain-on")).toBe(false);
        expect(background(win, wrapper(win))).toBe("var(--bg)");
    });

    it("the top bar and the note title stay opaque with the rain on (D11)", () => {
        const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
        const rainRules = css.match(/body\.np-rain-on[^{]*\{/g) || [];
        expect(rainRules.length).toBeGreaterThan(0);
        for (const r of rainRules) expect(r).not.toMatch(/#top-bar|#note-header/);
    });
});
