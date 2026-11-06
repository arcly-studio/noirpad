// N11, N12: Settings dropdowns from the keyboard, zoom keys, Windows high
// contrast and the names of the text fields.
import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const INDEX = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];
const CSS = fs.readFileSync(path.join(STATIC, "css/noirpad.css"), "utf8");
const HELP = fs.readFileSync(path.join(STATIC, "js/help.js"), "utf8");
const locale = (name) => JSON.parse(fs.readFileSync(path.join(STATIC, `locales/${name}.json`), "utf8"));

function boot({ desktop = true, data = {}, forced = false } = {}) {
    const win = loadApp(["js/utils.js", "js/dialog.js", "js/shortcuts.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js"],
        { body: '<button id="before">x</button><div id="editor"></div><canvas id="matrix-canvas"></canvas>' + SETTINGS });
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    win.matchMedia = (q) => ({ matches: forced && q.includes("forced-colors"), addEventListener() {} });
    win.NP.api = { saveSettings: vi.fn(() => Promise.resolve({})), hasToken: () => desktop,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) };
    win.NP.state = { data: { theme: "matrix", ...data } };
    win.NP.toast = vi.fn();
    win.NP.settings.init();
    win.NP.shortcuts.init();
    win.NP.settings.open();
    return win;
}

const press = (win, key, init = {}) => {
    const ev = new win.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    win.document.activeElement.dispatchEvent(ev);
    return ev;
};
const parts = (win, id = "setting-theme") => {
    const dd = win.document.getElementById(id);
    return { dd, trigger: dd.querySelector(".np-dropdown-trigger"),
        options: [...dd.querySelectorAll(".np-dropdown-option")] };
};

describe("Settings dropdowns from the keyboard (N11)", () => {
    it("all five are named listboxes", () => {
        const win = boot();
        const all = [...win.document.querySelectorAll(".np-dropdown")];
        expect(all.map((d) => d.id)).toEqual(["setting-language", "setting-theme", "setting-ui-font",
            "setting-autosave-interval", "setting-idle-lock"]);
        for (const dd of all) {
            const trigger = dd.querySelector(".np-dropdown-trigger");
            expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
            expect(trigger.getAttribute("aria-expanded")).toBe("false");
            const [name] = trigger.getAttribute("aria-labelledby").split(" ");
            expect(win.document.getElementById(name).classList.contains("settings-label")).toBe(true);
            expect(dd.querySelector(".np-dropdown-menu").getAttribute("role")).toBe("listbox");
            for (const o of dd.querySelectorAll(".np-dropdown-option")) expect(o.getAttribute("role")).toBe("option");
        }
    });

    it("the selected option says so", () => {
        const win = boot();
        const { options, dd } = parts(win);
        expect(options.filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.dataset.value))
            .toEqual([dd.getAttribute("data-value")]);
    });

    it.each(["ArrowDown", "ArrowUp", "Enter", " "])("%j opens on the selected option", (k) => {
        const win = boot();
        const { dd, trigger } = parts(win);
        trigger.focus();
        press(win, k);
        expect(dd.classList.contains("open")).toBe(true);
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        expect(win.document.activeElement.classList.contains("np-dropdown-option-selected")).toBe(true);
    });

    it("arrows, Home and End walk the list without choosing", () => {
        const win = boot();
        const { dd, trigger, options } = parts(win);
        const before = dd.getAttribute("data-value");
        trigger.focus();
        press(win, "ArrowDown");
        press(win, "ArrowDown");
        expect(win.document.activeElement).toBe(options[1]);
        press(win, "End");
        expect(win.document.activeElement).toBe(options.at(-1));
        press(win, "ArrowDown");
        expect(win.document.activeElement).toBe(options.at(-1));   // stays at the end
        press(win, "Home");
        expect(win.document.activeElement).toBe(options[0]);
        press(win, "ArrowUp");
        expect(win.document.activeElement).toBe(options[0]);
        expect(dd.getAttribute("data-value")).toBe(before);
    });

    it.each(["Enter", " "])("%j chooses, tells the page and returns to the button", (k) => {
        const win = boot();
        const { dd, trigger, options } = parts(win, "setting-language");
        const changes = [];
        dd.addEventListener("np-dropdown-change", (e) => changes.push(e.detail.value));
        trigger.focus();
        press(win, "ArrowDown");
        press(win, "End");
        press(win, k);
        expect(changes).toEqual([options.at(-1).dataset.value]);
        expect(dd.classList.contains("open")).toBe(false);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        expect(win.document.activeElement).toBe(trigger);
    });

    it("Escape closes only the list and returns to the button; the next one closes Settings", () => {
        const win = boot();
        const { dd, trigger } = parts(win);
        const overlay = win.document.getElementById("settings-overlay");
        trigger.focus();
        press(win, "ArrowDown");
        press(win, "Escape");
        expect(dd.classList.contains("open")).toBe(false);
        expect(win.document.activeElement).toBe(trigger);
        expect(overlay.classList.contains("visible")).toBe(true);
        press(win, "Escape");
        expect(overlay.classList.contains("visible")).toBe(false);
    });

    it("Tab leaves the list closed and goes on from the button, inside Settings", () => {
        const win = boot();
        const { dd, trigger } = parts(win);
        trigger.focus();
        press(win, "ArrowDown");
        press(win, "Tab");
        expect(dd.classList.contains("open")).toBe(false);
        const active = win.document.activeElement;
        expect(active).not.toBe(trigger);
        expect(win.document.getElementById("settings-overlay").contains(active)).toBe(true);
        expect(trigger.compareDocumentPosition(active) & win.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("the mouse still works, and tells the screen reader the state", () => {
        const win = boot();
        const { dd, trigger, options } = parts(win);
        trigger.click();
        expect(trigger.getAttribute("aria-expanded")).toBe("true");
        options[2].click();
        expect(dd.getAttribute("data-value")).toBe(options[2].dataset.value);
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
        trigger.click();
        win.document.body.click();
        expect(trigger.getAttribute("aria-expanded")).toBe("false");
    });
});

describe("zoom keys (N12)", () => {
    const closeSettings = (win) => { win.NP.settings.close(); win.document.getElementById("before").focus(); };
    const zoomOf = (win) => win.document.documentElement.style.zoom;

    it("desktop: in, out, reset; saved and said", () => {
        const win = boot();
        closeSettings(win);
        expect(press(win, "=", { ctrlKey: true }).defaultPrevented).toBe(true);
        expect(zoomOf(win)).toBe("1.1");
        expect(win.NP.api.saveSettings).toHaveBeenLastCalledWith({ ui_zoom: 110 });
        expect(win.NP.toast.mock.calls.at(-1)[0]).toContain("110");
        press(win, "-", { ctrlKey: true });
        press(win, "-", { ctrlKey: true });
        expect(win.NP.api.saveSettings).toHaveBeenLastCalledWith({ ui_zoom: 90 });
        expect(zoomOf(win)).toBe("0.9");
        press(win, "0", { ctrlKey: true });
        expect(win.NP.api.saveSettings).toHaveBeenLastCalledWith({ ui_zoom: 100 });
        expect(zoomOf(win)).toBe("1");
        expect(win.document.documentElement.style.getPropertyValue("--np-zoom")).toBe("1");
    });

    it.each([
        ["US Ctrl+Shift+=", { key: "+", shiftKey: true, code: "Equal" }, "1.1"],
        ["Czech plus key", { key: "+", code: "Digit1" }, "1.1"],
        ["numeric keypad plus", { key: "+", code: "NumpadAdd" }, "1.1"],
        ["Czech 0 key", { key: "é", code: "Digit0" }, "1"],
        ["numeric keypad 0", { key: "0", code: "Numpad0" }, "1"],
    ])("%s", (_name, init, expected) => {
        const win = boot({ data: { ui_zoom: 120 } });
        win.NP.settings.applyRuntimeState();
        closeSettings(win);
        const { key, ...rest } = init;
        if (expected === "1.1") win.NP.state.data.ui_zoom = 100;
        press(win, key, { ctrlKey: true, ...rest });
        expect(zoomOf(win)).toBe(expected);
    });

    it("stops at its limits", () => {
        const win = boot({ data: { ui_zoom: 200 } });
        closeSettings(win);
        press(win, "=", { ctrlKey: true });
        expect(zoomOf(win)).toBe("2");
        win.NP.state.data.ui_zoom = 70;
        press(win, "-", { ctrlKey: true });
        expect(zoomOf(win)).toBe("0.7");
    });

    it("the page keeps fitting the window at any zoom", () => {
        expect(CSS).toContain("height: calc(100vh / var(--np-zoom, 1));");
        expect(CSS).toContain("min-width: min(640px, calc(100vw / var(--np-zoom, 1)));");
        expect(CSS).toMatch(/@media print \{\s*html \{\s*zoom: 1 !important/);
    });

    it("the saved zoom comes back at start, a damaged value does no harm", () => {
        const win = boot({ data: { ui_zoom: 150 } });
        win.NP.settings.applyRuntimeState();
        expect(zoomOf(win)).toBe("1.5");
        win.NP.state.data.ui_zoom = "junk";
        win.NP.settings.applyRuntimeState();
        expect(zoomOf(win)).toBe("1");
    });

    it("in a browser the keys stay the browser's, and a desktop zoom does not apply", () => {
        const win = boot({ desktop: false, data: { ui_zoom: 150 } });
        win.NP.settings.applyRuntimeState();
        expect(zoomOf(win)).toBe("");
        closeSettings(win);
        expect(press(win, "=", { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(press(win, "0", { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(win.NP.shortcuts.getCurrent("zoom-in")).toBe("");
    });

    it("a modal window keeps the keys away from the app behind it", () => {
        const win = boot();
        press(win, "=", { ctrlKey: true });
        expect(zoomOf(win)).toBe("");
    });

    it("the keys collide with no other shortcut", () => {
        const win = boot();
        const all = win.NP.shortcuts.getAll();
        const ids = ["zoom-in", "zoom-out", "zoom-reset"];
        for (const id of ids) {
            expect(win.NP.shortcuts.findConflict(all[id].current, id)).toBeNull();
            expect(win.NP.shortcuts.validate(all[id].current).ok).toBe(true);
        }
        const fixed = [...HELP.matchAll(/\["((?:Ctrl|F\d|Shift|Delete|Escape)[^"]*)", "[^"]+"\]/g)].map((m) => m[1]);
        expect(fixed.length).toBeGreaterThan(3);
        for (const id of ids) expect(fixed).not.toContain(all[id].current);
    });

    it("a key someone already gave another action stays with it", () => {
        const win = boot({ data: { custom_shortcuts: { "find-all": "Ctrl+=" } } });
        const run = vi.fn();
        win.NP.shortcuts.register("find-all", run);
        win.NP.shortcuts.loadFromState();
        closeSettings(win);
        press(win, "=", { ctrlKey: true });
        expect(run).toHaveBeenCalled();
        expect(zoomOf(win)).toBe("");
    });

    it("the recorder writes the plus key so that it can be read back", () => {
        const win = boot();
        const ks = win.NP.shortcuts.eventToKeystroke(new win.KeyboardEvent("keydown", { key: "+", ctrlKey: true, shiftKey: true }));
        expect(ks).toBe("Ctrl+=");
    });

    it("help lists them from the current mapping, in both languages", () => {
        for (const id of ["zoom-in", "zoom-out", "zoom-reset"]) expect(HELP).toContain(`"${id}"`);
        for (const name of ["en", "cs"]) {
            const labels = locale(name).shortcuts.labels;
            for (const key of ["zoomIn", "zoomOut", "zoomReset", "zoomLevel"]) expect(labels[key]).toBeTruthy();
        }
    });
});

describe("Windows high contrast (N12)", () => {
    const allOn = { glow_enabled: true, matrix_rain_enabled: true, crt_enabled: true, glow_intensity: 100 };

    it("the effects stay off, the settings stay as they are", () => {
        const win = boot({ forced: true, data: allOn });
        win.NP.settings.applyRuntimeState();
        expect(win.document.body.classList.contains("np-glow")).toBe(false);
        expect(win.document.body.classList.contains("crt-on")).toBe(false);
        expect(win.NP.matrixRain.running).toBe(false);
        expect(win.document.documentElement.style.getPropertyValue("--glow-multiplier")).toBe("0");
        expect(win.NP.api.saveSettings).not.toHaveBeenCalled();
        expect(win.NP.state.data).toMatchObject(allOn);
        expect(win.document.getElementById("setting-glow").classList.contains("on")).toBe(true);
    });

    it("the rain cannot be started by a command either", () => {
        const win = boot({ forced: true, data: allOn });
        win.NP.matrixRain.start();
        expect(win.NP.matrixRain.running).toBe(false);
    });

    const typeFast = (win) => {
        let now = 10000;
        Object.defineProperty(win, "performance", { value: { now: () => (now += 10) }, configurable: true });
        for (let i = 0; i < 10; i++) win.NP.effects.onEditorInput();
        return win.document.getElementById("editor").classList.contains("glitching");
    };

    it("no glitch while typing, though there is one without high contrast", () => {
        expect(typeFast(boot({ forced: true, data: allOn }))).toBe(false);
        expect(typeFast(boot({ forced: false, data: allOn }))).toBe(true);
    });

    it("switched on while NoirPad runs: the running rain stops, and comes back after", () => {
        const win = boot({ forced: false, data: allOn });
        win.NP.settings.applyRuntimeState();
        expect(win.NP.matrixRain.running).toBe(true);
        let forced = true;
        const listeners = [];
        win.matchMedia = (q) => ({ matches: forced && q.includes("forced-colors"), addEventListener: (_t, f) => listeners.push(f) });
        win.NP.settings.applyRuntimeState();
        expect(win.NP.matrixRain.running).toBe(false);
        expect(win.document.body.classList.contains("np-glow")).toBe(false);
        forced = false;
        win.NP.settings.applyRuntimeState();
        expect(win.NP.matrixRain.running).toBe(true);
    });

    it("the page follows the switch of high contrast on its own", () => {
        const win = loadApp(["js/utils.js", "js/dialog.js", "js/shortcuts.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js"],
            { body: '<div id="editor"></div><canvas id="matrix-canvas"></canvas>' + SETTINGS });
        win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
        win.requestAnimationFrame = () => 0;
        let forced = false;
        const listeners = [];
        win.matchMedia = (q) => ({ matches: forced && q.includes("forced-colors"), addEventListener: (_t, f) => listeners.push(f) });
        win.NP.api = { saveSettings: () => Promise.resolve({}), hasToken: () => true };
        win.NP.state = { data: { theme: "matrix", ...allOn } };
        win.NP.settings.init();
        win.NP.settings.applyRuntimeState();
        expect(win.document.body.classList.contains("crt-on")).toBe(true);
        forced = true;
        listeners.forEach((f) => f());
        expect(win.document.body.classList.contains("crt-on")).toBe(false);
    });

    it("without high contrast the same settings show the effects", () => {
        const win = boot({ forced: false, data: allOn });
        win.NP.settings.applyRuntimeState();
        expect(win.document.body.classList.contains("np-glow")).toBe(true);
        expect(win.document.body.classList.contains("crt-on")).toBe(true);
    });

    it("the stylesheet hides the layers and keeps states visible", () => {
        const block = CSS.slice(CSS.indexOf("@media (forced-colors: active)"));
        expect(block).toMatch(/#matrix-canvas,\s*#crt-overlay\s*\{\s*display: none !important/);
        expect(block).toContain("outline: 2px solid Highlight");
        expect(block).toContain(".settings-toggle.on");
        expect(block).toContain(".tree-item.selected");
    });
});

describe("text fields have names (N12)", () => {
    it("every input and textarea of the page, in both languages", () => {
        const doc = new JSDOM(INDEX).window.document;
        const fields = [...doc.querySelectorAll("input:not([type=hidden]):not([type=file]), textarea")];
        expect(fields.length).toBeGreaterThan(5);
        const en = locale("en");
        const cs = locale("cs");
        const get = (obj, key) => key.split(".").reduce((o, k) => o && o[k], obj);
        for (const field of fields) {
            expect(field.getAttribute("aria-label"), field.id).toBeTruthy();
            const key = field.getAttribute("data-i18n-aria-label");
            expect(key, field.id).toBeTruthy();
            expect(get(en, key), key).toBeTruthy();
            expect(get(cs, key), key).toBeTruthy();
        }
    });
});
