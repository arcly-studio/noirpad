"""The one place the NoirPad version is written down.

Read by the API (/api/version, FastAPI), the About box and the start page
(via the API), the PyInstaller version resource, the Inno Setup installer
(build.ps1 passes /DAppVersion and /DAppURL) and the release workflow.
"""

__version__ = "1.0.2"

# Project page — one constant if the repository is ever renamed.
PROJECT_URL = "https://github.com/arcly-studio/NoirPad"

# Publisher: "by Arcly Studio" on the start page and in About, CompanyName of
# NoirPad.exe (noirpad.spec). installer.iss has its own AppPublisher.
AUTHOR = "Arcly Studio"
