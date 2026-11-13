// N1.11: Store edition, Settings → Data → "Add notes from the installer
// version". Shown only while the backend offers it, gone after adding,
// refused (and still offered) while the installer version runs.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

const STATIC = path.resolve(import.meta.dirname, "../../static");
const INDEX = fs.readFileSync(path.join(STATIC, "index.html"), "utf8");
const SETTINGS = INDEX.match(/<div id="settings-overlay">[\s\S]*?<!-- ============ Context Menu/)[0];

const flush = () => new Promise((r) => setTimeout(r, 0));

function boot({ edition = "store", available = true, add } = {}) {
    const win = loadApp(["js/utils.js", "js/dialog.js", "js/shortcuts.js", "js/effects.js", "js/matrix-rain.js", "js/settings.js"],
        { body: '<div id="editor"></div><canvas id="matrix-canvas"></canvas>' + SETTINGS });
    win.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, fillText() {} });
    win.requestAnimationFrame = () => 0;
    win.matchMedia = () => ({ matches: false, addEventListener() {} });
    const server = { available };
    win.NP.appInfo = { version: "1.1.0", edition };
    win.NP.api = {
        saveSettings: vi.fn(() => Promise.resolve({})), hasToken: () => true,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
        installerNotesStatus: vi.fn(() => Promise.resolve({ available: server.available })),
        addInstallerNotes: vi.fn(add || ((folder) => {
            server.available = false;
            return Promise.resolve({ ok: true, folder, notes: 3, images: 1 });
        })),
    };
    win.NP.state = { data: { theme: "matrix" }, init: vi.fn(() => Promise.resolve()) };
    win.NP.tree = { render: vi.fn() };
    win.NP.toast = vi.fn();
    win.NP.dialog.alert = vi.fn(() => Promise.resolve());
    win.NP.settings.init();
    win.NP.shortcuts.init();
    win.NP.settings.open();
    return { win, server, btn: win.document.getElementById("setting-add-installer-notes") };
}

describe("Settings → Data → Add notes from the installer version (N1.11)", () => {
    it("is in the Data section with the label the notice names", async () => {
        const { win, btn } = boot();
        await flush();
        expect(btn.textContent).toBe("Add notes from the installer version");
        const section = [...win.document.querySelectorAll(".settings-section-title")]
            .filter((t) => t.compareDocumentPosition(btn) & win.Node.DOCUMENT_POSITION_FOLLOWING).pop();
        expect(section.textContent).toBe("Data");
    });

    it("is shown in the Store edition while the backend offers it", async () => {
        const { win, btn } = boot();
        await flush();
        expect(win.NP.api.installerNotesStatus).toHaveBeenCalled();
        expect(btn.hidden).toBe(false);
    });

    it("stays hidden when there is nothing to add", async () => {
        const { btn } = boot({ available: false });
        await flush();
        expect(btn.hidden).toBe(true);
    });

    it("never appears in the installer edition (and does not ask)", async () => {
        const { win, btn } = boot({ edition: "github" });
        await flush();
        expect(btn.hidden).toBe(true);
        expect(win.NP.api.installerNotesStatus).not.toHaveBeenCalled();
    });

    it("adds into the folder named in the UI language, refreshes the tree and disappears", async () => {
        const { win, btn } = boot();
        await flush();
        btn.click();
        await vi.waitFor(() => expect(win.NP.toast).toHaveBeenCalled());
        expect(win.NP.api.addInstallerNotes).toHaveBeenCalledWith("From installer version");
        expect(win.NP.state.init).toHaveBeenCalled();
        expect(win.NP.tree.render).toHaveBeenCalled();
        expect(win.NP.toast.mock.calls[0][0]).toBe("The notes from the installer version were added to the folder “From installer version”.");
        expect(btn.hidden).toBe(true);
        // The next opening of Settings asks again: still gone.
        win.NP.settings.close();
        win.NP.settings.open();
        await vi.waitFor(() => expect(win.NP.api.installerNotesStatus).toHaveBeenCalledTimes(2));
        await flush();
        expect(btn.hidden).toBe(true);
    });

    it("is refused while the installer version runs: says why and stays offered", async () => {
        const running = Object.assign(new Error("NoirPad (installer version) is running. Close it and try again."),
            { status: 409, code: "installer_import_running" });
        const { win, btn } = boot({ add: () => Promise.reject(running) });
        await flush();
        btn.click();
        await vi.waitFor(() => expect(btn.disabled).toBe(false));
        await vi.waitFor(() => expect(win.NP.api.installerNotesStatus).toHaveBeenCalledTimes(2));
        expect(win.NP.dialog.alert).toHaveBeenCalledWith(
            "The notes could not be added: NoirPad (installer version) is running. Close it and try again.");
        expect(win.NP.state.init).not.toHaveBeenCalled();
        expect(btn.hidden).toBe(false);
        expect(btn.disabled).toBe(false);
    });
});
