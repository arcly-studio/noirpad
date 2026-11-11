# NoirPad – kontext projektu

> Stav k **27. 10. 2026**, verze **1.0.1**, commit `d5e57fa`. Je to souhrn celého projektu pro lidi
> i pro AI agenty. Pravidla pro práci v repu jsou v [CLAUDE.md](CLAUDE.md) a mají přednost.
> Uživatelská dokumentace je v [README.md](README.md), build v [BUILD.md](BUILD.md) a změny po
> verzích v [CHANGELOG.md](CHANGELOG.md).

---

## 1. Co je NoirPad

- Lokální aplikace na poznámky pro **Windows 10/11**. Poznámky jsou v rich textu nebo Markdownu,
  dají se šifrovat a aplikace má „terminálový“ (noir) vzhled.
- Nemá **účet, cloud ani telemetrii** a sama nedělá žádné síťové požadavky. Fonty, renderer
  Markdownu i zvýrazňovač kódu jsou přibalené.
- Jeden kód má dvě podoby:
  - **Desktop:** `NoirPad.exe` / `desktop.py`. Okno WebView2 přes pywebview, uvnitř lokální
    server FastAPI na `127.0.0.1`.
  - **Web / self-host:** `NoirPad-web.py`. Server na `127.0.0.1:8000`, ovládá se z prohlížeče.
- Rozhraní je anglicky a česky. Má 17 barevných motivů a volitelné „Noir efekty“ (glow, déšť
  padajícího kódu, CRT, glitch).
- Vydavatel je **Arcly Studio**, repozitář [github.com/arcly-studio/noirpad](https://github.com/arcly-studio/noirpad)
  (veřejný). Licence MIT. Držitel copyrightu v `LICENSE` je záměrně původní vlastník repa a test
  hlídá, že jeho jméno není nikde jinde (viz §14).
- Předchůdce je tkinter verze v repu `NoirPad-legacy`, která zůstává beze změny. Šifrovací obálka
  je s ní kompatibilní: legacy formát „version 2“ (XOR) NoirPad jen dešifruje a po odemčení heslem
  přešifruje na version 1 (N4, `routes/encryption.py`, pojistky viz sekce 8).

## 2. Stav a historie

| Verze | Datum | Stav |
|---|---|---|
| 1.0.0 | 2026-10-20 | vydáno, první veřejné vydání |
| 1.0.1 | 2026-10-27 | vydáno |
| 1.0.2 | 2026-11-05 | vydáno (GitHub „Latest“), **hotfix**: jen aktualizace závislostí (nález N3 z auditu) |
| 1.1.0 | plán | **Store edice** (MSIX pro Microsoft Store), fáze N1.1–N1.14 v `ROADMAP.md`, větev `release/1.1.0`, worktree `..\2-store-1.1.0\`, zadání v `..\6-dokumenty\NOIRPAD-STORE-EDICE.md` |

- **1.0.1** obsahuje opravy z „Kontroly 2“ a nové logo M1 „Skleněné listy“. Podrobně je to
  v CHANGELOGu.
- **winget:** manifest `ArclyStudio.NoirPad` je mimo repo (`..\..\arcly-studio\winget\`). Pro 1.0.0
  je otevřený PR `microsoft/winget-pkgs#456673`. Manifest 1.0.2 se odešle až po jeho sloučení.
- **ID nálezů v kódu a testech** (např. `R6`, `K2`, `U1`, `G7`, `D13`) odkazují na revizní
  dokumenty, ne na issue na GitHubu:
  - `G*` = redesign „G – Noir čistý“ (1.0.0),
  - Kontrola 2 (1.0.1): `E*` editor, `T*` štítky a strom, `R*` spolehlivost a výkon,
    `U*` přístupnost a UI, `S*` bezpečnost, `I*` instalátor, `P*` vkládání,
  - `D*`, `K*`, `C*`, `N*` = starší revize před vydáním 1.0.0.
- Commity se píšou česky (`Kontrola 2, skupina 5a: backend – S4, S5, …`). Celá historie má
  109 commitů.

## 3. Technologie

| Vrstva | Co | Verze (připnuté) |
|---|---|---|
| Jazyk backendu | Python | **3.14** (`.python-version`), jiné verze nejsou testované |
| Web server | FastAPI + Starlette + uvicorn (pevně h11, bez WebSocketů) | fastapi 0.136.0, starlette 1.3.1, uvicorn 0.45.0, pydantic 2.13.3 |
| Šifrování | `cryptography` (Fernet, PBKDF2) + `hashlib.scrypt` (zámek aplikace) | cryptography 50.0.2 |
| Datová složka | platformdirs | 4.9.6 |
| Desktop okno | pywebview → WebView2 přes pythonnet | pywebview 6.2.1, pythonnet 3.1.0 |
| Frontend | čistý JavaScript (IIFE na `window.NP`), **bez bundleru a bez modulů** | – |
| Knihovny ve frontendu | markdown-it (+ task-lists), DOMPurify, highlight.js, ikony Lucide, variabilní fonty (Inter, JetBrains Mono, Orbitron, Outfit, Space Grotesk, Unbounded) | v `static/vendor/`, verze v `VERSIONS.json` |
| JS testy | vitest + jsdom (Node 22+) | vitest 5.0.3, jsdom 29.1.1 |
| Py testy | pytest + httpx (TestClient) | pytest 9.1.1 |
| Balení | PyInstaller (onedir) + Inno Setup 6 | pyinstaller 6.19.0 |

Runtime závislosti jsou v `requirements.txt`, testy a build v `requirements-dev.txt` a JS dev
balíčky v `package.json` / `package-lock.json`. Node slouží jen k testům a ke generování vendor
souborů. Aplikace sama žádný JS build nemá.

## 4. Struktura repozitáře

```
1-aplikace/                (worktree 1.1.0: 2-store-1.1.0/)
├─ desktop.py              desktop shell: zámek instance, uvicorn ve vlákně, okno pywebview, zavírání
├─ NoirPad-web.py          spouštěč webové verze (volá noirpad.web.main)
├─ noirpad/                backend (FastAPI)
│  ├─ __version__.py       JEDINÉ místo pro VERSION, PROJECT_URL, AUTHOR
│  ├─ app.py               FastAPI app, middleware _http_guard, /, /static, manifest s verzí
│  ├─ config.py            cesty (resource vs. data), limity
│  ├─ runtime.py           stav procesu v paměti (RUNTIME): režim, tokeny, odemčené klíče
│  ├─ runtime_imports.py   UVICORN_OPTIONS + moduly importované za běhu (pro PyInstaller a smoke test)
│  ├─ storage.py           notes_data.json: zámek, atomický zápis, snapshoty, obnova, migrace, zámek instance
│  ├─ scrub.py             čištění automatických kopií od zamčených a smazaných poznámek, limity stáří (N1)
│  ├─ models.py            Pydantic těla požadavků
│  ├─ tree.py              čisté funkce nad stromem (hledání, koš, obnova)
│  ├─ server_auth.py       kontrola Host / CSRF / tokenu / hesla, CSP a hlavičky, rate limit
│  ├─ crypto.py            šifrovací obálka poznámek (Fernet + PBKDF2)
│  ├─ app_lock.py          zámek aplikace (scrypt)
│  ├─ images.py            obrázky: ověření, odkazy, úklid sirotků
│  ├─ export.py            HTML export, bezpečné názvy souborů
│  ├─ markdown_io.py       export a import Markdownu (zip)
│  ├─ uploads.py           čtení uploadu s limitem, ochrana proti zip bombě
│  ├─ desktop_save.py      nativní dialog „Uložit jako“ pro exporty (jen desktop)
│  ├─ logs.py              rotující log, anonymizace cesty k profilu na ~
│  ├─ errors.py            ApiError(status, code, **params)
│  ├─ web.py               main() webové verze
│  └─ routes/              routery: session, app_lock, data, tree, notes, settings,
│                          encryption, images, export, backup, desktop
├─ static/                 frontend, servírovaný tak, jak je
│  ├─ index.html           jediná stránka, pořadí <script> na konci
│  ├─ js/*.js              45 modulů (viz §9)
│  ├─ css/noirpad.css      ~4950 řádků, blok „G7“ (společný styl oken) na konci
│  ├─ css/themes.css       design tokeny + 17 motivů
│  ├─ locales/en.json, cs.json   642 klíčů, sady klíčů musí být stejné
│  ├─ img/                 ikony a kopie loga (musí být shodné s docs/brand)
│  ├─ manifest.json        PWA manifest (bez service workeru)
│  └─ vendor/              GENEROVANÉ přes `npm run vendor`, ručně needitovat
├─ tests/                  pytest (19 souborů + conftest), tests/js (31 *.test.js + harness)
├─ tools/                  vendor.mjs, demo_data.py, take_screenshots.py, smoke_test.ps1, make_icons.py
├─ installer.iss           Inno Setup (per-user instalace, WebView2, jazyk, odinstalace)
├─ installer/              BMP obrázky průvodce (generované)
├─ noirpad.spec            PyInstaller spec
├─ noirpad.ico             ikona exe, okna a instalátoru
├─ build.ps1               celý build: testy → PyInstaller → smoke test → Inno Setup → SHA256
├─ docs/                   brand (zdroje loga), screenshots, demo.gif, tlačítka Download
├─ .github/                workflows test.yml a release.yml, šablony issues
└─ README.md, README.cs.md, BUILD.md, CHANGELOG.md, SECURITY.md, CLAUDE.md, LICENSE
```

## 5. Architektura

```
 NoirPad.exe / desktop.py                         NoirPad-web.py → noirpad/web.py
  ├─ zámek instance <data>/noirpad.lock             ├─ stejný zámek instance (před importem app)
  ├─ mutex NoirPad-B6F2E7C0-AppMutex (Inno)         ├─ NOIRPAD_HOST:NOIRPAD_PORT (127.0.0.1:8000)
  ├─ uvicorn v daemon vlákně, 127.0.0.1:<volný port>└─ mimo loopback jen s NOIRPAD_PASSWORD
  ├─ náhodný token pro každé spuštění
  └─ okno pywebview (edgechromium) → http://127.0.0.1:<port>/#token=…
                         │
              noirpad.app:app (FastAPI, bez /docs a /openapi)
                ├─ middleware _http_guard:
                │    server_auth.check_request → handler → (desktop) desktop_save → bezpečnostní hlavičky
                ├─ GET /                     index.html s doplněnou verzí (__NP_VERSION__)
                ├─ /static/*                 frontend (manifest.json s verzí zvlášť)
                ├─ /api/*                    routery noirpad/routes/*
                └─ /images/*                 obrázky z datové složky (přísné CSP, sandbox)
                         │
              storage.py → <data>/notes_data.json  (+ images/, backups/, logs/)
```

- Frontend je jednostránková aplikace. Celý profil si stáhne přes `GET /api/data` a každých 5 s
  se ptá na změny přes ETag. Poznámky načítá a ukládá po jedné.
- Route handlery bez `await` jsou obyčejné `def`, takže běží v thread poolu. `async` jsou jen
  upload a importy a těžkou práci posílají přes `run_in_threadpool`. Hlídají to testy `test_r8_*`.
- `RUNTIME` (runtime.py) drží všechno, co se nesmí dostat na disk: režim (`server`/`desktop`),
  token desktopu, relace, odemčené klíče poznámek, tokeny zámku aplikace, počítadla chybných hesel
  a háčky desktopu (`save_dialog`, `toggle_fullscreen`).

## 6. Data

### Datová složka

Výchozí cesta je `%LOCALAPPDATA%\NoirPad` (`platformdirs.user_data_dir("NoirPad", appauthor=False)`),
na Linuxu `~/.local/share/NoirPad`. Přepíše ji proměnná **`NOIRPAD_DATA_DIR`**, kterou používají
testy, ruční zkoušky a smoke test.

| Soubor / složka | Obsah |
|---|---|
| `notes_data.json` | všechny poznámky, strom, koš a nastavení (jeden JSON, **ne SQLite**) |
| `notes_data.json.tmp` | dočasný soubor atomického zápisu (po chybě se smaže) |
| `backups/notes_data-<stamp>.json` | automatické snapshoty: nejvýš 1 za 10 min, drží se posledních 7 |
| `backups/pre-import-<stamp>.zip` | bezpečnostní kopie před importem zálohy (posledních 7, nejvýš 30 dní) |
| `notes_data.corrupt-<stamp>.json` | poškozený datový soubor odložený stranou (nejvýš 3, nejvýš 30 dní od odložení) |
| `notes_data.pre-single-profile-*.json` | snapshot ze staré migrace víc uživatelů (bez hesel a tokenů) |
| `images/<uuid4>.<png\|jpg\|gif\|webp>` | obrázky z poznámek |
| `images/.trash/` | obrázky bez odkazu (po 24 h sem, po 30 dnech se smažou) |
| `logs/noirpad.log` | log (1 MB × 3 rotace, bez obsahu poznámek, profil zapsaný jako `~`) |
| `noirpad.lock` | zámek jedné instance (msvcrt / fcntl) |
| `webview/` | profil WebView2 (desktop) |
| `install-language.txt` | jazyk zvolený v instalátoru (`en`/`cs`) |

### `notes_data.json`

Výchozí hodnoty jsou v `storage.DEFAULT_DATA`.

- **Struktura:**
  - `tree`: pole položek `{id, name, type: "note"|"folder", children?, tags?}`. Id je uuid4.
  - `notes`: `{id: obsah}`.
  - `note_formats`: `{id: [běhy formátu]}`.
  - `note_modes`: `{id: "markdown"}`. Ukládá se jen nevýchozí hodnota, výchozí je rich-text.
  - `note_images`: `{id: [názvy obrázků]}`, aby šel uklidit obrázek i u šifrované poznámky.
  - `favorites`: pole id.
  - `trash`: `{tree, notes, note_formats, favorites}`.
- **Nastavení (top-level):**
  - `theme` (`matrix`), `ui_font` (`jetbrains-mono`), `font_family` (`Cascadia Code`), `font_size` (12),
  - `autosave` (false), `autosave_interval` (5), `page_orientation`, `spellcheck` (true),
  - `glow_enabled`, `matrix_rain_enabled`, `crt_enabled` (vše false), `glow_intensity` (100), `glitch_effect` (true),
  - `show_splash`, `confirm_delete`, `idle_lock_minutes` (`off`), `default_encrypted`,
  - `custom_shortcuts` (jen změněné), `language` (`auto`/`en`/`cs`), `md_split` (true),
  - `recent_notes` (`[{id, at}]`, max 10; „Obnovit nastavení“ ho nesmaže).
  - Seznam polí určuje `SettingsBody` v `models.py`. Nové nastavení přidej tam **i** do `DEFAULT_DATA`.
- **Soukromé:** `app_lock` (záznam scrypt). Nikdy se neposílá do prohlížeče ani do zálohy
  (`storage.PRIVATE_KEYS`).

### Formát obsahu poznámky

- **Rich text:** obsah je prostý text a vzhled nese `note_formats[id]` = běhy
  `{start, end, bold, italic, underline, strike, link, font, size, color}`.
  - Obrázky jsou značky `<<IMG:<uuid>.<ext>>>` nebo `<<IMG:…|w=300>>` (zvětšení).
  - Bloky kódu se píšou jako ```` ```lang ````.
  - Legacy formát `\x00IMG:name\x00` se stále čte.
- **Markdown:** obsah je surový Markdown a obrázky se píšou jako `![](/images/<name>)`.
- **Zamčená poznámka:** obsah je obálka
  `{"encrypted": true, "data": base64(verze(1) + sůl(16) + Fernet token), "formats": Fernet token}`.
  Pole `formats` (N2, jen když nějaké formáty jsou) nese `{"sha256": hash textu, "formats": [...]}`
  se stejným klíčem. Hash formáty váže k textu: když nesedí nebo token nejde otevřít, formáty se
  ignorují, text se vrátí a do logu jde jen `formats_mismatch` / `formats_unreadable`. Starší verze
  pole ignorují. Název, štítky, složka a obrázky šifrované **nejsou**.
- **Poznámka zamčená před 1.1.0:** má formáty čitelně v `note_formats`, dokud ji někdo neodemkne
  heslem. `/api/note` a `/api/data` je u zamčené poznámky neposílají nikdy.
- **`rev`:** `sha256(obsah + "\0" + json(formáty))[:16]`. Počítá se, neukládá. Uložení posílá
  `base_rev` a nesoulad vrátí `409 note_changed_elsewhere` (dvě okna webové verze).
- **`scrub_pending`, `scrub_locked`, `scrub_first_pass_done`:** stav čištění kopií (trvale smazané
  poznámky, nově zamčené poznámky, jednorázový průchod). Soukromé klíče jako `app_lock`: nejdou
  do prohlížeče ani do zálohy.

### Zápis a odolnost

- `storage.update_data(mutator)` drží `file_lock` (threading.Lock) přes celé čtení, úpravu
  a zápis. Když mutator vyhodí výjimku, nic se nezapíše. Pomocné funkce volané pod zámkem mají
  varianty `*_unlocked`.
- Zápis je atomický: tmp soubor, fsync a `os.replace`. Před zápisem se udělá snapshot (omezený
  na 1 za 10 min). Chyba snapshotu nikdy nezablokuje uložení (R7).
- Plný disk vrátí `507 data_write_failed` a soubor na disku zůstane beze změny.
- Poškozený JSON se odloží stranou a obnoví se nejnovější dobrý snapshot. UI pak jednou ukáže
  `data_notice` (`data_restored` / `data_reset`). BOM nevadí a rozbitá struktura se opraví
  v paměti (R10).
- Čištění kopií (`scrub.py`, N1): jeden idempotentní průchod porovná snapshoty, `pre-import` zipy,
  `corrupt`, `pre-single-profile` a `.bak` s aktuálními daty. Zamčená poznámka dostane místo
  čitelného textu aktuální obálku a ztratí čitelné formáty, pokud už je nemá ani v aktuálních
  datech, trvale smazaná zmizí. Běží na vlastním vlákně a se svým zámkem,
  mimo `file_lock`: 5 s po startu serveru a hned po zamčení, přešifrování nebo trvalém smazání.
  Zavírání čeká nejvýš 2 s. Neúspěšný průchod se opakuje za 60 s, nejvýš 3× za relaci.
  **Čistí se podle události:** kopie mění jen zamčení a přešifrování po ověřeném hesle, které id
  zapíšou do `scrub_locked` (`scrub.mark_locked`) ve stejném zápisu jako poznámku. Import ani
  uložení neověřené v2 nic nepřidají. Jednou (`scrub_first_pass_done`) proběhne průchod přes všechny
  zamčené poznámky kvůli kopiím z 1.0.x, a to jen z čitelného textu na obálku, ne z v2 na v1.
  **Novější kopie se nepřepisuje:** data nemají čas úpravy poznámky, porovnává se čas souboru kopie
  s časem v Fernet tokenu aktuální obálky (`crypto.envelope_time`, s rezervou 10 s). Poznámka
  v novější kopii se přeskočí a nechá na rotaci nebo limitu; legacy obálka čas nemá, přeskočí se taky.
  Poznámka chybějící v aktuálních datech se z kopií **nemaže** (vypadal by
  tak i vyprázdněný soubor nebo import). Limity stáří se neuplatní, dokud v datech není žádná
  poznámka. Nová automatická kopie se musí přidat do `scrub._copies`.
- `update_data_tracked` vrací ETag před zápisem a po něm. Hlavička `X-NoirPad-ETag-Before`
  dovolí klientovi po vlastním uložení nestahovat data znovu (R9).

### Migrace

Spouští je `storage.set_data_dir()` při importu `noirpad.app`, vždy až **po** získání zámku
instance (R11):

1. data vedle kódu (velmi staré buildy) → datová složka,
2. data víc uživatelů (`users`, `sessions`, `user_id`) → jeden profil, se snapshotem bez tajemství,
3. vyčištění starých snapshotů od hashů hesel (I6),
4. `_migrate_noir_effects`: data z doby před redesignem si nechají vzhled (glow zapnutý, déšť
   zapnutý, pokud ho uživatel nevypnul, `ui_font` Orbitron → JetBrains Mono). Přítomnost
   `glow_enabled` znamená, že migrace už proběhla. Stejná úprava se aplikuje i na snapshot
   obnovený po poškození.

### Obrázky

- Upload (`POST /api/images/upload`):
  - nejvýš 10 MB,
  - typ se pozná z magic bytes (png/jpg/gif/webp, nikdy SVG ani HTML),
  - kontroluje se, že soubor není useknutý,
  - uloží se jako `<uuid4>.<ext>` přes `.part` a rename.
- `GET /images/<name>` vrátí jen názvy odpovídající `IMAGE_NAME_RE`, s vlastním CSP (`sandbox`).
  Desktop se autorizuje cookie `noirpad_desktop`, kterou nastaví `/api/session/bind`.
- Úklid sirotků proběhne při startu (lifespan). Když existuje šifrovaná poznámka bez `note_images`,
  úklid se přeskočí. Trvalé smazání z koše nesmaže obrázek, který používá jiná poznámka (K4).

### Limity (`config.py`)

| Co | Limit |
|---|---|
| Název | 300 znaků |
| Text poznámky | 5 000 000 znaků |
| Běhy formátu | 20 000 |
| Štítky | 50, každý nejvýš 100 znaků |
| Záloha | 100 MB, rozbaleně 500 MB, 10 000 souborů |
| Obrázek | 10 MB |
| Heslo poznámky / zámku aplikace | 4–1024 znaků |

## 7. API (backend)

Chyby mají tvar `{"detail": {"code": "...", "params": {...}}}`. Frontend (`api.js`) z nich udělá
text `NP.t("errors.<code>", params)`, takže **každý nový kód potřebuje klíč `errors.<code>`
v obou locale**.

| Oblast | Endpointy |
|---|---|
| Relace (`session.py`) | `GET /api/session` (režim, přihlášení, zámek aplikace, jazyk, jazyk instalátoru, data_notice) · `GET /api/version` → `{version, url, author}` · `POST /api/session/dismiss-notice` · `POST /api/session/bind` (cookie pro obrázky v desktopu) · `POST /api/login` · `POST /api/logout` |
| Zámek aplikace | `POST /api/app-lock/unlock`, `/lock`, `/enable` (i změna hesla s `current_password`), `/disable` |
| Data | `GET /api/data` (celý profil, ETag / 304) · `GET /api/storage` (velikosti) |
| Strom | `POST /api/tree/new-note`, `/new-folder`, `/rename`, `/move` (`before`/`after`/`inside`, kontrola cyklu), `/delete` (→ koš) |
| Poznámky | `GET /api/note/{id}` (`content, formats, mode, trashed, rev`) · `PUT /api/note/{id}` (`content, formats, mode, base_rev`; zamčenou poznámku nejde přepsat prostým textem → 409 `note_is_encrypted`) |
| Oblíbené, štítky | `POST /api/favorites/toggle` · `GET /api/tags` · `PUT /api/tags/{id}` (ořez, bez duplicit bez ohledu na velikost písmen) |
| Koš | `GET /api/trash` · `POST /api/trash/restore`, `/empty`, `/delete` |
| Nastavení | `PUT /api/settings` (jen zadaná pole) · `POST /api/settings/reset` |
| Šifrování | `POST /api/encrypt` · `/unlock` · `/save-encrypted` (`lock_after`) · `/decrypt` (trvalé odšifrování) · `/lock` · `/lock-all` |
| Obrázky | `POST /api/images/upload` · `GET /images/{name}` |
| Export | `GET /api/export/{id}/txt`, `/html`, `/md` (zamčená poznámka se odmítne) · `GET /api/notes/export` (zip HTML) · `GET /api/notes/export-md` (zip Markdownu, hlavička `x-noirpad-skipped` s počtem přeskočených zamčených) · `POST /api/notes/import-md` (jen přidává) |
| Záloha | `GET /api/backup` (zip: notes_data.json + obrázky) · `POST /api/backup/import` (nahradí strom, poznámky, koš a oblíbené; nastavení zůstane; předem udělá bezpečnostní kopii) |
| Desktop | `POST /api/desktop/fullscreen` · `POST /api/desktop/reveal` (Průzkumník na uloženém souboru, přes token) |

## 8. Bezpečnost

**`server_auth.check_request`** postupně kontroluje:

1. **Host** musí být loopback nebo v `NOIRPAD_ALLOWED_HOSTS` (DNS rebinding), jinak `400 invalid_host`.
2. Další kroky platí jen pro `/api/*` a `/images/*`. **CSRF:** u POST/PUT/PATCH/DELETE musí
   `Origin`, pokud přijde, odpovídat hostu. V režimu server musí přijít `X-NoirPad-Request: 1`.
3. **Desktop:** `X-NoirPad-Token` se musí shodovat s tokenem spuštění. `/images/` místo toho
   pozná cookie `noirpad_desktop`.
4. **Heslo serveru** (`NOIRPAD_PASSWORD`): relace v paměti, cookie `noirpad_session` (12 h, se
   „zapamatovat“ 30 dní, `SameSite=Strict`, `Secure` při `NOIRPAD_SECURE_COOKIES=1`). Jinak `401`.
5. **Zámek aplikace:** bez platné cookie `noirpad_applock` (tokeny jen v paměti, po restartu je
   aplikace zamčená) vrátí `423 app_locked`. Výjimkou jsou veřejné endpointy (session, login,
   logout, bind, unlock a lock zámku aplikace).

**Hlavičky na každé odpovědi**, i na neošetřenou 500 (S4):

- CSP `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
- `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
- `Cache-Control: no-store` (úpravy JS a CSS se projeví po reloadu).

Aplikace nemá CORS, inline skripty ani CDN.

**Šifrování poznámek:**

- Fernet (AES-128-CBC + HMAC-SHA256), klíč z PBKDF2-SHA256 s 480 000 iteracemi a náhodnou solí
  pro každou poznámku.
- Heslo jde na server jen jednou. Server odvodí klíč a vrátí `unlock_token`. Klíč zůstane jen
  v `RUNTIME.unlocked`, zapomene se po 30 min nečinnosti, nejpozději po 12 h, a také při lock,
  lock-all a ukončení.
- Zapomenuté heslo nejde obnovit.
- Legacy obálka version 2 (XOR, bez kontroly integrity) se po odemčení heslem přepíše na version 1
  (N4), jen když je text aspoň 16 bajtů bez řídicích znaků, nová obálka se před zápisem ověří
  a v souboru je pořád původní obálka. Jinak se povýší až prvním uložením.
- Trvalé odebrání zámku jen heslem u nejisté legacy poznámky vrátí `legacy_note_unlock_first`:
  špatné heslo by ji jinak přepsalo nesmyslem. Člověk ji nejdřív otevře a zkontroluje text.
- Formáty staré poznámky se do obálky převedou při prvním odemčení heslem (N2, stejné pojistky,
  `_rewrite_envelope`). Obrázky šifrované nejsou: říká to dialog zamčení a upozornění po vložení
  obrázku do zamčené poznámky (`NP.encryption.noteImageAdded`). Ručně napsaný odkaz na uložený
  obrázek ohlásí první uložení, jednou za poznámku a relaci (`NP.encryption.noteSaved`).

**Zámek aplikace:** ukládá se jen hash scrypt (N=2^15, r=8, p=1). Data **nešifruje**. Zapomenuté
heslo: zavřít NoirPad a smazat `"app_lock"` z `notes_data.json`.

**Rate limit:** nejvýš 10 chybných pokusů za 60 s. Platí zvlášť pro přihlášení, zámek aplikace
a hesla poznámek a jde přes `server_auth.guarded_attempt`. Pokus si slot zabere **předem**,
takže paralelní hádání neprojde (R8).

**Frontend:**

- Markdown se vykresluje přes markdown-it (`html:false`) a DOMPurify.
- Odkazy hlídá `links.js`: http(s) a mailto otevře přes `window.open` s noopener, takže desktop
  je pošle do systémového prohlížeče. Ostatní blokuje.
- DOM se staví přes `textContent`, nikdy `innerHTML` s uživatelskými daty.

**Import:** kontroluje zip slip, zip bombu, obsah obrázků a UNC cesty v názvech obrázků (S1, únik
NTLM hashe).

**Log:** `logs.PrivateFormatter` nahradí cestu k profilu znakem `~`. Do logu nikdy nepatří obsah
poznámek, názvy ani hesla. Access log uvicornu je vypnutý.

## 9. Frontend (`static/`)

### Načítání

- `index.html` načte na konci:
  1. vendor skripty: markdown-it, task-lists, DOMPurify, highlight.js,
  2. 45 modulů v **pevném pořadí**: `i18n, utils, links, syntax-highlight, api, auth, state, themes,
     tree, editor, welcome, markdown, md-source, tabs, tags, search, command-bar, trash, favorites,
     images, paste, topbar, dialog, password-dialog, encryption, export, focus-mode, matrix-rain,
     splash, cursor, font-picker, help, backup, effects, find-all, settings, shortcuts,
     shortcuts-manager, auto-lock, app-lock, print, mobile, app`.
- Každý modul je IIFE, který zapisuje do `window.NP`. `app.js` je poslední.
- Fonty jsou v `/static/vendor/fonts/fonts.css`, ikony ve spritu Lucide a locale se stahují za
  běhu.

### Moduly podle oblasti

| Oblast | Moduly (globál) |
|---|---|
| Základ | `i18n.js` (`NP.t`, `NP.i18n`) · `utils.js` (`NP.uuid`, `debounce`, `sanitizeHtml`, `searchFold`, `NP.fullscreen`, `NP.THEMES`) · `api.js` (`NP.api`, jediný HTTP klient) · `state.js` (`NP.state`) · `dialog.js` (`NP.dialog`, `NP.modal`, `NP.toast`) · `links.js` |
| Start, přihlášení | `auth.js` (vstupní brána: login / zámek aplikace) · `app-lock.js` · `auto-lock.js` · `splash.js` · `app.js` (`NP.app.init`, `bindKeys`, `renameNote`, `NP.appInfo`) |
| Strom a karty | `tree.js` (strom ARIA, klávesnice, drag & drop, kontextové menu, „Přesunout do…“, koš, filtr štítků `NP.tree.tagFilter`) · `tabs.js` (`NP.tabs`, max 10 karet) · `tags.js` · `favorites.js` · `trash.js` · `welcome.js` (startovní stránka, RECENT) |
| Editor | `editor.js` (`NP.editor`, 1160 řádků: načtení, ukládání, autosave, stav, zavírání) · `markdown.js` · `md-source.js` (barevný podklad zdroje) · `syntax-highlight.js` · `paste.js` · `images.js` · `font-picker.js` · `effects.js` (CRT, glitch) · `cursor.js` (init vypnutý) |
| Šifrování | `encryption.js` · `password-dialog.js` |
| Hledání, příkazy | `search.js` (Ctrl+F v poznámce) · `find-all.js` (Ctrl+Shift+K, na klientu, bez zamčených) · `command-bar.js` (Ctrl+Shift+P, 29 příkazů `:theme`, `:tag`, `:export` …) |
| UI | `topbar.js` (`NP.icon`, `NP.menu`, menu Export a ⋯, přepínač `md_split`) · `settings.js` (`NP.settings`, `NP.dropdown`) · `help.js` (F1) · `shortcuts.js` · `shortcuts-manager.js` · `themes.js` · `focus-mode.js` · `matrix-rain.js` · `mobile.js` |
| Výstupy | `export.js` (TXT/HTML/MD ze serveru) · `print.js` (PDF přes `window.print()`) · `backup.js` |

### Start aplikace

1. `DOMContentLoaded` → `NP.auth.start()`. Desktop nejdřív zavolá `POST /api/session/bind`,
   potom se volá `GET /api/session` a nastaví se jazyk.
2. Když je potřeba heslo serveru, ukáže se přihlášení. Když je zapnutý zámek aplikace, ukáže se
   jeho heslo. Teprve pak se spustí `NP.app.init()`.
3. `init`:
   - `state.init()` + `api.version()`,
   - motiv,
   - nastavení a efekty,
   - `editor`, `images`, `paste` (po images), `topbar`,
   - `tree.render()`, splash,
   - zkratky,
   - `autoLock`,
   - `state.startPolling()`,
   - **startovní stránka**. Žádná poznámka se sama neotevře.
4. Desktopový token přijde v URL jako `#token=…`. `api.js` ho přesune do `sessionStorage`
   (`noirpad_token`), z adresy ho smaže a posílá ho jako `X-NoirPad-Token`.

### Stav a synchronizace

- `NP.state`:
  - `data`: celý profil,
  - `etag`,
  - `openTabs`,
  - `activeTabId`,
  - `currentNoteId`,
  - `selectedId`,
  - příznaky UI.
- Polling běží každých 5 s, jen když je stránka viditelná, a posílá `If-None-Match`. Po změně
  zavolá `tabs.sync()` (zavře karty poznámek smazaných jinde a převezme přejmenování)
  a `tree.render()`.
- Konflikt `409 note_changed_elsewhere` vede na dotaz „Přepsat mým“ / „Ponechat, neukládat“.

### Editor, ukládání, karty (nejcitlivější místo)

- **Rich text:** `#editor` (contenteditable). `_buildRichContent` převádí text a formáty na DOM,
  `_extractFormats` a `_htmlToTextWithImages` dělají opačný převod.
- **Markdown:** zdrojem pravdy je `#editor-md` (textarea). Pod ní leží obarvený podklad
  `#md-highlight` (`md-source.js`). Jeho metriky fontu a scroll musí sedět s textareou a velké
  zdroje se barví se zpožděním. Náhled `#md-preview` vedle zdroje se vypíná přes `md_split`.
- **Ukládání:**
  - rich text 1 s po psaní, Markdown 800 ms,
  - autosave podle nastavení, jinak bezpečnostní uložení každých 30 s,
  - při `pagehide` keepalive uložení.
- `NP.editor.save()` vrací true/false a běží **po jednom** (fronta `_saving`). Překrývající se
  uložení by poslala stejný starý `rev`.
- `NP.tabs.add/activate/close` jsou **async**: `true` = hotovo, `false` = uživatel zůstal,
  `null` = předběhlo je novější volání. Vždy na ně čekej (`await`) a nikdy nepředpokládej, že se
  karta přepnula.
- `NP.editor.leave()` před přepnutím uloží. Když uložení selže, zeptá se: zahodit, nebo zůstat?
- Přejmenování, štítky i obrázky musí mířit na id poznámky, pro kterou začaly, ne na „aktuální“.
- **Zavření desktopu:** `flushForClose()` vrátí `"close"` nebo `"stay"`. Přes `NP.editor._closeBusy`
  `desktop.py` pozná, že běží uložení nebo otázka.

### Vkládání, obrázky, tisk

- `paste.js`: HTML z webu, Wordu a Google Docs se vyčistí na strukturu. Zůstane b/i/u/s, odkazy
  (http, https, mailto), odstavce, seznamy jako řádky a vlastní obrázky NoirPadu. Barvy, fonty
  a velikosti se zahodí.
  - `Ctrl+Shift+V` vloží prostý text, `Ctrl+Space` vyčistí formát výběru.
  - Pravé tlačítko na výběru otevře vlastní menu. Shift+pravé tlačítko nechá systémové menu
    (kontrola pravopisu).
- `images.js`: vložení, přetažení nebo tlačítko. Při vložení se nabídne „jako obrázek“, nebo „jako
  odkaz“. `Ctrl`+kolečko mění velikost (50–2000 px, ukládá se `|w=`). Klik otevře prohlížeč
  obrázků, ale jen na obrázky v poznámce, ne na logo.
- `print.js`: PDF přes tiskový dialog. U Markdownu se zeptá, jestli tisknout vykreslený text,
  nebo zdroj (světlý / tmavý). Zamčenou poznámku odmítne.

### Zkratky

- `shortcuts.js` drží registr `{default, current, labelKey, categoryKey}` a jeden keydown
  dispatcher. Handler, který vrátí `false`, pustí klávesu dál. Tak funguje `Ctrl+B` = tučně
  v Markdownu a jinde panel.
- Přizpůsobení se ukládá jako `custom_shortcuts` (jen změny). Spravuje se v Nastavení →
  Klávesové zkratky → Spravovat.
- Webová verze používá **Alt+Shift+N/T/I** místo Ctrl+Shift+N/T/I, protože ty patří prohlížeči
  (`WEB_DEFAULTS`). Desktop si nechává Ctrl a pozná se podle `NP.api.hasToken()`.
- Nápověda, tooltipy a startovní stránka čtou **aktuální** zkratky, ne napevno zapsaný text.

### Nastavení a co kde leží

- Na serveru, přes `PUT /api/settings`, jsou všechny klíče z §6.
- V localStorage jsou jen věci prohlížeče: `noirpad_folder_states` (otevřené složky)
  a `noirpad_tags_collapsed`. `noirpad_crt` je legacy hodnota, kterou `migrateCrt` jednou
  přesune na server.

### i18n, vzhled, ikony, logo

- **i18n:** viditelný text jde přes `NP.t()` nebo atributy `data-i18n*`. Klíče jsou v `en.json`
  i `cs.json` (stejné sady, 642 klíčů, množná čísla přes `Intl.PluralRules`).
- **Jazyk „auto“:** použije se jazyk instalátoru, jinak jazyk prohlížeče.
- **Motivy:** `themes.css`, 17 motivů. 12 jich mění jen akcent (id matrix, amber, cyan, red,
  purple, blue, pink, white, gold, lime, orange, ice) a 5 má plnou paletu (id dracula, synthwave,
  nord, gruvbox, tokyo-night).
  - Id jsou jen interní (uložená hodnota `theme`, `data-theme`). Uživatel vidí popisné názvy
    (`themes.<id>` v locales, např. Fosforová zelená, Levandulová noc) a v `:theme` přezdívky
    z `NP.THEME_SLUGS` (`utils.js`): phosphor, lavender, neon, slate, retro, midnight. Stará id
    fungují dál jako skrytý alias. Názvy cizích produktů nesmí být v UI, nápovědě, příkazech
    ani README mimo licence (`tests/test_theme_names.py`).
  - Déšť padajícího kódu: `:rain` (`:matrix` skrytý alias). Když běží, `body.np-rain-on`
    zprůhlední `#editor-wrapper` na `--rain-veil` (kontrast v `test_contrast.py`).
  - Používej tokeny, ne natvrdo zapsané barvy (`--bg-panel`, `--accent-soft`, `--danger`,
    `--fg-muted`, `--control-off`, `--md-src-text` …).
  - Kontrast hlídá `tests/test_contrast.py`: text alespoň 4.5:1, ikony a obrys přepínače alespoň 3:1.
- **Noir efekty:** pravidlo `body:not(.np-glow) * { text-shadow: none !important }` je na
  začátku `noirpad.css`. Nový text-shadow mimo jeho dosah nepřidávej.
- **Okna** (dialogy, menu, popupy) používají společný blok „G7“ na konci `noirpad.css` a `NP.modal`
  (focus trap, návrat fokusu).
- **Ikony:** Lucide sprite (`static/vendor/lucide/sprite.svg`, 29 ikon). Nová ikona: přidej ji do
  `ICONS` v `tools/vendor.mjs`, spusť `npm run vendor` a použij `NP.icon("name")`.
- **Logo M1:** zdroje jsou `docs/brand/noirpad-icon.svg` (od 40 px) a `noirpad-icon-small.svg`
  (do 32 px). Kopie ve `static/img/` musí být shodné.
  - V UI se logo vkládá jen jako `<img class="… np-decorative">`, nikdy inline.
  - URL ikon mají `?v=__NP_VERSION__`, které doplní server.

### Mobil a PWA

- `mobile.js`: zlom je 900 px. Hamburger otevírá sidebar a ten se zavře 150 ms po výběru poznámky.
  CSS má bloky pro ≤ 900, ≤ 480 a dotykové ovládání.
- `manifest.json` (standalone, ikony s verzí). Service worker ani offline režim **nejsou**.

## 10. Desktop shell (`desktop.py`)

- **Konstanty:**
  - okno 1280×800, minimum 720×480,
  - `APP_MUTEX = "NoirPad-B6F2E7C0-AppMutex"`, musí být stejný jako `AppMutex` v `installer.iss`,
  - `SERVER_START_TIMEOUT` 15 s, `CLOSE_SAVE_TIMEOUT` 5 s, `CLOSE_BUSY_LIMIT` 120 s.
- **Start (`main` → `_run` → `_serve` → `_show_window`):**
  1. logování,
  2. zámek instance. Druhé spuštění přenese běžící okno do popředí (`EnumWindows`
     a `SetForegroundWindow`),
  3. mutex instalátoru, který se drží až do konce procesu,
  4. kontrola WebView2 v registru,
  5. token a `server_auth.configure(mode="desktop")`,
  6. uvicorn ve vlákně,
  7. `webview.start(gui="edgechromium", storage_path=<data>/webview)`.
- **Návratové kódy:** 0 ok · 1 server neběží nebo pád · 2 chybí WebView2 · 3 smoke test, ale už
  běží jiná instance · 4 smoke test a chybí moduly.
- **Chyby při startu** se zobrazí v message boxu česky nebo anglicky. Jazyk se bere z nastavení,
  pak z `install-language.txt`, pak z jazyka Windows. Exe je okenní, bez konzole.
- **Zavírání:**
  1. První `closing` se zruší.
  2. Zavolá se `evaluate_js("NP.editor.flushForClose()")`.
  3. Stav se kontroluje přes `NP.editor._closeBusy`. Na otázku se čeká bez limitu, na ukládání
     nejvýš 120 s.
  4. Při `"stay"` okno zůstane otevřené, jinak `window.destroy()`.
- **Nativní „Uložit jako“** (`desktop_save.py`):
  1. Export pošle `X-NoirPad-Save-As: 1`.
  2. Middleware ukáže dialog předvyplněný jménem z `Content-Disposition`, zapíše soubor a vrátí
     JSON `{saved, name, token}`.
  3. Toast nabídne „Otevřít složku“, které zavolá `/api/desktop/reveal`.
  4. Web stahuje normálně.
- **Most stránka ↔ okno:** žádné `js_api`. Python volá stránku jen přes `evaluate_js` (zavírání)
  a stránka mluví se serverem přes HTTP. Do `RUNTIME` se zapisují háčky `save_dialog`
  a `toggle_fullscreen` (F11).
- **Odkazy:** `OPEN_EXTERNAL_LINKS_IN_BROWSER=True`, takže `window.open` otevře systémový
  prohlížeč. Vlastní navigace se nikdy nepoužívá.
- **Smoke test** (`NoirPad.exe --smoke-test`): importuje `RUNTIME_IMPORTS`, zapíše
  `smoke-test.json` (port, token, verze) a čeká, dokud soubor nikdo nesmaže.

## 11. Testy

```powershell
.venv\Scripts\python.exe -m pytest      # 833 testů (19 souborů)
npx vitest run                          # 31 souborů v tests/js (~270 testů)
```

- **`tests/conftest.py`:**
  - před importem backendu nastaví dočasný `NOIRPAD_DATA_DIR`,
  - fixture `np_backend` dá každému testu vlastní datovou složku a režim server bez hesla,
  - `client` je TestClient s CSRF hlavičkou,
  - `pending(finding, step)` = `xfail(strict=True)`.
- **`tests/js/harness.js`:**
  - `loadApp(scripts)` postaví JSDOM a skripty v něm spustí přes `eval`,
  - `dangers(root)` je XSS skener,
  - `locale()` načte locale a přimíchá `static/locales/parts/*` (rozpracované soubory, do buildu
    nejdou).
- **`tests/js/flow.js`:** integrační harness. Pouští skutečné `utils, state, topbar, editor, tabs,
  tree` proti falešnému serveru v paměti (`srv`: etag, hold/release `getNote`, `failSaves` → 507,
  409 při nesouladu rev, koš, limity štítků).
  **Pravidlo:** každá oprava, která jde přes karty, dostane `flow-*.test.js`, který bez opravy
  selže.
- **Testy, které hlídají pravidla projektu:**

| Test | Hlídá |
|---|---|
| `test_version.py` | verze je jen v `__version__.py`. Jméno původního vlastníka smí být jen v `LICENSE` a `CLAUDE.md`. **Kontroluje i všechny `*.md` v kořeni, tedy i tento soubor.** |
| `test_contrast.py` | kontrast všech 17 motivů |
| `test_icons.py` | každá použitá ikona je ve spritu, žádné CDN |
| `test_brand.py` | kopie loga, `.ico`, BMP průvodce, `?v=` u ikon, texty v installer.iss |
| `test_security.py` | hlavičky a CSP, Host, CSRF, token, `test_r8_*` (handlery neblokují event loop, rate limit) |
| `test_desktop.py` | start a zavírání `desktop.py`, smoke test, mutex, installer.iss |
| `test_storage.py` | atomický zápis, obnova, snapshoty, zámek instance, plný disk, BOM |
| `test_scrub.py` | čištění kopií (N1): zamčené a smazané poznámky, limity stáří, start a ukládání nečekají |
| `test_note_formats.py` | šifrované formáty a odkazy (N2): převod, vazba na text, API bez hesla, kopie |
| `test_ci.py` | tvar workflow (práva jobů, 4 soubory draftu, SHA), lock s hashi odpovídá `requirements*.txt` |
| `i18n.test.js` | shodné klíče en/cs, žádný natvrdo zapsaný text v JS ani HTML, každý použitý klíč existuje |
| `test_i18n_api.py` | každý chybový kód backendu má klíč v locale |

- **Ruční zkoušky** dělej jen ve vlastní instanci: `NOIRPAD_DATA_DIR` ve scratch složce, vlastní
  port, headless Chrome s vlastním profilem nebo jsdom. Nikdy ne v uživatelově NoirPadu, jeho
  datech, schránce ani jeho aplikacích.

## 12. Build a vydání

`build.ps1` (spouštěj z **PowerShellu 7**; z bashe přes `powershell` chybí `Get-FileHash`):

1. skončí, když `git status --porcelain` není prázdný. **Neverzovaný soubor build zablokuje
   také**, takže tento `kontext.md` je potřeba commitnout,
2. `.venv` s Pythonem 3.14 + `requirements-dev.txt`,
3. `npm ci`, `pytest -q`, `npx vitest run`,
4. PyInstaller `noirpad.spec` → `dist\NoirPad\NoirPad.exe` (onedir, ~45 MB, bez UPX, nepodepsané),
5. `tools\smoke_test.ps1`: exe musí do 15 s odpovědět na `/api/version` a čistě skončit,
6. Inno Setup `/DAppVersion /DAppURL` → `dist\installer\NoirPad-Setup-<ver>.exe` (~19 MB) + `.sha256`.

**`installer.iss`:**

- per-user, bez admin práv, vždy do `%LOCALAPPDATA%\Programs\NoirPad`,
- `AppId {B6F2E7C0-…}` se **nesmí nikdy změnit**,
- při upgradu smaže `_internal`, při odinstalaci celou složku programu,
- data smaže jen na odpověď „Ano“ (výchozí je Ne),
- WebView2: kontrola v registru, stažení bootstrapperu, při `/VERYSILENT` tichá instalace,
- zapíše `install-language.txt`,
- zavře běžící NoirPad i jeho procesy WebView2,
- odmítne cizí neprázdnou složku.

**CI (`.github/workflows`):**

- `test.yml`: při každém push a PR běží pytest + vitest a souběžně celý `build.ps1`.
- `release.yml`, při tagu `v*.*.*`:
  1. ověří, že tag = `v` + `__version__`,
  2. spustí build a smoke test,
  3. vezme sekci z CHANGELOGu,
  4. vytvoří **draft** release se 4 soubory: `NoirPad-Setup-<ver>.exe`, `NoirPad-Setup.exe`
     (stálý název pro odkaz `releases/latest/download/NoirPad-Setup.exe` v README) a `.sha256`
     ke každému.
  5. Publikuje se ručně.

**Postup vydání:**

1. Zvedni `__version__` a přidej sekci `## [x.y.z] – datum` do CHANGELOGu (s odkazem na
   porovnání).
2. Commitni.
3. Push a tag spouští **uživatel sám**, protože GitHub příkazy agentovi blokuje klasifikátor.
   Agent mu napíše přesné příkazy (`git push origin main`, `git tag -a vX.Y.Z -m "NoirPad X.Y.Z"`,
   `git push origin vX.Y.Z`).
4. Počkej na `release.yml` a zkontroluj assety a hashe.
5. Draft publikuj.

Před každým publikováním repa, tagem nebo releasem se ptej.

## 13. Nástroje (`tools/`)

| Nástroj | Účel |
|---|---|
| `vendor.mjs` (`npm run vendor`) | z `node_modules` vygeneruje `static/vendor/`: markdown-it, DOMPurify, highlight.js, sprite Lucide (`ICONS`), fonty + `fonts.css`, `VERSIONS.json`. Výstup se commituje. |
| `demo_data.py <prázdná složka> [--lang cs]` | demo poznámky (jedna zamčená heslem `demo-password`) pro screenshoty a zkoušky |
| `take_screenshots.py [--gif \| --only shots\|gif]` | spustí `desktop.py` na demo datech a přes CDP a Playwright vyrobí `docs/screenshots/*` a `docs/demo.gif`. Potřebuje playwright, ffmpeg a oxipng. |
| `smoke_test.ps1 -Exe … -Version …` | smoke test zabaleného exe (volá ho build.ps1 i release.yml) |
| `make_icons.py` | ze zelených SVG v `docs/brand/` vykreslí všechny rastry loga (PNG, ICO, BMP průvodce, social preview) a hashe zapíše do `docs/brand/icons.json`. Spouští se ručně po změně loga. |

## 14. Pravidla a konvence (souhrn)

- **Verze** je jen v `noirpad/__version__.py`. Číslo verze nepiš do `.py`, `.spec`, `.iss`, `.ps1`,
  `static/js` ani do `index.html` (hlídá to test). Do ikon se dostane přes `__NP_VERSION__`.
- **Původní vlastník repa:** jeho jméno smí být jen v `LICENSE` a `CLAUDE.md`. Test prochází
  i `*.md` v kořeni, `.github/*.yml` a `static/**`.
- **i18n:** každý viditelný text jde přes `NP.t` nebo `data-i18n*`. `en.json` a `cs.json` se
  upravují vždy oba a mají stejné klíče.
- **DOM** se staví přes `textContent` a DOM API. `innerHTML` s uživatelskými daty nikdy.
- **Dialogy:** používej `NP.modal`, `NP.dialog` a `NP.passwordDialog`, nikdy `prompt`, `confirm`
  ani `alert`. Nové okno dostane styl „G7“.
- **Barvy:** používej tokeny. Po změně barvy motivu spusť `test_contrast.py`.
- **`static/vendor/`** se nikdy needituje ručně. Generuje se přes `npm run vendor`.
- **Backend:**
  - handler bez `await` = `def`,
  - sdílený stav, který se kontroluje a pak mění, potřebuje zámek,
  - zápis dat jen přes `update_data`,
  - chyby jen přes `ApiError(status, "code", **params)` + klíč v locale.
- **Log:** nikdy jméno uživatele, obsah poznámek ani hesla.
- **Odkazy v UI:** jen obyčejné `<a href>` (ošetří je `links.js`).
- **Commity:**
  - zprávy česky, s řádkem `Co-Authored-By`,
  - autor = GitHub noreply adresa nastavená v `git config user.email` tohoto repa,
  - **nikdy gmail** v autorovi ani v committerovi.
  - Commit jen na požádání. Push, tag, release a PR jen s výslovným „ano“ uživatele.
- **Testování:** jen ve vlastní instanci s dočasným `NOIRPAD_DATA_DIR`. Nesahej na
  `%LOCALAPPDATA%\NoirPad`, schránku ani běžící aplikace uživatele. Ukončuj jen procesy, které jsi
  sám spustil. Co nejde ověřit izolovaně, patří do ručního checklistu.
- **Windows:** absolutní cesty. Hlavní shell je PowerShell.

## 15. Známé nedodělky a podezřelá místa

Našel je průzkum 27. 10. 2026. Jsou ověřené v kódu, ne v běžící aplikaci.

1. **`:closeall`** v příkazové liště volá `NP.tabs.closeAll`, které neexistuje
   (`static/js/command-bar.js:311`), takže příkaz nic neudělá.
2. **`font_family` / `font_size`** se po startu neaplikují na editor. Projeví se až po použití
   výběru písma nebo `:fontsize` v dané relaci. Server je ale používá v HTML exportu.
3. **Ctrl+F** (`search.js`) hledá jen v rich-text `#editor`, ne ve zdroji Markdownu.
4. **Mrtvé DOM prvky** v `index.html`: `#command-bar`, `#search-bar` (s nahrazováním),
   `#context-menu`, `#matrix-canvas`. JS je nepoužívá, ale CSS na ně částečně ještě míří.
5. `cursor.js` se načítá, ale jeho `init` je zakomentovaný (`static/js/app.js:30-31`).
6. **Zastaralé komentáře:**
   - `app.js:444` zmiňuje `/api/auth/me` (správně `/api/session`),
   - `font-picker.js:9-11` zmiňuje Google Fonts (fonty jsou přibalené),
   - `themes.css:10` zmiňuje „12 themes“ (je jich 17).
7. Parametry `?v=` u skriptů a CSS v `index.html` jsou ruční a nejednotné. Nevadí to, protože
   server posílá `no-store`.
8. **CI:** job `build` nečeká na `test` a `build.ps1` pouští testy znovu, takže běží dvakrát.
9. **Drobnosti:**
   - nepoužitý parametr `log_file` v `desktop._run`,
   - dočasná složka z importu v `conftest.py` se neuklízí,
   - `BUILD.md` neuvádí `take_screenshots.py --only`.

## 15a. Přístupnost a CI (N1.5)

- Rozbalovací seznamy (`.np-dropdown`, `settings.js`) jsou `listbox` s ovládáním šipkami, Home, End,
  Enter, mezerníkem, Esc a Tab; fokus se vrací na tlačítko. Tab z otevřeného seznamu řeší `dialog.js`.
- Zoom desktopového okna: Ctrl+= / Ctrl+- / Ctrl+0 (`zoom-*` v `shortcuts.js`), `ui_zoom` 70–200 %,
  CSS `zoom` na `html` a proměnná `--np-zoom`, ze které `#app` počítá výšku. Ve webové verzi zkratky
  nejsou a zoom se nepoužije, řeší ho prohlížeč. Znak „+“ se v zápisu zkratky píše „=“.
- Vysoký kontrast Windows (`NP.forcedColors`, `@media (forced-colors: active)`): déšť, záře, CRT
  a glitch jsou vypnuté, nastavení zůstává. Stav se nesmí poznat jen podle pozadí.
- `release.yml` má dva joby: `build` (jen čtení, spouští všechno cizí) a `publish` (zápis, jen
  `gh release create`). Akce jsou na SHA, Inno Setup na verzi, CI buildy instalují
  `requirements-ci.lock` s `--require-hashes` (postup aktualizace v `BUILD.md`). Hlídá `tests/test_ci.py`.

## 16. Podklady mimo repozitář (`C:\vibe coding picoviny\Noirpad\`)

| Složka | Obsah |
|---|---|
| `1-aplikace\` | hlavní repo (větev `main`) |
| `2-store-1.1.0\` | worktree, větev `release/1.1.0` |
| `3-web\` | worktree, web (větev `feat/site`) |
| `4-hotfix-1.0.2\` | worktree, větev `hotfix/1.0.2` |
| `5-logo\` | podklady loga |
| `6-dokumenty\` | zadání a kontroly |
| `7-socialni-site\` | sociální sítě |

| Soubor | Obsah |
|---|---|
| `6-dokumenty\KONTROLA-NOIRPAD-2.md` | nálezy Kontroly 2 (ID E/T/R/U/S/I…), základ verze 1.0.1 |
| `6-dokumenty\NOIRPAD-TEST-1.0.1.md` | ruční testovací checklist 1.0.1 (prošel) |
| `6-dokumenty\NOIRPAD-VYDANI-1-0-1.md` | zadání vydání 1.0.1 (kroky, kontroly, winget) |
| `6-dokumenty\NOIRPAD-RELEASE-NOTES-1.0.1.md` | text release notes 1.0.1 |
| `6-dokumenty\NOIRPAD-LOGO-M1.md`, `5-logo\` | zadání a podklady nového loga |
| `6-dokumenty\NOIRPAD-STORE-EDICE.md` | další fáze: MSIX pro Microsoft Store (1.1.0) |
| `C:\vibe coding picoviny\arcly-studio\winget\` | winget manifesty `ArclyStudio.NoirPad` |

## 17. Rychlé příkazy

```powershell
# vývoj
py -3.14 -m venv .venv; .venv\Scripts\pip install -r requirements-dev.txt; npm ci
$env:NOIRPAD_DATA_DIR = "$env:TEMP\np-dev"; .venv\Scripts\python.exe desktop.py      # okno
$env:NOIRPAD_DATA_DIR = "$env:TEMP\np-dev"; .venv\Scripts\python.exe NoirPad-web.py  # http://127.0.0.1:8000

# testy
.venv\Scripts\python.exe -m pytest
npx vitest run

# vendor soubory (po změně ICONS nebo verzí knihoven)
npm run vendor

# build (čistý git strom, PowerShell 7)
pwsh -File build.ps1
```
