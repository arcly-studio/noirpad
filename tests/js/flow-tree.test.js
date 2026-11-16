// Review 2, tree and tags: T5, T6, T7, T8, T9. Real state/tabs/editor/tree
// (+ tags.js, topbar.js) against the in-memory server of flow.js.
import { describe, expect, it, vi } from "vitest";
import { BODY, flush, startApp } from "./flow.js";

const TREE = [
    { id: "F", name: "Empty", type: "folder", children: [] },
    { id: "A", name: "Alpha", type: "note", tags: ["work"] },
    { id: "B", name: "Beta", type: "note" },
];
const NOTES = { A: "text of A", B: "text of B" };
const WITH_TAGS = BODY.replace('<div id="tag-bar"></div>',
    '<div id="tag-bar"><input id="tag-input" maxlength="100"></div><button id="btn-favorite"></button>');

async function app(opts = {}) {
    const a = startApp({ tree: TREE, notes: NOTES, scripts: ["js/tags.js", "js/favorites.js"], body: WITH_TAGS, ...opts });
    await a.ready();
    return a;
}
const srvItem = (a, id) => a.srv.tree.find((t) => t.id === id) ||
    a.srv.trash.tree.find((t) => t.id === id);
const enter = (a) => a.win.document.getElementById("tag-input").dispatchEvent(
    new a.win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

describe("tags go to the note they were typed for (T5)", () => {
    it("a tab switch while the tag is being saved does not tag the next note", async () => {
        const a = await app();
        await a.open("A");
        await a.open("B");
        a.srv.holds["tags:B"] = true;
        const adding = a.NP.tags.addTag("urgent");     // on B
        await a.NP.tabs.activate("A");
        a.srv.holds["tags:B"]();
        await adding;
        await flush();
        expect(srvItem(a, "B").tags).toEqual(["urgent"]);
        expect(srvItem(a, "A").tags).toEqual(["work"]);
        // the local copy agrees with the server
        const local = (id) => a.NP.state.data.tree.find((t) => t.id === id).tags;
        expect(local("A")).toEqual(["work"]);
        expect(local("B")).toEqual(["urgent"]);
    });
});

describe("a refused tag is never lost silently (T6)", () => {
    it("a tag over 100 characters: the field keeps it and the user is told", async () => {
        const a = await app();
        await a.open("B");
        const input = a.win.document.getElementById("tag-input");
        input.value = "x".repeat(101);              // e.g. pasted past maxlength
        enter(a);
        await flush();
        expect(a.NP.dialog.alert).toHaveBeenCalledTimes(1);
        expect(a.NP.dialog.alert.mock.calls[0][0]).toContain("100");
        expect(input.value).toBe("x".repeat(101));
        expect(srvItem(a, "B").tags).toBeUndefined();
    });

    it("the 51st tag: the same", async () => {
        const fifty = Array.from({ length: 50 }, (_, i) => "t" + i);
        const a = await app({ tree: [{ id: "B", name: "Beta", type: "note", tags: fifty }] });
        await a.open("B");
        const input = a.win.document.getElementById("tag-input");
        input.value = "one-more";
        enter(a);
        await flush();
        expect(a.NP.dialog.alert.mock.calls[0][0]).toContain("50");
        expect(input.value).toBe("one-more");
    });

    it("a server error shows a dialog and keeps the text; success empties the field", async () => {
        const a = await app();
        await a.open("B");
        const input = a.win.document.getElementById("tag-input");
        a.NP.api.setTags.mockImplementationOnce(() => Promise.reject(new Error("Disk full")));
        input.value = "later";
        enter(a);
        await flush();
        expect(a.NP.dialog.failed).toHaveBeenCalledTimes(1);
        expect(input.value).toBe("later");
        enter(a);
        await flush();
        expect(input.value).toBe("");
        expect(srvItem(a, "B").tags).toEqual(["later"]);
    });
});

describe("the tag filter (T7)", () => {
    it("removing the filtered tag from its last note turns the filter off", async () => {
        const a = await app();
        await a.open("A");
        a.NP.tree.setTagFilter("work");
        await a.NP.tags.removeTag("work");
        expect(a.NP.tree.tagFilter).toBe(null);
        expect(a.win.document.querySelector("#tree-container .tree-empty")).toBe(null);
    });
});

describe("→ on an open empty folder (T8)", () => {
    it("stays on the folder instead of jumping to the next item", async () => {
        const a = await app();
        a.NP.state.setFolderOpenState("F", true);
        a.NP.tree.render();
        const row = (id) => a.win.document.querySelector(`#tree-container .tree-item[data-id="${id}"]`);
        row("F").focus();
        row("F").dispatchEvent(new a.win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
        expect(a.win.document.activeElement).toBe(row("F"));
    });
});

describe("a note shown from the trash (T9)", () => {
    async function trashed() {
        const a = await app();
        await a.open("B");
        await a.NP.tree.deleteSelected("A");
        await flush();
        a.win.document.querySelector('#tree-container .tree-item--trash[data-id="A"]').click();
        await vi.waitFor(() => expect(a.win.document.getElementById("note-title-input").value).toBe("Alpha"));
        return a;
    }

    it("shows its name; tags and the star are off instead of failing silently", async () => {
        const a = await trashed();
        expect(a.NP.editor._currentNoteId).toBe("A");
        expect(a.win.document.getElementById("note-title-input").value).toBe("Alpha");
        expect(a.win.document.getElementById("tag-input").disabled).toBe(true);
        expect(a.win.document.getElementById("btn-favorite").disabled).toBe(true);
        await a.NP.favorites.toggle();
        expect(a.NP.api.toggleFavorite).not.toHaveBeenCalled();
    });

    it("restored with ↩ in the tree, it is editable again", async () => {
        const a = await trashed();
        expect(a.NP.editor.el.contentEditable).toBe("false");
        a.win.document.querySelector('.tree-item--trash[data-id="A"] .tree-trash-restore').click();
        await vi.waitFor(() => expect(a.NP.editor.el.contentEditable).toBe("true"));
        expect(a.win.document.getElementById("tag-input").disabled).toBe(false);
        a.type("edited after restore");
        await a.NP.editor.save(true);
        expect(a.srv.notes.A).toBe("edited after restore");
    });
});
