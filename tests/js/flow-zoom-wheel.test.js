// N1.11: Ctrl+mouse wheel zooms the desktop window with the same zoom as
// Ctrl+= / Ctrl+- / Ctrl+0 (one zoom: WebView2's own is prevented). Over an
// image in a note it still resizes the image; the web version leaves it to
// the browser.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadApp, locale } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const INDEX = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];
const IMG = "11111111-1111-4111-8111-111111111111.png";

function boot({ desktop = true, data = {} } = {}) {
    const win = loadApp(["js/utils.js", "js/dialog.js", "js/shortcuts.js", "js/effects.js", "js/matrix-rain.js",
        "js/settings.js", "js/images.js", "js/help.js"],
        { body: '<button id="before">x</button><div id="editor" contenteditable="true">text '
            + `<img src="/images/${IMG}" data-filename="${IMG}" style="width: 300px"></div>`
            + '<canvas id="matrix-canvas"></canvas>' + SETTINGS });
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    win.matchMedia = () => ({ matches: false, addEventListener() {} });
    win.NP.api = { saveSettings: vi.fn(() => Promise.resolve({})), hasToken: () => desktop,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) };
    win.NP.state = { data: { theme: "matrix", ...data } };
    win.NP.toast = vi.fn();
    win.NP.editor = { el: win.document.getElementById("editor"), markDirty() {}, _currentNoteId: "n1" };
    win.NP.settings.init();
    win.NP.shortcuts.init();
    win.NP.images.init();
    win.NP.settings.applyRuntimeState();
    win.NP.api.saveSettings.mockClear();       // start-up writes (e.g. the CRT migration) are not ours
    win.NP.toast.mockClear();
    return win;
}

const zoomOf = (win) => win.document.documentElement.style.zoom;

function wheel(win, target, deltaY, init = {}) {
    const ev = new win.WheelEvent("wheel", { deltaY, ctrlKey: true, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
}

describe("Ctrl+wheel zoom (N1.11)", () => {
    it("desktop: up zooms in, down zooms out, saved like Ctrl+= / Ctrl+-; WebView2 gets nothing", () => {
        const win = boot();
        const where = win.document.getElementById("before");
        const up = wheel(win, where, -100);
        expect(up.defaultPrevented).toBe(true);
        expect(zoomOf(win)).toBe("1.1");
        expect(win.NP.api.saveSettings).toHaveBeenLastCalledWith({ ui_zoom: 110 });
        expect(win.NP.toast.mock.calls.at(-1)[0]).toContain("110");
        wheel(win, where, 100);
        wheel(win, where, 100);
        expect(zoomOf(win)).toBe("0.9");
        expect(win.NP.api.saveSettings).toHaveBeenLastCalledWith({ ui_zoom: 90 });
    });

    it("stops at 200 % and 70 %", () => {
        const win = boot({ data: { ui_zoom: 200 } });
        const where = win.document.getElementById("before");
        wheel(win, where, -100);
        expect(zoomOf(win)).toBe("2");
        win.NP.state.data.ui_zoom = 70;
        wheel(win, where, 100);
        expect(zoomOf(win)).toBe("0.7");
    });

    it("a touchpad's small steps add up to one step", () => {
        const win = boot();
        const where = win.document.getElementById("before");
        for (let i = 0; i < 2; i++) wheel(win, where, -20);
        expect(zoomOf(win)).toBe("1");                     // 40 px: not yet
        for (let i = 0; i < 3; i++) wheel(win, where, -20);
        expect(zoomOf(win)).toBe("1.1");                   // 100 px: exactly one step
        expect(win.NP.api.saveSettings).toHaveBeenCalledTimes(1);
    });

    it("is the same zoom as the keys: Ctrl+= goes on from it, Ctrl+0 is 100 %", () => {
        const win = boot();
        win.NP.settings.close?.();
        const where = win.document.getElementById("before");
        where.focus();
        wheel(win, where, -100);
        wheel(win, where, -100);
        const key = (k) => win.document.activeElement.dispatchEvent(
            new win.KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true, cancelable: true }));
        key("=");
        expect(zoomOf(win)).toBe("1.3");
        key("0");
        expect(zoomOf(win)).toBe("1");
        expect(win.NP.api.saveSettings).toHaveBeenLastCalledWith({ ui_zoom: 100 });
    });

    it("the last zoom is there again after a restart", () => {
        const first = boot();
        wheel(first, first.document.getElementById("before"), -100);
        const saved = first.NP.api.saveSettings.mock.calls.at(-1)[0].ui_zoom;
        const again = boot({ data: { ui_zoom: saved } });
        expect(zoomOf(again)).toBe("1.1");
    });

    it("the wheel without Ctrl only scrolls", () => {
        const win = boot();
        const ev = wheel(win, win.document.getElementById("before"), -100, { ctrlKey: false });
        expect(ev.defaultPrevented).toBe(false);
        expect(zoomOf(win)).toBe("1");
        expect(win.NP.api.saveSettings).not.toHaveBeenCalled();
        wheel(win, win.document.getElementById("before"), -100);      // the same with Ctrl does zoom
        expect(zoomOf(win)).toBe("1.1");
    });

    it("over an image in a note it resizes only the image", () => {
        const win = boot();
        const img = win.document.querySelector("#editor img");
        const ev = wheel(win, img, -100);
        expect(ev.defaultPrevented).toBe(true);
        expect(img.style.width).toBe("330px");
        expect(zoomOf(win)).toBe("1");
        expect(win.NP.api.saveSettings).not.toHaveBeenCalled();
        wheel(win, win.document.getElementById("editor"), -100);     // next to the image: the window
        expect(zoomOf(win)).toBe("1.1");
        expect(img.style.width).toBe("330px");
    });

    it("the web version leaves Ctrl+wheel to the browser", () => {
        const win = boot({ desktop: false });
        const ev = wheel(win, win.document.getElementById("before"), -100);
        expect(ev.defaultPrevented).toBe(false);
        expect(win.NP.api.saveSettings).not.toHaveBeenCalled();
        const desk = boot({ desktop: true });                          // the desktop app takes it
        expect(wheel(desk, desk.document.getElementById("before"), -100).defaultPrevented).toBe(true);
    });

    it.each(["en", "cs"])("help lists Ctrl+wheel (%s)", (lang) => {
        const help = fs.readFileSync(path.join(STATIC, "js/help.js"), "utf8");
        expect(help).toContain('["help.keys.wheelKey", "help.keys.zoomWheel"]');
        const keys = locale(lang).help.keys;
        expect(keys.wheelKey).toBe(lang === "en" ? "Ctrl+Wheel" : "Ctrl+kolečko");
        expect(keys.zoomWheel).toBe(lang === "en"
            ? "Zoom the window (over an image in a note: resize the image)"
            : "Přiblížení okna (nad obrázkem v poznámce: velikost obrázku)");
    });
});
