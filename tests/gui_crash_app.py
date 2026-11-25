"""A real NoirPad of its own for test_view_recovery.py: types into a note without a
pause, kills a WebView2 process of THIS window (found by its own data folder in
the command line), lets it be restored and prints what is left. Not a test.

    python gui_crash_app.py <empty data dir> browser|renderer
"""

import ctypes
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
data, victim = Path(sys.argv[1]), sys.argv[2]
assert os.environ["NOIRPAD_DATA_DIR"] == str(data)
data.mkdir(parents=True)

import desktop  # noqa: E402

boxes = []


def box(text, flags):                      # instead of a window that waits for a click
    boxes.append(text)
    return desktop.IDYES


desktop._message_box = box
out = {"killed": 0}


def js(code, seconds=8):
    """The page's answer, or None when it does not answer."""
    import webview
    got = {}
    t = threading.Thread(target=lambda: got.update(v=webview.windows[0].evaluate_js(code)), daemon=True)
    t.start()
    t.join(seconds)
    return got.get("v")


def own_webview():
    cmd = ("Get-CimInstance Win32_Process -Filter \"Name='msedgewebview2.exe'\" | "
           "ForEach-Object { \"$($_.ProcessId)|$($_.CommandLine)\" }")
    text = subprocess.run(["powershell", "-NoProfile", "-Command", cmd], capture_output=True, text=True).stdout
    for line in text.splitlines():
        pid, _, args = line.partition("|")
        if str(data).lower() in args.lower():
            kind = "renderer" if "--type=renderer" in args else "other" if "--type=" in args else "browser"
            yield pid, kind


def wait(cond, seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if cond():
            return True
        time.sleep(0.2)
    return False


def drive():
    from noirpad.runtime import RUNTIME
    import webview
    if not wait(RUNTIME.page_ready.is_set, 30):
        os._exit(3)
    time.sleep(1.5)
    hwnd = desktop._find_app_window(data)
    js("window.__made = 0; NP.api.newNote(null, 'Crash').then(function () { window.__made = 1; }); 1")
    wait(lambda: js("window.__made") == 1, 8)
    js("window.__done = 0; NP.state.init().then(function () { NP.tree.render(); window.__done = 1; }); 1")
    wait(lambda: js("window.__done") == 1, 8)
    js("""(function () { var id = null;
        (function walk(t) { (t || []).forEach(function (i) { if (i.name === "Crash") id = i.id; walk(i.children); }); })(NP.state.data.tree);
        if (id) NP.tabs.add(id, "Crash"); return id; })()""")
    time.sleep(1.5)
    js("""(function () { window.__n = 0; var ed = document.getElementById("editor"); ed.focus();
        window.__t = setInterval(function () { document.execCommand("insertText", false, "z"); window.__n++; }, 120); return 1; })()""")
    pids = [pid for pid, kind in own_webview() if kind == victim]
    time.sleep(5)
    out["typed"] = js("window.__n")
    for pid in pids:
        subprocess.run(["taskkill", "/PID", pid, "/F"], capture_output=True)
        out["killed"] += 1
    time.sleep(1)
    out["restored"] = wait(lambda: RUNTIME.page_ready.is_set() and js("!!(window.NP && NP.state && NP.state.data)", 3) is True, 25)
    out["toast"] = wait(lambda: bool(js("!!document.querySelector('.np-toast')", 3)), 8)
    out["open_note"] = js("NP.state.activeTabId") is not None
    out["text"] = js("document.getElementById('editor').textContent.length") or 0
    out["same_window"] = bool(hwnd) and bool(ctypes.windll.user32.IsWindow(hwnd)) and desktop._find_app_window(data) == hwnd
    js("""(function () { var ed = document.getElementById("editor"); ed.focus();
        var r = document.createRange(); r.selectNodeContents(ed); r.collapse(false);
        getSelection().removeAllRanges(); getSelection().addRange(r);
        document.execCommand("insertText", false, "AFTER"); return 1; })()""")
    time.sleep(2.5)
    out["typing_works"] = "AFTER" in (data / "notes_data.json").read_text(encoding="utf-8")
    out["boxes"] = len(boxes)
    started = time.monotonic()
    ctypes.windll.user32.PostMessageW(hwnd, 0x10, 0, 0)
    for _ in range(100):
        if not webview.windows:
            break
        time.sleep(0.2)
    out["exit_seconds"] = round(time.monotonic() - started, 1)
    print("RESULT " + json.dumps(out), flush=True)
    time.sleep(8)
    os._exit(0)


threading.Thread(target=drive, daemon=True).start()
threading.Timer(100, lambda: os._exit(4)).start()
desktop.main([])
time.sleep(10)
