# NoirPad privacy policy

[Čeština](PRIVACY.cs.md) · **English**

Last updated: 2026-11-11. Applies to NoirPad 1.1.0 and later.

## In short

NoirPad keeps your notes on your computer. NoirPad itself sends no data anywhere. It has no
account and no telemetry.

## What NoirPad stores and where

- **GitHub edition:** `%LOCALAPPDATA%\NoirPad`
- **Microsoft Store edition:** *Placeholder: the data folder of the Store edition is confirmed
  after testing (N1.11).*

In that folder:

| What | Contents |
|---|---|
| `notes_data.json` | notes, folders, tags, favorites, settings |
| `images\` | images you insert into notes |
| `backups\` | automatic copies of `notes_data.json` (the newest 7), a copy made before each import and damaged files (both deleted after 30 days) |
| `logs\` | `noirpad.log`, at most 1 MB × 3 files |
| `webview\` | data of the window component (cache, its settings) |

## What is encrypted

Only the text and formatting (including links) of locked notes are encrypted (Fernet, key
derived from your password; the password is never stored). If you forget the password, the text
cannot be recovered – not even by us.

Not encrypted: note names, tags, folders, **images (also in locked notes)**, favorites and
settings, and every note that is not locked. Anyone with access to your Windows account can
read them. The app lock keeps people out of NoirPad but does not encrypt anything.

Locked notes created before 1.1.0 keep their formatting and links readable until you unlock them
once with the password.

NoirPad also removes readable text from its automatic copies, but Windows or the disk may keep an
older version of a file for a while.

## The log

The log contains start-up facts, ports, versions and errors. It never contains the content of
your notes, their names or passwords. Your user folder is written as `~`.

## Network

NoirPad itself makes no network requests. Fonts, the Markdown renderer and the code highlighter
are part of the app, and its small built-in server only listens on this computer (127.0.0.1).
Links you click open in your web browser.

NoirPad is displayed through **Microsoft WebView2**, a Windows system component that Windows
manages and updates under the
[Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement).

The GitHub edition's installer offers to download WebView2 from Microsoft if it is missing.
A silent installation (e.g. winget) installs it without asking.

## Microsoft Store edition

The download, installation and updates of the Store edition are provided by the Microsoft Store
under Microsoft's terms and the Microsoft Privacy Statement. Depending on your Windows diagnostic
data settings, Microsoft may share download statistics and crash reports (Windows Error Reporting)
with us in Partner Center. NoirPad itself sends nothing.

On its first start, the Store edition copies the notes and images of the GitHub edition from
`%LOCALAPPDATA%\NoirPad` into its own folder, if there are any. It is a copy: the GitHub
edition's folder stays as it is. Automatic copies (backups) are not copied.

## Uninstalling and deleting your data

- **GitHub edition:** uninstalling removes the program folder and asks whether to delete your
  notes too (default: No). To delete them later, delete `%LOCALAPPDATA%\NoirPad`.
- **Microsoft Store edition:** *Placeholder: final wording after testing (N1.11).*

Backups you downloaded yourself stay where you saved them.

## Self-hosting

If you run NoirPad as a web server, the data stays on that server and you are responsible for it.

## Contact

Arcly Studio, [arclystudio.dev@gmail.com](mailto:arclystudio.dev@gmail.com).
Security issues: see [SECURITY.md](SECURITY.md).

## Changes

Changes to this policy are recorded in this file's history on GitHub.
