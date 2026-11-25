// Desktop zoom (Ctrl+= / Ctrl+- / Ctrl+wheel, 70-200 %) is CSS zoom of the page: rects,
// the pointer's clientX/Y and innerWidth/Height contain it, style lengths and
// vw/vh do not. Menus, the link tooltip and windows were placed or sized in
// the wrong unit: at 150 % the ⋯ menu was completely outside the window.
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";
import { loadApp } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const CSS = fs.readFileSync(path.join(STATIC, "css/noirpad.css"), "utf8");
const ZOOMS = [0.7, 1, 1.25, 1.5, 2];
const WIDTH = 1486, HEIGHT = 844;

// A page zoomed like Chromium's: rects are what the user sees.
// sizes: class -> [css width, css height] of elements placed by style left/top.
function zoomed(win, z, sizes) {
    Object.defineProperty(win.document.body, "currentCSSZoom", { configurable: true, get: () => z });
    Object.defineProperty(win, "innerWidth", { configurable: true, value: WIDTH });
    Object.defineProperty(win, "innerHeight", { configurable: true, value: HEIGHT });
    const real = win.Element.prototype.getBoundingClientRect;
    win.Element.prototype.getBoundingClientRect = function () {
        const cls = Object.keys(sizes).find((c) => this.classList.contains(c));
        if (!cls) return this.__rect ? rect(...this.__rect) : real.call(this);
        const [w, h] = sizes[cls].map((v) => v * z);
        return rect(parseFloat(this.style.left || 0) * z, parseFloat(this.style.top || 0) * z, w, h);
    };
    function rect(left, top, width, height) {
        return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top };
    }
}

describe("NP.menu", () => {
    let win;
    const MENU = { "np-menu": [200, 258] };
    const items = [{ id: "a", label: "A", run() {} }, { id: "b", label: "B", run() {} }];
    const seen = () => win.document.querySelector(".np-menu").getBoundingClientRect();
    const inside = (r) => r.left >= 0 && r.top >= 0 && r.right <= WIDTH + 0.5 && r.bottom <= HEIGHT + 0.5;

    beforeEach(() => {
        win = loadApp(["js/utils.js", "js/topbar.js"], { body: '<button id="left"></button><button id="right"></button>' });
    });

    it.each(ZOOMS)("zoom %s: under its button, and right-aligned to a button at the window's edge", (z) => {
        zoomed(win, z, MENU);
        const left = win.document.getElementById("left");
        left.__rect = [300, 10, 40, 40];
        win.NP.menu.open(left, items);
        expect(seen().left).toBeCloseTo(300, 3);
        expect(seen().top).toBeCloseTo(50 + 4 * z, 3);
        win.NP.menu.close();
        const right = win.document.getElementById("right");
        right.__rect = [1430, 10, 40, 40];
        win.NP.menu.open(right, items);
        expect(seen().right).toBeCloseTo(1470, 3);
        expect(inside(seen())).toBe(true);
    });

    it.each(ZOOMS)("zoom %s: a context menu opens at the pointer", (z) => {
        zoomed(win, z, MENU);
        win.NP.menu.open({ x: 300, y: 200 }, items);
        expect(seen().left).toBeCloseTo(300, 3);
        expect(seen().top).toBeCloseTo(200, 3);
    });

    it.each(ZOOMS)("zoom %s: at every corner it stays inside the window", (z) => {
        zoomed(win, z, MENU);
        for (const at of [{ x: 2, y: 2 }, { x: WIDTH - 3, y: 5 }, { x: 5, y: HEIGHT - 3 }, { x: WIDTH - 3, y: HEIGHT - 3 }]) {
            win.NP.menu.open(at, items);
            expect(inside(seen()), JSON.stringify(at)).toBe(true);
            win.NP.menu.close();
        }
    });

    it("is never taller than the window, at any zoom", () => {
        const rule = CSS.match(/\n\.np-menu \{([^}]*)\}/)[1];
        expect(rule).toMatch(/max-height: calc\(100 \* var\(--np-vh\) - 8px\)/);
        expect(rule).toMatch(/overflow-y: auto/);
    });
});

describe("the keyboard's context menu and the link tooltip", () => {
    const SCRIPTS = ["vendor/markdown-it/markdown-it.min.js", "vendor/dompurify/purify.min.js",
        "js/dialog.js", "js/shortcuts.js", "js/markdown.js", "js/paste.js", "js/format.js",
        "js/links.js", "js/focus-mode.js", "js/encryption.js", "js/app.js"];

    async function boot(z) {
        const app = startApp({ tree: [{ id: "r", name: "Rich", type: "note" }], notes: { r: "x" }, scripts: SCRIPTS, body: BODY });
        const { NP, win } = app;
        NP.auth = { start() {} };
        NP.api.hasToken = () => true;
        NP.toast = vi.fn();
        await app.ready();
        NP.paste.init();
        NP.format.init?.();
        await NP.tabs.add("r", "Rich");
        await flush();
        zoomed(win, z, { "np-menu": [200, 120], "np-link-tip": [180, 54] });
        return app;
    }

    it.each(ZOOMS)("zoom %s: the menu key on a note in the tree opens its menu at the note", async (z) => {
        const { win, NP } = await boot(z);
        const row = win.document.querySelector('.tree-item[data-id="r"]');
        row.__rect = [10, 300, 250, 30];
        NP.tree._onRightClick({ clientX: 10 + 24, clientY: 330 }, "r", "note");
        const r = win.document.querySelector(".np-menu").getBoundingClientRect();
        expect([Math.round(r.left), Math.round(r.top)]).toEqual([34, 330]);
    });

    it.each(ZOOMS)("zoom %s: the link tooltip is under its link, or above it at the bottom, always inside", async (z) => {
        const { win } = await boot(z);
        const ed = win.document.getElementById("editor");
        ed.contentEditable = "true";
        const a = win.document.createElement("a");
        a.href = "https://example.org/";
        a.textContent = "x";
        ed.append(a);
        const over = async (rect) => {
            a.__rect = rect;
            a.dispatchEvent(new win.MouseEvent("mouseover", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 450));
            const r = win.document.getElementById("np-link-tip").getBoundingClientRect();
            ed.dispatchEvent(new win.MouseEvent("mousedown", { bubbles: true }));
            return r;
        };
        const under = await over([400, 200, 60, 20]);
        expect(under.left).toBeCloseTo(400, 3);
        expect(under.top).toBeCloseTo(220 + 6 * z, 3);
        const corner = await over([WIDTH - 40, HEIGHT - 24, 36, 20]);
        expect(corner.right).toBeLessThanOrEqual(WIDTH);
        expect(corner.bottom).toBeLessThanOrEqual(HEIGHT - 24 + 0.5);
    });
});

describe("windows, zoom change", () => {
    it("no length in vw/vh without the zoom (they are scaled by it)", () => {
        const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("\n")
            .filter((l) => /[\d.](vw|vh)\b/.test(l) && !/--np-v[wh]:/.test(l) && !/var\(--np-zoom/.test(l));
        expect(bare).toEqual([]);
        const root = CSS + fs.readFileSync(path.join(STATIC, "css/themes.css"), "utf8");
        expect(root).toMatch(/--np-vw: calc\(1vw \/ var\(--np-zoom, 1\)\)/);
        expect(root).toMatch(/--np-vh: calc\(1vh \/ var\(--np-zoom, 1\)\)/);
    });

    it("changing the zoom closes an open menu and tells everything that follows the window's size", async () => {
        const win = loadApp(["js/utils.js", "js/topbar.js", "js/settings.js"], { body: "<button id='b'></button>" });
        const resized = vi.fn();
        win.addEventListener("resize", resized);
        win.NP.menu.open(win.document.getElementById("b"), [{ id: "a", label: "A", run() {} }]);
        await flush(10);
        win.NP.settings._applyZoom(150);
        expect(win.document.querySelector(".np-menu")).toBeNull();
        expect(resized).toHaveBeenCalledTimes(1);
        expect(win.document.documentElement.style.zoom).toBe("1.5");
    });

    it("one shared conversion: nothing places things from raw rects or window sizes", () => {
        // mobile.js: breakpoint like @media; tree.js: rects compared with the pointer or handed to
        // NP.menu; matrix-rain.js: the canvas' resolution (it is laid out with width: 100 %).
        const allowed = { "utils.js": 3, "mobile.js": 1, "tree.js": 2, "matrix-rain.js": 2 };
        for (const f of fs.readdirSync(path.join(STATIC, "js"))) {
            const code = fs.readFileSync(path.join(STATIC, "js", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
            const n = (code.match(/getBoundingClientRect\(\)|window\.inner(Width|Height)/g) || []).length;
            expect(n, f).toBeLessThanOrEqual(allowed[f] || 0);
        }
    });
});
