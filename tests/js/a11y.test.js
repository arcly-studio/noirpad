// Review 2, accessibility: U1 (windows for keyboard + screen readers), U2
// (help sections from the keyboard), U3 (visible focus), U4 (named
// switches), U9 (reduced motion), U10 (help shows the real keys), U14
// (a dangerous confirm does not start on the red button).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadApp } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const INDEX = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];
const CSS = fs.readFileSync(path.join(STATIC, "css/noirpad.css"), "utf8");

const key = (win, k, init = {}) => win.document.activeElement.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));

/* What Tab does: the app's own handlers first, else the browser's next
   element in document order (jsdom has no default Tab action). */
function tab(win, shift = false) {
    const before = win.document.activeElement;
    const ev = new win.KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true, cancelable: true });
    before.dispatchEvent(ev);
    if (ev.defaultPrevented) return;
    const all = [...win.document.querySelectorAll("button, input, [tabindex]:not([tabindex='-1'])")];
    const next = all[(all.indexOf(before) + (shift ? -1 : 1) + all.length) % all.length];
    next.focus();
}

function bootSettings() {
    const win = loadApp(["js/utils.js", "js/dialog.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js"],
        { body: '<button id="btn-more">⋯</button><div id="editor"></div>' + SETTINGS + '<button id="after">x</button>' });
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    win.NP.api = { saveSettings: () => Promise.resolve({}),
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }) };
    win.NP.state = { data: { theme: "matrix" } };
    win.NP.settings.init();
    return win;
}

describe("Settings is a real window (U1)", () => {
    it("role dialog with a name, focus inside, Tab stays inside, focus comes back", () => {
        const win = bootSettings();
        const opener = win.document.getElementById("btn-more");
        opener.focus();
        win.NP.settings.open();
        const ov = win.document.getElementById("settings-overlay");
        expect(ov.getAttribute("role")).toBe("dialog");
        expect(ov.getAttribute("aria-modal")).toBe("true");
        expect(win.document.getElementById(ov.getAttribute("aria-labelledby")).textContent).toBe("Settings");
        expect(ov.contains(win.document.activeElement)).toBe(true);
        for (let i = 0; i < 80; i++) {
            tab(win);
            expect(ov.contains(win.document.activeElement)).toBe(true);
        }
        tab(win, true);
        expect(ov.contains(win.document.activeElement)).toBe(true);
        win.NP.settings.close();
        expect(win.document.activeElement).toBe(opener);
    });
});

describe("Settings switches have a name (U4)", () => {
    it("every role=switch is named by aria-label or an existing aria-labelledby", () => {
        const win = loadApp([], { body: SETTINGS });
        const switches = [...win.document.querySelectorAll('[role="switch"]')];
        expect(switches.length).toBeGreaterThan(10);
        for (const sw of switches) {
            const by = sw.getAttribute("aria-labelledby");
            const name = sw.getAttribute("aria-label") ||
                (by && win.document.getElementById(by) && win.document.getElementById(by).textContent.trim());
            expect(name, sw.id).toBeTruthy();
        }
    });
});

describe("Help (U1, U2, U10)", () => {
    function openHelp(setup) {
        const win = loadApp(["js/utils.js", "js/dialog.js", "js/shortcuts.js", "js/help.js"],
            { body: '<button id="opener">?</button>' });
        win.NP.state = { data: {} };
        win.NP.api = { saveSettings: () => Promise.resolve({}) };
        if (setup) setup(win);
        win.document.getElementById("opener").focus();
        win.NP.help.show();
        return win;
    }

    it("a named dialog in the shared window style; × has a name; Escape gives the focus back", () => {
        const win = openHelp();
        const ov = win.document.getElementById("help-overlay");
        expect(ov.getAttribute("role")).toBe("dialog");
        expect(ov.getAttribute("aria-modal")).toBe("true");
        expect(win.document.getElementById(ov.getAttribute("aria-labelledby")).textContent).toBeTruthy();
        expect(ov.querySelector("#help-window")).not.toBeNull();       // G7 selector
        expect(ov.getAttribute("style")).toBeNull();                    // the look comes from G7
        expect(ov.querySelector("#help-window").getAttribute("style")).toBeNull();
        expect(ov.querySelector("#help-close").getAttribute("aria-label")).toBeTruthy();
        expect(ov.contains(win.document.activeElement)).toBe(true);
        key(win, "Escape");
        expect(win.document.getElementById("help-overlay")).toBeNull();
        expect(win.document.activeElement.id).toBe("opener");
    });

    it("sections are tabs: ↓ / End / Home switch them from the keyboard", () => {
        const win = openHelp();
        const tabs = () => [...win.document.querySelectorAll("#help-nav [role=tab]")];
        const content = () => win.document.getElementById("help-content").textContent;
        expect(win.document.activeElement).toBe(tabs()[0]);
        const first = content();
        key(win, "ArrowDown");
        expect(win.document.activeElement).toBe(tabs()[1]);
        expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
        expect(content()).not.toBe(first);
        key(win, "End");
        expect(win.document.activeElement).toBe(tabs()[tabs().length - 1]);
        key(win, "Home");
        expect(content()).toBe(first);
    });

    it("shows the keys as they are set now, also after remapping", () => {
        const win = openHelp((w) => {
            w.NP.shortcuts.setCurrent("save", "Ctrl+Alt+S");
            w.NP.shortcuts.setCurrent("next-tab", "");
        });
        win.document.querySelector("#help-tab-1").click();     // Keyboard shortcuts
        const rows = [...win.document.querySelectorAll("#help-content tr")].map((tr) => tr.textContent);
        expect(rows).toContain("Ctrl+Alt+S" + win.NP.t("help.keys.save"));
        expect(rows).toContain("—" + win.NP.t("help.keys.nextTab"));
        expect(rows).not.toContain("Ctrl+S" + win.NP.t("help.keys.save"));
    });
});

describe("Font picker (U1)", () => {
    it("a named dialog; fonts are a listbox for ↑ ↓; Tab stays inside", () => {
        const win = loadApp(["js/utils.js", "js/dialog.js", "js/font-picker.js"],
            { body: '<div id="editor"></div><button id="opener">A</button>' });
        win.NP.state = { data: { font_family: "Consolas", font_size: 14 } };
        win.document.getElementById("opener").focus();
        win.NP.fontPicker.show();
        const ov = win.document.getElementById("font-picker-overlay");
        expect(ov.getAttribute("role")).toBe("dialog");
        expect(win.document.getElementById(ov.getAttribute("aria-labelledby"))).not.toBeNull();
        expect(ov.querySelector("#font-picker")).not.toBeNull();       // G7 selector
        const list = ov.querySelector("[role=listbox]");
        const selected = () => list.querySelector("[aria-selected=true]").dataset.font;
        expect(selected()).toBe("Consolas");
        list.querySelector("[tabindex='0']").focus();
        key(win, "ArrowDown");
        expect(selected()).not.toBe("Consolas");
        expect(win.document.activeElement.dataset.font).toBe(selected());
        for (let i = 0; i < 20; i++) {
            tab(win);
            expect(ov.contains(win.document.activeElement)).toBe(true);
        }
        key(win, "Escape");
        expect(win.document.activeElement.id).toBe("opener");
    });
});

describe("visible keyboard focus (U3)", () => {
    it("a global :focus-visible ring beats the bare button / input resets", () => {
        const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
        const rule = css.match(/(^|\n):focus-visible[^{]*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[2]).toMatch(/outline:\s*2px solid var\(--accent\)/);
        expect(css).toMatch(/#tag-input:focus-visible\s*\{[^}]*var\(--accent\)/);
    });
});

describe("a dangerous confirm starts on Cancel (U14)", () => {
    it("Enter right away does not do the dangerous thing", async () => {
        const win = loadApp(["js/utils.js", "js/dialog.js"]);
        const answer = win.NP.dialog.confirm("Delete for good?", { danger: true });
        expect(win.document.activeElement.textContent).toBe(win.NP.t("common.cancel"));
        key(win, "Enter");
        expect(await answer).toBe(false);
        // without danger the OK button still has the focus
        const plain = win.NP.dialog.confirm("Fine?");
        expect(win.document.activeElement.textContent).toBe(win.NP.t("common.ok"));
        key(win, "Enter");
        expect(await plain).toBe(true);
    });
});

describe("Falling-code rain and reduced motion (U9)", () => {
    function rain(reduce) {
        const win = loadApp(["js/utils.js", "js/matrix-rain.js"]);
        win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
        const frames = [];
        win.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
        win.matchMedia = (q) => ({ matches: reduce && q.includes("reduce") });
        win.NP.state = { data: { matrix_rain_enabled: true } };
        win.NP.matrixRain.start();
        for (let i = 0; i < 5 && frames[i]; i++) frames[i](16 * (i + 1));
        return frames.length;
    }

    it("draws one still frame when the system asks for less motion", () => {
        expect(rain(true)).toBe(1);
        expect(rain(false)).toBeGreaterThan(5);
    });
});

describe("font picker size field (found while testing review 2)", () => {
    it("shows the current size", () => {
        const win = loadApp(["js/utils.js", "js/dialog.js", "js/font-picker.js"], { body: '<div id="editor"></div>' });
        win.NP.state = { data: { font_family: "Consolas", font_size: 17 } };
        win.NP.fontPicker.show();
        expect(win.document.getElementById("font-picker-size").value).toBe("17");
    });
});
