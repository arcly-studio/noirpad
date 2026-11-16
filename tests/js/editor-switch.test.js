// K1: switching notes quickly must never save one note's text under another
// note's id (loadNote sets the new id before the new content has arrived).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadApp } from "./harness.js";

let win;
let pending;   // id -> resolve function of the outstanding getNote
let saved;     // [id, content]

function deferredApi() {
    pending = {};
    saved = [];
    return {
        getNote: vi.fn((id) => new Promise((resolve) => { pending[id] = resolve; })),
        saveNote: vi.fn((id, content) => { saved.push([id, content]); return Promise.resolve({}); }),
    };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    win = loadApp(["js/utils.js", "js/editor.js"]);
    win.NP.state = { data: { tree: [
        { id: "A", name: "A", type: "note" },
        { id: "B", name: "B", type: "note" },
        { id: "C", name: "C", type: "note" },
    ] } };
    win.NP.api = deferredApi();
    win.NP.editor.init();
});

async function open(id, content) {
    const p = win.NP.editor.loadNote(id);
    pending[id]({ content, formats: [] });
    await p;
}

describe("switching notes (K1)", () => {
    it("a save while the next note is still loading writes nothing", async () => {
        await open("A", "text of A");
        win.NP.editor.loadNote("B");          // B's content not here yet
        await win.NP.editor.save(true);        // e.g. tabs.activate on the next click
        expect(saved).toEqual([]);
    });

    it("a late answer for a note the user already left is ignored", async () => {
        await open("A", "text of A");
        win.NP.editor.loadNote("B");
        const c = win.NP.editor.loadNote("C");
        pending.C({ content: "text of C", formats: [] });
        await c;
        pending.B({ content: "text of B", formats: [] });   // arrives last
        await flush();
        expect(win.NP.editor.el.textContent).toContain("text of C");
        expect(win.NP.editor.el.textContent).not.toContain("text of B");
        await win.NP.editor.save(false);
        expect(saved).toEqual([["C", "text of C"]]);
    });

    it("normal saves still work", async () => {
        await open("A", "text of A");
        win.NP.editor.el.textContent = "edited A";
        await win.NP.editor.save(false);
        expect(saved).toEqual([["A", "edited A"]]);
    });
});

describe("long notes are saved before the window closes (K5)", () => {
    it("typing in a rich-text note is saved shortly after the typing stops", async () => {
        await open("A", "short");
        win.NP.editor.el.textContent = "x".repeat(100000);   // far above keepalive's 64 kB
        win.NP.editor.el.dispatchEvent(new win.Event("input", { bubbles: true }));
        // Saved by the typing debounce, well before the 30 s net.
        await vi.waitFor(() => expect(saved.length).toBe(1), { timeout: 4000, interval: 50 });
        expect(saved[0][0]).toBe("A");
        expect(saved[0][1].length).toBe(100000);
    });

    it("flushForClose saves the open note and resolves when it is stored", async () => {
        await open("A", "text of A");
        win.NP.editor.el.textContent = "y".repeat(90000);
        await win.NP.editor.flushForClose();
        expect(saved).toEqual([["A", "y".repeat(90000)]]);
    });
});

describe("a failed save is never silent (D3)", () => {
    function failNextSave() {
        win.NP.api.saveNote = vi.fn(() => Promise.reject(Object.assign(new Error("Server error 500"), { status: 500 })));
        win.NP.dialog = { failed: vi.fn() };
    }

    it("Ctrl+S shows the error; the status says the note is not saved", async () => {
        win.document.body.insertAdjacentHTML("beforeend", '<div id="status-label">Ready</div>');
        await open("A", "text");
        failNextSave();
        win.NP.editor.el.textContent = "changed";
        await win.NP.editor.save(false);
        expect(win.NP.dialog.failed).toHaveBeenCalledTimes(1);
        const status = win.document.getElementById("status-label");
        expect(status.textContent).toBe("not saved");
        expect(status.classList.contains("status-error")).toBe(true);
        // the next successful save clears it
        win.NP.api.saveNote = vi.fn(() => Promise.resolve({}));
        await win.NP.editor.save(false);
        expect(status.textContent).toBe("saved");
        expect(status.classList.contains("status-error")).toBe(false);
    });

    it("an autosave failure does not pop up a dialog but marks the status", async () => {
        win.document.body.insertAdjacentHTML("beforeend", '<div id="status-label">Ready</div>');
        await open("A", "text");
        failNextSave();
        win.NP.editor.el.textContent = "changed";
        await win.NP.editor.save(true);
        expect(win.NP.dialog.failed).not.toHaveBeenCalled();
        expect(win.document.getElementById("status-label").textContent).toBe("not saved");
    });
});

describe("a note in the trash (D8)", () => {
    it("opens read-only, offers Restore and is never saved", async () => {
        win.NP.toast = vi.fn();
        const p = win.NP.editor.loadNote("A");
        pending.A({ content: "old text", formats: [], trashed: true });
        await p;
        expect(win.NP.editor.el.textContent).toContain("old text");
        expect(win.NP.editor.el.contentEditable).toBe("false");
        expect(win.NP.toast.mock.calls[0][1].actionLabel).toBe("Restore");
        await win.NP.editor.save(false);
        expect(saved).toEqual([]);
    });

    it("a note that cannot be loaded leaves nothing selected", async () => {
        win.NP.api.getNote = vi.fn(() => Promise.reject(new Error("The note no longer exists.")));
        await win.NP.editor.loadNote("B");
        expect(win.NP.editor._currentNoteId).toBeNull();
        expect(win.NP.state.currentNoteId).toBeNull();
    });
});

describe("G5: status bar", () => {
    const BAR = '<span id="status-label" hidden><span class="status-dot"></span><span class="status-text"></span></span>' +
        '<span id="mode-label"></span>';
    const status = () => win.document.getElementById("status-label");

    it("hidden with no note; ● saved after opening; ○ not saved after typing; saved again after the save", async () => {
        win.document.body.insertAdjacentHTML("beforeend", BAR);
        win.NP.editor._renderStatus();
        expect(status().hidden).toBe(true);
        await open("A", "text");
        expect(status().hidden).toBe(false);
        expect(status().textContent).toBe("saved");
        expect(status().classList.contains("status-dirty")).toBe(false);
        expect(win.document.getElementById("mode-label").textContent).toBe("text");

        win.NP.editor.el.textContent = "text + more";
        win.NP.editor.el.dispatchEvent(new win.Event("input", { bubbles: true }));
        expect(status().textContent).toBe("not saved");
        expect(status().classList.contains("status-dirty")).toBe(true);

        await win.NP.editor.save(true);
        expect(status().textContent).toBe("saved");
        expect(status().classList.contains("status-dirty")).toBe(false);
    });

    it("typing and undoing it before the autosave counts as saved", async () => {
        win.document.body.insertAdjacentHTML("beforeend", BAR);
        await open("A", "text");
        await win.NP.editor.save(true);                 // remembers what is stored
        win.NP.editor.el.textContent = "texts";
        win.NP.editor.el.dispatchEvent(new win.Event("input", { bubbles: true }));
        win.NP.editor.el.textContent = "text";
        await win.NP.editor.save(true);                 // nothing to write
        expect(status().textContent).toBe("saved");
    });

    it("a failed save stays visible (with the reason) until a save succeeds", async () => {
        win.document.body.insertAdjacentHTML("beforeend", BAR);
        await open("A", "text");
        win.NP.api.saveNote = vi.fn(() => Promise.reject(new Error("disk full")));
        win.NP.dialog = { failed: vi.fn() };
        win.NP.editor.el.textContent = "changed";
        await win.NP.editor.save(true);
        expect(status().classList.contains("status-error")).toBe(true);
        expect(status().title).toBe("disk full");
        win.NP.editor.el.dispatchEvent(new win.Event("input", { bubbles: true }));
        expect(status().classList.contains("status-error")).toBe(true);   // typing does not hide it
    });
});
