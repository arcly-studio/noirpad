// Review 2, tab flows: E1, E2 (+R2 page side), E3, E4, T4, T2 (poll).
// Real state/tabs/editor/tree (+ app.js / markdown.js where the bug lives)
// against the in-memory server of flow.js. Each test fails without its fix.
import { describe, expect, it, vi } from "vitest";
import { flush, startApp } from "./flow.js";

const TREE = [
    { id: "A", name: "Alpha", type: "note" },
    { id: "B", name: "Beta", type: "note" },
    { id: "C", name: "Gamma", type: "note" },
];
const NOTES = { A: "text of A", B: "text of B", C: "text of C" };
const MD = ["vendor/markdown-it/markdown-it.min.js", "vendor/markdown-it-task-lists/markdown-it-task-lists.min.js",
    "vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/syntax-highlight.js",
    "js/md-source.js", "js/markdown.js"];

async function app(opts = {}) {
    const a = startApp({ tree: TREE, notes: NOTES, ...opts });
    await a.ready();
    return a;
}

const AUTOSAVE = 1100;   // the editor saves 1 s after typing stops

describe("a click on the tab that is already open (E1)", () => {
    it("keeps what was typed in the last second", async () => {
        const a = await app();
        await a.open("A");
        a.type("text of A + typed just now");
        await a.NP.tabs.activate("A");          // click on its own tab
        await flush(AUTOSAVE);
        expect(a.NP.editor.el.textContent).toBe("text of A + typed just now");
        expect(a.srv.notes.A).toBe("text of A + typed just now");
        expect(a.NP.api.getNote).toHaveBeenCalledTimes(1);    // not reloaded
    });

    it("the same for a click on the open note in the tree", async () => {
        const a = await app();
        await a.open("A");
        a.type("typed in A");
        a.NP.tree._onItemClick(null, "A", "note");
        await flush(AUTOSAVE);
        expect(a.NP.editor.el.textContent).toBe("typed in A");
        expect(a.srv.notes.A).toBe("typed in A");
    });
});

describe("a save that fails is never dropped on the way out (E2)", () => {
    it("switching tabs: the user is asked; 'stay' keeps the note and its text", async () => {
        const a = await app();
        await a.open("A");
        await a.open("B");
        a.srv.failSaves = true;
        a.type("B typed, disk full");
        a.srv.confirmAnswer = false;            // "Stay on the note"
        expect(await a.NP.tabs.activate("A")).toBe(false);
        expect(a.NP.dialog.confirm).toHaveBeenCalledTimes(1);
        expect(a.NP.dialog.confirm.mock.calls[0][0]).toContain("Beta");
        expect(a.NP.state.activeTabId).toBe("B");
        expect(a.NP.editor._currentNoteId).toBe("B");
        expect(a.NP.editor.el.textContent).toBe("B typed, disk full");
        // once the disk has room, the next switch saves it
        a.srv.failSaves = false;
        expect(await a.NP.tabs.activate("A")).toBe(true);
        expect(a.srv.notes.B).toBe("B typed, disk full");
        expect(a.NP.state.activeTabId).toBe("A");
    });

    it("switching tabs: 'discard' goes on to the other note", async () => {
        const a = await app();
        await a.open("A");
        await a.open("B");
        a.srv.failSaves = true;
        a.type("lost on purpose");
        a.srv.confirmAnswer = true;
        expect(await a.NP.tabs.activate("A")).toBe(true);
        expect(a.NP.state.activeTabId).toBe("A");
        expect(a.NP.editor.el.textContent).toBe("text of A");
    });

    it("a note opened while the save fails and the user stays gets no tab", async () => {
        const a = await app();
        await a.open("A");
        a.srv.failSaves = true;
        a.type("unsaved");
        a.srv.confirmAnswer = false;
        expect(await a.NP.tabs.add("C", "Gamma")).toBe(false);
        expect(a.tabs()).toEqual(["A"]);
    });

    it("closing the last tab asks too and keeps the tab when the user stays", async () => {
        const a = await app();
        await a.open("A");
        a.srv.failSaves = true;
        a.type("unsaved");
        a.srv.confirmAnswer = false;
        expect(await a.NP.tabs.close("A")).toBe(false);
        expect(a.tabs()).toEqual(["A"]);
        expect(a.NP.editor.el.textContent).toBe("unsaved");
    });

    it("closing the last tab saves typing, even after an earlier failed save", async () => {
        const a = await app();
        await a.open("A");
        a.srv.failSaves = true;
        a.type("first try");
        await a.NP.editor.save(true);           // the autosave failed
        a.srv.failSaves = false;
        expect(await a.NP.tabs.close("A")).toBe(true);
        expect(a.srv.notes.A).toBe("first try");
        expect(a.tabs()).toEqual([]);
    });

    it("closing the window (desktop): 'stay' when the save fails and the user stays (R2)", async () => {
        const a = await app();
        await a.open("A");
        a.srv.failSaves = true;
        a.type("unsaved at close");
        a.srv.confirmAnswer = false;
        const busy = [];
        a.NP.dialog.confirm.mockImplementation(() => { busy.push(a.NP.editor._closeBusy); return Promise.resolve(false); });
        expect(await a.NP.editor.flushForClose()).toBe("stay");
        expect(busy).toEqual(["asking"]);       // desktop.py keeps waiting meanwhile
        expect(a.NP.editor._closeBusy).toBe(false);
        a.srv.failSaves = false;
        expect(await a.NP.editor.flushForClose()).toBe("close");
        expect(a.srv.notes.A).toBe("unsaved at close");
    });
});

describe("renaming in the title, then Ctrl+Tab / Ctrl+W / a tree click (E3)", () => {
    async function withTitle() {
        const a = await app({ scripts: ["js/app.js"] });
        a.NP.app.bindButtons();
        await a.open("A");
        await a.open("B");
        const title = a.win.document.getElementById("note-title-input");
        title.focus();
        title.value = "Beta renamed";
        return { a, title };
    }

    it("Ctrl+Tab renames the note the name was typed for", async () => {
        const { a } = await withTitle();
        await a.NP.tabs.next();
        await flush();
        expect(a.srv.tree.map((n) => n.name)).toEqual(["Alpha", "Beta renamed", "Gamma"]);
    });

    it("Ctrl+W the same", async () => {
        const { a } = await withTitle();
        await a.NP.tabs.closeCurrent();
        await flush();
        expect(a.srv.tree.map((n) => n.name)).toEqual(["Alpha", "Beta renamed", "Gamma"]);
    });

    it("a click on another note in the tree the same", async () => {
        const { a } = await withTitle();
        a.NP.tree._onItemClick(null, "C", "note");
        await flush();
        expect(a.srv.tree.map((n) => n.name)).toEqual(["Alpha", "Beta renamed", "Gamma"]);
        expect(a.win.document.getElementById("note-title-input").value).toBe("Gamma");
    });
});

describe("Ctrl+M while the next note is still loading (E4)", () => {
    it("does not write the previous note's text into it", async () => {
        const a = await app({ scripts: MD });
        await a.open("A");
        a.hold("B");
        const switching = a.NP.tabs.activate("B");
        await flush();
        a.NP.markdown.toggleForCurrentNote();   // Ctrl+M
        a.release("B");
        await switching;
        await flush();
        expect(a.srv.notes.B).toBe("text of B");
        expect(a.srv.saves.filter(([id]) => id === "B")).toEqual([]);
        expect(a.NP.editor.el.textContent).toBe("text of B");
    });
});

describe("Delete on the open tab (T4)", () => {
    it("the focus stays in the tab strip; a second Delete closes the next tab, not text", async () => {
        const a = await app();
        await a.open("A");
        a.type("n2");
        await a.open("B");
        const pill = (id) => a.win.document.querySelector(`.tab-pill[data-id="${id}"]`);
        const del = () => a.win.document.activeElement.dispatchEvent(
            new a.win.KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
        pill("B").focus();
        del();
        await vi.waitFor(() => expect(a.tabs()).toEqual(["A"]));
        expect(a.win.document.activeElement).toBe(pill("A"));
        expect(a.win.document.activeElement).not.toBe(a.NP.editor.el);
        del();
        await vi.waitFor(() => expect(a.tabs()).toEqual([]));
        expect(a.srv.notes.A).toBe("n2");
    });
});

describe("a note deleted or renamed in another window (T2, T10)", () => {
    it("the next poll closes its tab and shows the new names", async () => {
        const a = await app();
        await a.open("A");
        await a.open("B");
        a.NP.api.deleteItem("A");               // the other window
        await a.NP.api.rename("B", "Beta 2");
        await a.NP.state.poll();
        expect(a.tabs()).toEqual(["B"]);
        expect(a.NP.state.openTabs[0].name).toBe("Beta 2");
        expect(a.win.document.getElementById("note-title-input").value).toBe("Beta 2");
        expect(a.NP.state.activeTabId).toBe("B");
    });
});

describe("an untouched note is not written again (E8)", () => {
    it("switching away from it sends no save and never asks, even offline", async () => {
        const a = await app();
        await a.open("A");
        await a.open("B");
        await a.NP.tabs.activate("A");
        await a.NP.editor.save(true);           // the autosave timer
        expect(a.srv.saves).toEqual([]);
        a.srv.failSaves = true;
        expect(await a.NP.tabs.activate("B")).toBe(true);
        expect(a.NP.dialog.confirm).not.toHaveBeenCalled();
        expect(a.srv.refused).toEqual([]);
    });
});

describe("the open note trashed in another window while typing here (review)", () => {
    it("says that the typing could not be saved", async () => {
        const a = await app();
        a.NP.toast = (m) => toasts.push(m);
        const toasts = [];
        await a.open("A");
        a.type("typed here");
        a.NP.api.deleteItem("A");               // the other window
        await a.NP.state.poll();
        expect(a.tabs()).toEqual([]);
        expect(toasts).toEqual([a.NP.t("tabs.trashedElsewhere")]);
    });
});
