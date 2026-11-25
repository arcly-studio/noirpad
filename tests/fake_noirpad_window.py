"""A running NoirPad for test_second_start.py: holds the lock of a data folder and
has a small minimised window like pywebview's (same class prefix and title),
far off the screen. Not a test. Ends when its stdin closes.

    python fake_noirpad_window.py <data dir> [hidden]
"""

import ctypes
import sys
import threading
from ctypes import wintypes
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import desktop  # noqa: E402
from noirpad import storage  # noqa: E402

user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
WNDPROC = ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wintypes.HWND, wintypes.UINT, ctypes.c_size_t, ctypes.c_ssize_t)
user32.DefWindowProcW.restype = ctypes.c_ssize_t
user32.DefWindowProcW.argtypes = [wintypes.HWND, wintypes.UINT, ctypes.c_size_t, ctypes.c_ssize_t]
user32.CreateWindowExW.restype = wintypes.HWND
user32.CreateWindowExW.argtypes = [wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                   ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                   wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, ctypes.c_void_p]


class WNDCLASS(ctypes.Structure):
    _fields_ = [("style", wintypes.UINT), ("proc", WNDPROC), ("cls", ctypes.c_int), ("wnd", ctypes.c_int),
                ("inst", wintypes.HINSTANCE), ("icon", wintypes.HANDLE), ("cursor", wintypes.HANDLE),
                ("brush", wintypes.HANDLE), ("menu", wintypes.LPCWSTR), ("name", wintypes.LPCWSTR)]


data = Path(sys.argv[1])
lock = storage.acquire_instance_lock(data)
assert lock is not None
proc = WNDPROC(user32.DefWindowProcW)
name = "WindowsForms10.Window.8.app.0.noirpadtest"
cls = WNDCLASS(0, proc, 0, 0, None, None, None, None, None, name)
assert user32.RegisterClassW(ctypes.byref(cls))
hwnd = user32.CreateWindowExW(0, name, desktop.WINDOW_TITLE, 0x00CF0000, -20000, -20000, 200, 120,
                              None, None, None, None)
assert hwnd
user32.ShowWindow(hwnd, 7)                   # SW_SHOWMINNOACTIVE
if hasattr(desktop, "_mark_window"):         # before the fix there was only the title
    assert desktop._mark_window(data)
if "hidden" in sys.argv:
    user32.ShowWindow(hwnd, 0)
thread = kernel32.GetCurrentThreadId()


def end():
    sys.stdin.read()
    user32.PostThreadMessageW(thread, 0x12, 0, 0)      # WM_QUIT


threading.Thread(target=end, daemon=True).start()
print(hwnd, flush=True)
msg = wintypes.MSG()
while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
    user32.DispatchMessageW(ctypes.byref(msg))
