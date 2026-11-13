"""The one place the NoirPad version is written down.

Read by the API (/api/version, FastAPI), the About box and the start page
(via the API), the PyInstaller version resource, the Inno Setup installer
(build.ps1 passes /DAppVersion and /DAppURL) and the release workflow.
"""

__version__ = "1.1.0"

# Project page — one constant if the repository is ever renamed.
PROJECT_URL = "https://github.com/arcly-studio/noirpad"

# Publisher: "by Arcly Studio" on the start page and in About, CompanyName of
# NoirPad.exe (noirpad.spec). installer.iss has its own AppPublisher.
AUTHOR = "Arcly Studio"

# N9: the copyright line of LICENSE, About, the exe (noirpad.spec) and the
# installer (installer.iss has its own copy; tests/test_version.py compares).
COPYRIGHT = "Copyright (c) 2026 Arcly Studio"

# N10: contact for people without a GitHub account (About → Contact).
CONTACT_EMAIL = "arclystudio.dev@gmail.com"
