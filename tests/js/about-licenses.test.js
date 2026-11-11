// N1.7: About shows the copyright (N9), the contact e-mail (N10) and the
// licences (N8: LICENSE + THIRD-PARTY-NOTICES.txt in a window over Settings).
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadApp, locale } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const INDEX = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];
const INFO = { version: "9.8.7", url: "https://github.com/arcly-studio/noirpad", author: "Arcly Studio",
    copyright: "Copyright (c) 2026 Arcly Studio", contact: "arclystudio.dev@gmail.com" };

function boot({ licenses = () => Promise.resolve({ license: "MIT License\n<b>x</b>", notices: "fastapi 0.136.0" }),
                lang = "en" } = {}) {
    const win = loadApp(["js/utils.js", "js/dialog.js", "js/shortcuts.js", "js/effects.js",
        "js/matrix-rain.js", "js/settings.js", "js/licenses.js", "js/links.js"],
        { body: '<div id="editor"></div><canvas id="matrix-canvas"></canvas>' + SETTINGS });
    if (lang !== "en") win.NP.i18n.use(lang, locale(lang));
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    win.matchMedia = () => ({ matches: false, addEventListener() {} });
    win.open = vi.fn();
    win.NP.appInfo = INFO;
    win.NP.api = { saveSettings: vi.fn(() => Promise.resolve({})), hasToken: () => true,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        licenses: vi.fn(licenses) };
    win.NP.state = { data: { theme: "matrix" } };
    win.NP.toast = vi.fn();
    win.NP.settings.init();
    if (win.NP.links && win.NP.links.init) win.NP.links.init();
    win.NP.settings.open();
    return win;
}

const $ = (win, sel) => win.document.querySelector(sel);
const flush = () => new Promise((r) => setTimeout(r, 0));
const esc = (win) => win.document.activeElement.dispatchEvent(
    new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));

describe("About: contact (N10) and copyright (N9)", () => {
    it("shows the contact as a mailto link that links.js opens outside the app", () => {
        const win = boot();
        const a = $(win, "#about-contact");
        expect(a.hidden).toBe(false);
        expect(a.getAttribute("href")).toBe("mailto:arclystudio.dev@gmail.com");
        expect(a.textContent).toBe("arclystudio.dev@gmail.com");
        expect(a.closest(".settings-row").querySelector("[data-i18n]").textContent).toBe("Contact");
        a.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
        expect(win.open).toHaveBeenCalledWith("mailto:arclystudio.dev@gmail.com", "_blank", "noopener,noreferrer");
    });

    it("shows the copyright line of LICENSE", () => {
        const win = boot();
        expect($(win, "#about-copyright").textContent).toBe("Copyright (c) 2026 Arcly Studio · MIT");
    });

    it("has Czech labels", () => {
        const win = boot({ lang: "cs" });
        win.NP.i18n.apply && win.NP.i18n.apply(win.document);
        const cs = locale("cs").ui.settings;
        expect(cs.contact).toBe("Kontakt");
        expect(cs.license).toBe("Licence");
        expect(locale("cs").ui.licenses.title).toBe("Licence");
    });
});

describe("About → Licenses (N8)", () => {
    it("opens a window over Settings with both texts, as text", async () => {
        const win = boot();
        $(win, "#about-licenses").click();
        const ov = $(win, "#licenses-overlay");
        expect(ov.getAttribute("role")).toBe("dialog");
        expect(ov.getAttribute("aria-labelledby")).toBe("licenses-title");
        expect($(win, "#licenses-title").textContent).toBe("Licenses");
        await flush();
        const pres = [...ov.querySelectorAll("pre.licenses-text")];
        expect(pres.map((p) => p.textContent)).toEqual(["MIT License\n<b>x</b>", "fastapi 0.136.0"]);
        expect(ov.querySelector("b")).toBeNull();           // textContent, never HTML
        expect(win.NP.api.licenses).toHaveBeenCalledTimes(1);
    });

    it("Escape closes only the Licenses window; Settings stays open", async () => {
        const win = boot();
        $(win, "#about-licenses").focus();
        $(win, "#about-licenses").click();
        await flush();
        esc(win);
        expect($(win, "#licenses-overlay")).toBeNull();
        expect($(win, "#settings-overlay").classList.contains("visible")).toBe(true);
        expect(win.document.activeElement.id).toBe("about-licenses");   // focus returns
        esc(win);
        expect($(win, "#settings-overlay").classList.contains("visible")).toBe(false);
    });

    it("loads once and says so when loading fails", async () => {
        const win = boot({ licenses: () => Promise.reject(new Error("offline")) });
        $(win, "#about-licenses").click();
        await flush();
        expect($(win, ".licenses-status").textContent).toBe("The licenses could not be loaded.");
        $(win, ".licenses-close").click();
        expect($(win, "#licenses-overlay")).toBeNull();
    });
});
