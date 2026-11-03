# NoirPad website

Source of **https://arcly-studio.github.io/noirpad/** (English) and **/noirpad/cs/** (Czech): home, Privacy
and Support. Astro, static output for GitHub Pages; same structure as the Dirwise website, NoirPad's
"terminal" look. Plan: `arcly-studio/web/PLAN-noirpad.md` (outside this repo).

```sh
cd site
npm ci
npm run dev           # http://localhost:4321/noirpad/
npm run build         # dist/ + forbidden-words check (scripts/check-words.mjs)
npm run check:types   # astro check
npm run make:media    # docs/demo.gif → public/media/noirpad-demo.webm/.mp4 + poster (needs ffmpeg; output is committed)
```

`predev`/`prebuild` run `scripts/prepare.mjs` (small Czech font subsets → `public/fonts/`, git-ignored).
Motion: `src/scripts/motion.ts` (GSAP + Lenis, same behaviour as the Dirwise site; nothing is hidden
without JS or with reduced motion). Third-party code and fonts: `THIRD-PARTY-LICENSES.md`.

The whole host (studio site at `/`, Dirwise at `/dirwise/`, NoirPad at `/noirpad/`) can be simulated from
the studio site: `npm run sim:local-noirpad` in `arcly-studio/web` (builds this folder from the worktree).

## Rules

- Texts must match the app (README, code). Encryption: only the **text of a locked note** is encrypted –
  never claim "encrypted notes" in general.
- No names of third-party products (Microsoft Store policy 10.1) – `check-words.mjs` fails the build.
- No cookies, analytics or requests to other servers; fonts are self-hosted.
- Do **not** name folders `images/` or `build/` anywhere in `site/` – the repository's root `.gitignore`
  ignores them (they would silently be missing on GitHub). Website images go to `src/assets/`.
- Everything the build generates must be git-ignored (`build.ps1` of the app needs a clean `git status`).
- No `krystof2-ops` in `.github/workflows/*.yml` or the root README (`tests/test_version.py`).
- Do not touch `docs/brand/` originals (`tests/test_brand.py`); cleaned copies for the web go to `site/`.
- The main call to action is the Microsoft Store button – one switch in `src/lib/store.ts`.
