"""Which NoirPad this is: the GitHub edition (Inno Setup) or the Store edition (MSIX).

The Store edition runs from an MSIX package; Windows gives a packaged
process a package identity (GetCurrentPackageFullName). Differences:

  * data folder: Store %USERPROFILE%\\NoirPad, GitHub %LOCALAPPDATA%\\NoirPad.
    MSIX redirects writes under AppData to a private copy that uninstalling
    deletes; the user's notes must outlive the package, so the Store edition
    keeps them outside AppData (ROADMAP N1.9).
  * the Store edition does not hold the installer mutex (that one belongs to
    the GitHub edition's Inno Setup) and imports the GitHub edition's notes
    once (noirpad/store_import.py).

NOIRPAD_EDITION=github|store overrides the detection (tests, smoke test).
"""

import os
import sys
from pathlib import Path

GITHUB = "github"
STORE = "store"

_APPMODEL_ERROR_NO_PACKAGE = 15700
_ERROR_INSUFFICIENT_BUFFER = 122


def is_packaged() -> bool:
    """True inside an MSIX package (the process has a package identity)."""
    if sys.platform != "win32":
        return False
    import ctypes
    from ctypes import wintypes

    length = wintypes.UINT(0)
    try:
        rc = ctypes.windll.kernel32.GetCurrentPackageFullName(ctypes.byref(length), None)
    except (AttributeError, OSError):
        return False
    return rc == _ERROR_INSUFFICIENT_BUFFER


def edition() -> str:
    forced = os.environ.get("NOIRPAD_EDITION", "").strip().lower()
    if forced in (GITHUB, STORE):
        return forced
    return STORE if is_packaged() else GITHUB


def github_data_dir() -> Path:
    """%LOCALAPPDATA%\\NoirPad, where the GitHub edition keeps its notes."""
    from platformdirs import user_data_dir
    return Path(user_data_dir("NoirPad", appauthor=False))


def store_data_dir() -> Path:
    """%USERPROFILE%\\NoirPad: outside AppData, so it survives uninstalling."""
    return Path.home() / "NoirPad"
