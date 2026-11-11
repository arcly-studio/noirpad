# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for NoirPad desktop (onedir). Run through build.ps1:

    pyinstaller --clean --noconfirm noirpad.spec      → dist\\NoirPad\\NoirPad.exe

* Entry point desktop.py imports the noirpad package normally, so the
  backend is found by static analysis.
* static/ is bundled as data (minus work files); noirpad.config resolves
  it from sys._MEIPASS.
* The exe gets a Windows version resource (version, CompanyName) from
  noirpad/__version__.py.
* Files the app never uses are dropped after analysis (see JUNK).

The target machine needs the WebView2 Runtime (Windows 11 has it; the
installer offers it otherwise, and NoirPad.exe explains when it's missing).
"""

import re
import runpy
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH)
_VERSION_PY = (ROOT / "noirpad" / "__version__.py").read_text(encoding="utf-8")
VERSION = re.search(r'__version__ = "([^"]+)"', _VERSION_PY).group(1)
AUTHOR = re.search(r'^AUTHOR = "([^"]+)"', _VERSION_PY, re.M).group(1)
COPYRIGHT = re.search(r'^COPYRIGHT = "([^"]+)"', _VERSION_PY, re.M).group(1)


# ---- Data: the frontend, without work files ---------------------------------

def _static_files():
    out = []
    for path in (ROOT / "static").rglob("*"):
        rel = path.relative_to(ROOT)
        if (path.is_file() and path.suffix not in (".bak", ".map", ".tmp")
                and "parts" not in rel.parts):          # static/locales/parts = i18n work files
            out.append((str(path), str(rel.parent)))
    return out


# N8/N9: About → Licenses reads both from the bundle root (/api/licenses).
datas = _static_files() + [(str(ROOT / "LICENSE"), "."), (str(ROOT / "THIRD-PARTY-NOTICES.txt"), ".")]


# ---- Hidden imports ---------------------------------------------------------
# uvicorn picks its loop/protocol implementations by name at runtime, anyio
# its backend, and pywebview loads its Windows backend dynamically. The list
# lives in noirpad/runtime_imports.py; `NoirPad.exe --smoke-test` (build.ps1)
# imports all of it from the finished bundle.
_imports = runpy.run_path(str(ROOT / "noirpad" / "runtime_imports.py"))
hiddenimports = collect_submodules("uvicorn") + [
    *_imports["RUNTIME_IMPORTS"],
    *_imports["WINDOWS_IMPORTS"],
    "clr_loader",
]


# ---- Windows version resource -----------------------------------------------

def _version_file():
    nums = tuple(int(x) for x in (VERSION.split(".") + ["0", "0", "0"])[:4])
    text = f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={nums}, prodvers={nums}, mask=0x3f, flags=0x0,
                    OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', '{AUTHOR}'),
      StringStruct('FileDescription', 'NoirPad'),
      StringStruct('FileVersion', '{VERSION}'),
      StringStruct('InternalName', 'NoirPad'),
      StringStruct('LegalCopyright', '{COPYRIGHT}. MIT License.'),
      StringStruct('OriginalFilename', 'NoirPad.exe'),
      StringStruct('ProductName', 'NoirPad'),
      StringStruct('ProductVersion', '{VERSION}')])]),
    VarFileInfo([VarStruct('Translation', [0x0409, 1200])])
  ]
)
"""
    path = Path(workpath) / "version_info.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return str(path)


# ---- Analysis ---------------------------------------------------------------

a = Analysis(
    ["desktop.py"],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # Never used at runtime: GUI toolkits, test frameworks, dev tools.
    excludes=["tkinter", "_tkinter", "unittest", "pytest", "pydoc", "lib2to3",
              "PyInstaller", "pip", "IPython", "matplotlib", "numpy"],
    noarchive=False,
)

# Shipped by dependencies but never loaded by NoirPad.
JUNK = re.compile(
    r"(^|[\\/])("
    r"fastapi[\\/]\.agents"           # AI-assistant docs inside fastapi
    r"|pywebview-android\.jar"        # pywebview's Android backend
    r"|tests?[\\/]"                    # test suites of dependencies
    r"|node_modules[\\/]"
    r")|\.(pyi|bak|map)$",
    re.IGNORECASE)


def _keep(entry):
    return not JUNK.search(entry[0]) and not JUNK.search(str(entry[1]))


a.datas = [e for e in a.datas if _keep(e)]
a.binaries = [e for e in a.binaries if _keep(e)]

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NoirPad",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,                  # UPX triggers antivirus false positives
    console=False,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="noirpad.ico",
    version=_version_file(),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="NoirPad",
)
