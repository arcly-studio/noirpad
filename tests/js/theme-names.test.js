// N1.6: descriptive theme names. :theme takes the new names, the old ids
// still work but are never offered; the saved value stays the id.
import { describe, expect, it, vi } from "vitest";
import { loadApp, locale } from "./harness.js";

function boot(data = {}) {
    const win = loadApp(["js/utils.js", "js/themes.js", "js/command-bar.js", "js/splash.js"], { body: "" });
    win.NP.api = { saveSettings: vi.fn(() => Promise.resolve({})) };
    win.NP.state = { data: { theme: "white", tree: [], ...data } };
    return win;
}

const suggest = (win, text) => {
    win.NP.commandBar.open();
    const input = win.document.querySelector(".np-command-input");
    input.value = text;
    input.dispatchEvent(new win.Event("input"));
    if (win.document.querySelector(".np-command-dropdown").style.display === "none") return [];
    return [...win.document.querySelectorAll(".np-command-item")].map((el) => el.textContent.split(" ")[0]);
};

describe("theme names (N1.6)", () => {
    it.each([["phosphor", "matrix"], ["lavender", "dracula"], ["neon", "synthwave"], ["slate", "nord"],
        ["retro", "gruvbox"], ["midnight", "tokyo-night"], ["amber", "amber"]])(
        ":theme %s applies and saves the id %s", (name, id) => {
            const win = boot();
            win.NP.commandBar.execute(":theme " + name);
            expect(win.document.documentElement.getAttribute("data-theme")).toBe(id);
            expect(win.NP.state.data.theme).toBe(id);
            expect(win.NP.api.saveSettings).toHaveBeenCalledWith({ theme: id });
        });

    it("old ids still work, after :theme and alone (hidden aliases)", () => {
        const win = boot();
        win.NP.commandBar.execute(":theme Tokyo-Night");
        expect(win.NP.state.data.theme).toBe("tokyo-night");
        win.NP.commandBar.execute("dracula");
        expect(win.NP.state.data.theme).toBe("dracula");
        win.NP.commandBar.execute("Midnight");
        expect(win.NP.state.data.theme).toBe("tokyo-night");
    });

    it("a saved id from 1.0.x is applied as it is", () => {
        const win = boot({ theme: "gruvbox" });
        win.NP.themes.apply("gruvbox");
        expect(win.document.documentElement.getAttribute("data-theme")).toBe("gruvbox");
        expect(win.NP.api.saveSettings).not.toHaveBeenCalled();
    });

    it("suggestions offer the new names only", () => {
        const win = boot();
        expect(suggest(win, "lav")).toEqual(["lavender"]);
        expect(suggest(win, "dra")).toEqual([]);
        expect(suggest(win, "matr")).toEqual([]);
        expect(suggest(win, "phos")).toEqual(["phosphor"]);
        expect(suggest(win, ":ra")).toEqual([":rain"]);
        expect(suggest(win, ":mat")).toEqual([]);
    });

    it("the start splash shows the shown name, in the user's language", () => {
        vi.useFakeTimers();
        try {
            const win = boot({ theme: "matrix" });
            win.NP.splash.show();
            vi.advanceTimersByTime(2000);
            expect(win.document.getElementById("splash-overlay").textContent).toContain("Theme: Phosphor Green");
            expect(win.document.getElementById("splash-overlay").textContent).not.toMatch(/matrix/i);
            win.document.getElementById("splash-overlay").remove();
            win.NP.i18n.use("cs", locale("cs"));
            win.NP.state.data.theme = "tokyo-night";
            win.NP.splash.show();
            vi.advanceTimersByTime(2000);
            expect(win.document.getElementById("splash-overlay").textContent).toContain("Motiv: Půlnoční modrá");
        } finally {
            vi.useRealTimers();
        }
    });

    it("NP.themeName falls back to the id for an unknown theme", () => {
        const win = boot();
        expect(win.NP.themeName("dracula")).toBe("Lavender Night");
        expect(win.NP.themeName("nope")).toBe("nope");
        expect(win.NP.themeId("nope")).toBe(null);
    });
});
