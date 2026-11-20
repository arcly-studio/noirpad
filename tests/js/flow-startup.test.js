// 1.1.0 finding 6: the start never stays on "Loading..." without a word.
// The page reports when it has started (POST /api/session/ready, which the
// desktop window waits for); if the server does not answer, after 15 s the
// splash says the start takes unusually long (i18n).
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

const SPLASH = `<div id="splash-overlay"><div id="splash-subtitle">Loading...</div></div>`;

function boot({ answer }) {
    const win = loadApp(["js/app.js"], { body: SPLASH });
    const NP = win.NP;
    NP.auth = { start() {} };          // only the init() the test calls
    const never = () => new Promise(() => {});
    NP.api = {
        version: vi.fn(() => (answer ? Promise.resolve({ version: "1.1.0" }) : never())),
        pageReady: vi.fn(() => Promise.resolve(null)),
    };
    NP.state = { init: vi.fn(() => (answer ? Promise.resolve() : never())), data: { theme: "matrix" }, startPolling() {} };
    NP.themes = { apply() {} };
    NP.app.bindKeys = () => {};
    NP.app.bindButtons = () => {};
    return { win, NP };
}

describe("start of the page", () => {
    it("server never answers: after 15 s the splash says so, in the UI language", async () => {
        const { win, NP } = boot({ answer: false });
        expect(NP.app.slowStartMs).toBe(15000);
        NP.app.slowStartMs = 80;                      // the 15 s, shortened for the test
        NP.app.init();
        await new Promise((r) => setTimeout(r, 40));
        expect(win.document.getElementById("splash-subtitle").textContent).toBe("Loading...");
        await new Promise((r) => setTimeout(r, 100));
        expect(win.document.getElementById("splash-subtitle").textContent)
            .toBe(NP.t("app.startSlow"));
        expect(NP.t("app.startSlow")).toMatch(/unusually long/);
        expect(NP.api.pageReady).not.toHaveBeenCalled();
    });

    it("a normal start reports ready once and never shows the slow message", async () => {
        const { win, NP } = boot({ answer: true });
        NP.app.slowStartMs = 50;
        await NP.app.init();
        expect(NP.api.pageReady).toHaveBeenCalledTimes(1);
        win.document.body.insertAdjacentHTML("beforeend", SPLASH);   // even if a splash were back
        await new Promise((r) => setTimeout(r, 120));
        expect(win.document.getElementById("splash-subtitle").textContent).toBe("Loading...");
    });

    it("api.pageReady posts /api/session/ready and never fails loudly", async () => {
        const win = loadApp(["js/api.js"]);
        const calls = [];
        win.fetch = vi.fn((url, opts) => { calls.push([url, opts && opts.method]); return Promise.reject(new Error("down")); });
        await expect(win.NP.api.pageReady()).resolves.toBeNull();
        expect(calls[0]).toEqual(["/api/session/ready", "POST"]);
    });
});
