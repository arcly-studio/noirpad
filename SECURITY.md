# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately via
[GitHub Security Advisories](https://github.com/arcly-studio/noirpad/security/advisories/new).
If you can't use that, e-mail [arclystudio.dev@gmail.com](mailto:arclystudio.dev@gmail.com).
Include the NoirPad version (Settings → About), how you run it (installed app / web), steps to
reproduce and the impact you see. Never include real notes or passwords.

You can expect a first answer within a week. Fixes are released as a new version; the advisory
is published once a fix is available.

## Supported versions

Only the latest release gets security fixes.

## Security model (summary)

- NoirPad is a **local, single-user** app. The desktop app runs a server on `127.0.0.1` with a
  random port and a random per-launch token; the web version listens on localhost unless you
  configure otherwise, and then requires `NOIRPAD_PASSWORD`.
- Requests are checked for the Host header (DNS rebinding), a custom header and same origin (CSRF).
  A strict Content-Security-Policy blocks inline and third-party scripts; rendered notes are
  sanitized with DOMPurify.
- **Locked notes**: the text and its formatting, including links, are encrypted (Fernet, key from PBKDF2-SHA256, 480 000 iterations, random
  salt). Note names, tags, folders, images and settings are **not** encrypted. A forgotten note
  password cannot be recovered.
- **App lock**: only a scrypt hash is stored; while locked the server refuses every API request.
  It does **not** encrypt data on disk.
- Anyone with access to your Windows account (or to `%LOCALAPPDATA%\NoirPad`) can read everything
  except the text of locked notes. Use disk encryption (BitLocker) for protection at rest.
- Out of scope: attacks that require control of your user account or machine, and self-hosted
  setups exposed without HTTPS.
