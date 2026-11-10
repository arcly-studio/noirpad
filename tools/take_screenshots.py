"""README screenshots (and the demo GIF) from the real desktop window.

Starts `desktop.py` (WebView2) on a fresh temp NOIRPAD_DATA_DIR seeded by
tools/demo_data.py — real notes are never read or touched — with
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>, and
drives it over the Chrome DevTools Protocol. The page is emulated at
1280×800, scale 1, whatever the screen's DPI. Dev-only requirements (not in
requirements*.txt): `pip install playwright`; ffmpeg and oxipng on PATH
(e.g. `winget install Gyan.FFmpeg oxipng`).

    .venv\\Scripts\\python tools/take_screenshots.py            # docs/screenshots/*.png
    .venv\\Scripts\\python tools/take_screenshots.py --gif      # + docs/demo.gif
    .venv\\Scripts\\python tools/take_screenshots.py --only gif # just the GIF

A NoirPad window appears while it runs; don't type into it.
"""

import argparse
import base64
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))

import demo_data  # noqa: E402

SHOTS_DIR = ROOT / "docs" / "screenshots"
GIF_PATH = ROOT / "docs" / "demo.gif"
VIEW = {"width": 1280, "height": 800}
# Main theme for the hero shots: the signature terminal green reads best on
# GitHub's light and dark pages and is what NoirPad looks like out of the box.
HERO_THEME = "matrix"
# The Markdown split view: a calmer theme where the syntax colours stand out.
SPLIT_THEME = "tokyo-night"
COLLAGE_THEMES = ["matrix", "tokyo-night", "amber", "dracula"]
CDP_PORT = 9333


class App:
    """desktop.py with a demo data dir, driven over CDP."""

    def __init__(self, pw, lang: str, port: int = CDP_PORT):
        self.tmp = tempfile.TemporaryDirectory(prefix="noirpad-shots-", ignore_cleanup_errors=True)
        data_dir = Path(self.tmp.name) / "data"
        demo_data.write_demo(data_dir, lang)
        env = dict(os.environ, NOIRPAD_DATA_DIR=str(data_dir),
                   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=f"--remote-debugging-port={port}")
        env.pop("NOIRPAD_PASSWORD", None)
        self.proc = subprocess.Popen([sys.executable, "desktop.py"], cwd=str(ROOT), env=env)
        endpoint = f"http://127.0.0.1:{port}"
        deadline = time.time() + 40
        while True:
            try:
                urllib.request.urlopen(endpoint + "/json/version", timeout=1).read()
                break
            except OSError:
                if time.time() > deadline or self.proc.poll() is not None:
                    self.close()
                    raise RuntimeError("NoirPad's WebView2 did not open the debugging port")
                time.sleep(0.3)
        self.browser = pw.chromium.connect_over_cdp(endpoint)
        self.page = self._app_page()
        self.cdp = self.page.context.new_cdp_session(self.page)
        self.cdp.send("Emulation.setDeviceMetricsOverride", {
            **VIEW, "deviceScaleFactor": 1, "mobile": False})
        self.page.wait_for_function(
            "() => window.NP && NP.state && NP.state.data && NP.tree"
            " && !document.getElementById('splash-overlay')", timeout=20_000)
        self.page.wait_for_timeout(800)

    def _app_page(self):
        # page.url can still say about:blank when we attach; ask the page.
        for _ in range(100):
            for ctx in self.browser.contexts:
                for page in ctx.pages:
                    try:
                        if page.evaluate("location.href").startswith("http://127.0.0.1"):
                            return page
                    except Exception:
                        pass
            time.sleep(0.2)
        raise RuntimeError("NoirPad page not found over CDP")

    def close(self) -> None:
        try:
            self.browser.close()
        except Exception:
            pass
        # The venv's python.exe is a launcher with a child: stop the tree.
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(self.proc.pid)], capture_output=True)
        self.proc.wait(timeout=15)
        time.sleep(1.5)   # WebView2 lets go of the profile
        self.tmp.cleanup()

    # ---- helpers -------------------------------------------------------------

    def theme(self, name: str) -> None:
        self.page.evaluate("(t) => NP.themes.apply(t)", name)
        self.page.wait_for_timeout(700)

    def open_note(self, note_id: str) -> None:
        """Expand the note's folders, then click its tree row."""
        self.page.evaluate("""(id) => {
            function path(tree, target, acc) {
                for (const it of tree) {
                    if (it.id === target) return acc;
                    if (it.children) {
                        const r = path(it.children, target, [...acc, it.id]);
                        if (r) return r;
                    }
                }
                return null;
            }
            for (const fid of path(NP.state.data.tree, id, []) || [])
                NP.state.setFolderOpenState(fid, true);
            NP.tree.render();
            document.querySelector(`#tree-container .tree-item[data-id='${id}']`).click();
        }""", note_id)
        self.page.wait_for_timeout(1200)

    def open_folders(self, *folder_ids: str) -> None:
        self.page.evaluate("""(ids) => { ids.forEach((f) => NP.state.setFolderOpenState(f, true));
                                         NP.tree.render(); }""", list(folder_ids))
        self.page.wait_for_timeout(300)

    def shot(self, path: Path) -> Path:
        data = self.cdp.send("Page.captureScreenshot", {"format": "png"})["data"]
        path.write_bytes(base64.b64decode(data))
        return path


MAX_PNG = 300 * 1024


def optimize(path: Path) -> None:
    """Lossless oxipng; above MAX_PNG first a 256-colour palette (ffmpeg)."""
    if path.stat().st_size > MAX_PNG and shutil.which("ffmpeg"):
        tmp = path.with_suffix(".q.png")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-vf",
                        "split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];"
                        "[b][p]paletteuse=dither=none", str(tmp)],
                       check=True, stdin=subprocess.DEVNULL)
        tmp.replace(path)
    if shutil.which("oxipng"):
        subprocess.run(["oxipng", "-o", "4", "--strip", "safe", "-q", str(path)], check=True,
                       stdin=subprocess.DEVNULL)
    print(f"  -> {path.relative_to(ROOT)} ({path.stat().st_size // 1024} kB)", flush=True)


def collage(tiles: list[Path], out: Path) -> None:
    """2×2 grid with a 12 px gap, scaled to 1280 px wide (ffmpeg)."""
    inputs = sum((["-i", str(t)] for t in tiles), [])
    graph = ("[0]pad=iw+12:ih+12:0:0:black[a];[1]pad=iw:ih+12:0:0:black[b];"
             "[2]pad=iw+12:ih:0:0:black[c];[a][b]hstack[top];[c][3]hstack[bot];"
             "[top][bot]vstack,scale=1280:-1:flags=lanczos")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *inputs, "-filter_complex", graph,
                    "-frames:v", "1", str(out)], check=True, stdin=subprocess.DEVNULL)


# ---- the shots ---------------------------------------------------------------

def screenshots(pw) -> None:
    SHOTS_DIR.mkdir(parents=True, exist_ok=True)
    app = App(pw, "en")
    try:
        app.theme(HERO_THEME)
        app.open_folders(demo_data.PROJECTS_ID)
        app.open_note(demo_data.PHOTO_ID)          # rich text with a picture, no split view
        optimize(app.shot(SHOTS_DIR / "hero.png"))

        app.theme(SPLIT_THEME)
        app.open_note(demo_data.CHECKLIST_ID)      # Markdown: table, code, tasks
        optimize(app.shot(SHOTS_DIR / "split-preview.png"))
        app.theme(HERO_THEME)

        app.open_note(demo_data.TOUR_ID)
        with tempfile.TemporaryDirectory() as tmp:
            tiles = []
            for name in COLLAGE_THEMES:
                app.theme(name)
                tiles.append(app.shot(Path(tmp) / f"{name}.png"))
            collage(tiles, SHOTS_DIR / "themes.png")
        optimize(SHOTS_DIR / "themes.png")
        app.theme(HERO_THEME)

        app.page.keyboard.press("Control+Shift+P")
        app.page.wait_for_timeout(400)
        app.page.keyboard.type(":e", delay=60)
        app.page.wait_for_timeout(600)
        optimize(app.shot(SHOTS_DIR / "command-palette.png"))
        app.page.keyboard.press("Escape")
        app.page.wait_for_timeout(400)

        app.open_note(demo_data.READING_ID)
        app.page.keyboard.press("Control+Shift+L")   # "Lock note": password twice + warning
        app.page.wait_for_selector("#np-pw-2")
        app.page.fill("#np-pw-1", demo_data.DEMO_PASSWORD)   # shown as dots
        app.page.fill("#np-pw-2", demo_data.DEMO_PASSWORD)
        app.page.wait_for_timeout(300)
        optimize(app.shot(SHOTS_DIR / "encryption.png"))
    finally:
        app.close()

    app = App(pw, "cs")
    try:
        app.theme(HERO_THEME)
        app.open_folders(demo_data.PROJECTS_ID)
        app.open_note(demo_data.PHOTO_ID)
        optimize(app.shot(SHOTS_DIR / "hero-cs.png"))
    finally:
        app.close()


GIF_MARKDOWN = [
    "# Deploy notes\n\n",
    "Steps for the **staging** server:\n\n",
    "```python\n",
    "def deploy(env: str) -> None:\n",
    "    run(f\"make release ENV={env}\")\n",
    "```\n\n",
    "- [x] Backup database\n",
    "- [ ] Smoke test\n",
]


def demo_gif(pw) -> None:
    """New note → Markdown with a code block → split view → theme → lock."""
    if not shutil.which("ffmpeg"):
        raise SystemExit("ffmpeg is needed for the GIF")
    app = App(pw, "en")
    frames: list[tuple[float, bytes]] = []
    try:
        page, cdp = app.page, app.cdp
        app.theme(HERO_THEME)

        def on_frame(ev):
            frames.append((ev["metadata"]["timestamp"], base64.b64decode(ev["data"])))
            cdp.send("Page.screencastFrameAck", {"sessionId": ev["sessionId"]})

        cdp.on("Page.screencastFrame", on_frame)
        cdp.send("Page.startScreencast", {"format": "jpeg", "quality": 92,
                                          "maxWidth": VIEW["width"], "maxHeight": VIEW["height"],
                                          "everyNthFrame": 1})
        pause = 800
        page.wait_for_timeout(pause)
        # 1. new note
        page.click("#btn-new-note")
        page.wait_for_selector("#np-dialog-input")
        page.wait_for_timeout(300)
        page.keyboard.type("Deploy notes", delay=40)
        page.wait_for_timeout(300)
        page.keyboard.press("Enter")
        page.wait_for_timeout(pause)
        # 2. Markdown mode = split view: raw on the left, live preview on the right
        page.keyboard.press("Control+M")
        page.wait_for_timeout(pause)
        page.click("#editor-md")
        for chunk in GIF_MARKDOWN:
            page.keyboard.type(chunk, delay=16)
        page.wait_for_timeout(pause + 200)
        # 3. switch the theme from the command bar
        page.keyboard.press("Control+Shift+P")
        page.wait_for_timeout(250)
        page.keyboard.type(":theme midnight", delay=30)   # shown name of tokyo-night (N1.6)
        page.wait_for_timeout(300)
        page.keyboard.press("Enter")
        page.wait_for_timeout(pause + 200)
        # 4. lock the note with a password
        page.keyboard.press("Control+Shift+L")
        page.wait_for_selector("#np-pw-1")
        page.wait_for_timeout(300)
        page.keyboard.type("correct horse", delay=28)
        page.click("#np-pw-2")
        page.keyboard.type("correct horse", delay=28)
        page.wait_for_timeout(300)
        page.keyboard.press("Enter")
        page.wait_for_timeout(pause + 700)
        cdp.send("Page.stopScreencast")
    finally:
        app.close()
    build_gif(frames)


def build_gif(frames: list[tuple[float, bytes]]) -> None:
    """Frames with their own durations → 960 px, 15 fps, palettegen/paletteuse."""
    if len(frames) < 10:
        raise SystemExit(f"only {len(frames)} frames captured")
    # Screencast frames can arrive in bursts with (almost) the same
    # timestamp: keep the newest picture per 1/30 s so the GIF's timing is
    # the real one.
    merged: list[tuple[float, bytes]] = []
    for ts, data in frames:
        if merged and ts - merged[-1][0] < 1 / 30:
            merged[-1] = (merged[-1][0], data)
        else:
            merged.append((ts, data))
    frames = merged
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        lines = []
        for i, (ts, data) in enumerate(frames):
            name = f"f{i:05d}.jpg"
            (tmp / name).write_bytes(data)
            nxt = frames[i + 1][0] if i + 1 < len(frames) else ts + 1.0
            lines += [f"file '{name}'", f"duration {max(nxt - ts, 0.02):.3f}"]
        lines.append(f"file 'f{len(frames) - 1:05d}.jpg'")
        (tmp / "list.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        vf = ("fps=15,scale=960:-1:flags=lanczos,split[a][b];"
              "[a]palettegen=max_colors=128:stats_mode=diff[p];"
              "[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0",
                        "-i", str(tmp / "list.txt"), "-vf", vf, "-loop", "0", str(GIF_PATH)],
                       check=True, stdin=subprocess.DEVNULL)
    total = frames[-1][0] - frames[0][0] + 1.0
    print(f"  -> {GIF_PATH.relative_to(ROOT)} ({GIF_PATH.stat().st_size / 1e6:.1f} MB, {total:.1f} s, "
          f"{len(frames)} source frames)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gif", action="store_true", help="also record docs/demo.gif")
    parser.add_argument("--only", choices=["shots", "gif"], help="just one of them")
    args = parser.parse_args()
    with sync_playwright() as pw:
        if args.only != "gif":
            screenshots(pw)
        if args.gif or args.only == "gif":
            demo_gif(pw)


if __name__ == "__main__":
    main()
