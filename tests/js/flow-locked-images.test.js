// N1.4: images are not encrypted. Said when a note with images is locked and
// when an image goes into a note that is already locked. Never alert/confirm.
import { describe, expect, it, vi } from "vitest";
import { flush, startApp } from "./flow.js";

const TREE = [{ id: "A", name: "Alpha", type: "note" }];
const IMAGE = "12345678-1234-4123-8123-123456789abc.png";
const ENVELOPE = JSON.stringify({ encrypted: true, data: "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" });
const NOTICE = "encryption.imagesNotEncrypted";

const MD = ["vendor/markdown-it/markdown-it.min.js", "vendor/markdown-it-task-lists/markdown-it-task-lists.min.js",
    "vendor/dompurify/purify.min.js", "vendor/highlight/highlight.min.js", "js/syntax-highlight.js",
    "js/md-source.js", "js/markdown.js"];
const OTHER_IMAGE = "abcdef12-1234-4123-8123-123456789abc.png";

async function app(content, unlocked = content, scripts = [], modes = {}) {
    const a = startApp({
        tree: TREE, notes: { A: content }, modes,
        scripts: ["js/encryption.js", "js/images.js", ...scripts],
    });
    const seen = { warning: null };
    a.NP.toast = vi.fn();
    a.NP.passwordDialog = {
        ask: vi.fn((opts) => { seen.warning = opts.warning; return Promise.resolve("heslo-dlouhe"); }),
    };
    a.NP.api.encrypt = vi.fn(() => Promise.resolve({ ok: true, unlock_token: "tok" }));
    a.NP.api.unlock = vi.fn(() => Promise.resolve({ content: unlocked, formats: [], unlock_token: "tok" }));
    a.NP.api.saveEncrypted = vi.fn(() => Promise.resolve({ ok: true }));
    a.NP.api.uploadImage = vi.fn(() => Promise.resolve({ url: "/images/" + IMAGE, filename: IMAGE }));
    await a.ready();
    await a.open("A");
    await flush();
    return { a, seen };
}

const noticesIn = (a) => a.NP.toast.mock.calls.filter((c) => c[0] === a.NP.t(NOTICE)).length;
const noModalBoxes = (a) => {
    expect(a.NP.dialog.alert).not.toHaveBeenCalled();
    expect(a.NP.dialog.confirm).not.toHaveBeenCalled();
};

describe("a stored image linked by hand in a locked Markdown note", () => {
    const lockedMd = (unlocked) => app(ENVELOPE, unlocked, MD, { A: "markdown" });
    const typeAndSave = async (a, text) => {
        a.win.document.getElementById("editor-md").value = text;
        expect(await a.NP.editor.save(true)).toBe(true);
        await flush();
    };

    it("the first save with the new link says so, once per note and session", async () => {
        const { a } = await lockedMd("jen text");
        expect(a.NP.markdown.isActive()).toBe(true);
        await typeAndSave(a, `text ![](/images/${IMAGE})`);
        expect(noticesIn(a)).toBe(1);
        await typeAndSave(a, `text ![](/images/${IMAGE}) a ![](/images/${OTHER_IMAGE})`);
        expect(noticesIn(a)).toBe(1);
        noModalBoxes(a);
    });

    it("a link the note already had is not new", async () => {
        const { a } = await lockedMd(`text ![](/images/${IMAGE})`);
        await typeAndSave(a, `víc textu ![](/images/${IMAGE})`);
        expect(noticesIn(a)).toBe(0);
    });

    it("a half-typed link says nothing yet", async () => {
        const { a } = await lockedMd("jen text");
        await typeAndSave(a, "text ![](/images/12345678-12");
        expect(noticesIn(a)).toBe(0);
    });

    it("a save that failed says nothing, the next one does", async () => {
        const { a } = await lockedMd("jen text");
        a.NP.api.saveEncrypted.mockImplementationOnce(() => Promise.reject(Object.assign(new Error("Disk full"), { status: 507 })));
        a.win.document.getElementById("editor-md").value = `text ![](/images/${IMAGE})`;
        expect(await a.NP.editor.save(true)).toBe(false);
        expect(noticesIn(a)).toBe(0);
        await typeAndSave(a, `text 2 ![](/images/${IMAGE})`);
        expect(noticesIn(a)).toBe(1);
    });

    it("a plain Markdown note: no notice", async () => {
        const { a } = await app("jen text", "jen text", MD, { A: "markdown" });
        await typeAndSave(a, `text ![](/images/${IMAGE})`);
        expect(noticesIn(a)).toBe(0);
    });

    it("an uploaded image is not announced twice by its own save", async () => {
        const { a } = await lockedMd("jen text");
        await a.NP.images.upload(new a.win.Blob(["x"]));
        await flush();
        expect(noticesIn(a)).toBe(1);
    });
});

describe("locking a note with images", () => {
    it("the password dialog says images are not encrypted", async () => {
        const { a, seen } = await app(`before <<IMG:${IMAGE}>> after`);
        await a.NP.encryption.encrypt();
        expect(seen.warning).toContain(a.NP.t(NOTICE));
        expect(seen.warning).toContain(a.NP.t("encryption.lockWarning"));
        expect(a.NP.api.encrypt).toHaveBeenCalled();
        noModalBoxes(a);
    });

    it("a note with a stored image link counts too", async () => {
        const { a, seen } = await app(`see /images/${IMAGE}`);
        await a.NP.encryption.encrypt();
        expect(seen.warning).toContain(a.NP.t(NOTICE));
    });

    it("a note without images only gets the usual warning", async () => {
        const { a, seen } = await app("just text about /images/ in general");
        await a.NP.encryption.encrypt();
        expect(seen.warning).toBe(a.NP.t("encryption.lockWarning"));
    });
});

describe("an image going into a note", () => {
    it("a locked note: inline notice, and the image is saved encrypted", async () => {
        const { a } = await app(ENVELOPE, "tajný text");
        expect(a.NP.editor._unlockToken).toBe("tok");
        await a.NP.images.upload(new a.win.Blob(["x"]));
        await flush();
        expect(noticesIn(a)).toBe(1);
        const saved = a.NP.api.saveEncrypted.mock.calls.at(-1);
        expect(saved[2]).toContain("<<IMG:" + IMAGE);
        noModalBoxes(a);
    });

    it("a locked note, pasted as a link: the same notice", async () => {
        const { a } = await app(ENVELOPE, "tajný text");
        await a.NP.images._uploadAsLink(new a.win.Blob(["x"]));
        await flush();
        expect(noticesIn(a)).toBe(1);
        noModalBoxes(a);
    });

    it("a locked note, an image from another note pasted: the same notice", async () => {
        const { a } = await app(ENVELOPE, "tajný text", ["vendor/dompurify/purify.min.js", "js/paste.js"]);
        const paste = (html) => a.NP.paste._onPaste({
            preventDefault() {}, defaultPrevented: false,
            clipboardData: { getData: (type) => (type === "text/html" ? html : "text") },
        });
        const box = a.win.document.getElementById("editor");
        box.setAttribute("contenteditable", "true");   // jsdom does not reflect the property
        a.win.getSelection().selectAllChildren(box);
        paste(`<img data-filename="${IMAGE}">`);
        expect(noticesIn(a)).toBe(1);
        paste("<b>jen text</b>");
        expect(noticesIn(a)).toBe(1);
        noModalBoxes(a);
    });

    it("a plain note: no notice", async () => {
        const { a } = await app("obyčejný text");
        await a.NP.images.upload(new a.win.Blob(["x"]));
        await flush();
        expect(noticesIn(a)).toBe(0);
    });

    it("the note was switched meanwhile: no notice, nothing inserted", async () => {
        const { a } = await app(ENVELOPE, "tajný text");
        a.NP.editor._loadedNoteId = "other";
        await a.NP.images.upload(new a.win.Blob(["x"]));
        await flush();
        expect(noticesIn(a)).toBe(0);
    });
});
