# Roadmap

## 1.0.2 (vydáno 2026-11-05)

Hotfix, jen aktualizace závislostí (N3).

- winget: dotáhnout schválení `ArclyStudio.NoirPad` (PR `microsoft/winget-pkgs#456673`). Manifest 1.0.2 se odešle až po jeho sloučení.

## 1.1.0: Store edice

MSIX balíček pro Microsoft Store a zbytek vlny 1 z auditu. Větev `release/1.1.0`, worktree `..\2-store-1.1.0\`.
Zadání: `..\6-dokumenty\NOIRPAD-STORE-EDICE.md`. Audit: `..\..\arcly-studio\security\AUDIT-2026-11.md`.

| Fáze | Co se dělá |
|---|---|
| **N1.1** | Worktree a větev ze sloučeného `main`, výchozí testy. |
| **N1.2** | Závislosti (N3): samotný hotfix je v 1.0.2, tady `cryptography` 50.0.2 a nové audity. |
| **N1.3** | N1 (čitelný text ve snapshotech, zipech a `corrupt` souborech) a N4 (přešifrování starého formátu v2). |
| **N1.4** | N2: formáty a odkazy zamčených poznámek. Obrázky se přesouvají do další verze: při zamykání poznámky s obrázky upozornění EN/CS, že obrázky šifrované nejsou, stejná informace v README, Privacy a nápovědě. Znění schvaluje uživatel. |
| **N1.5** | N11, N12, N14, N15: rozbalovací seznamy z klávesnice, vysoký kontrast, zoom, `aria-label`, Actions, Dependabot, `.gitignore`, `SECURITY.md`. |
| **N1.6** | Popisné názvy motivů v UI místo cizích názvů (návrh EN/CS schvaluje uživatel), interní id a uložené hodnoty zůstávají. Efekt „falling-code rain“ / „déšť padajícího kódu“, příkaz `:rain`, `:matrix` jen jako skrytý alias.<br>**Chyba:** efekt deště padajícího kódu není vidět, protože plátno `#matrix-canvas` zakrývá neprůhledný `#editor-wrapper` (v poznámce i na startovní stránce). Oprava + test, který bez opravy selže. |
| **N1.7** | URL repa malými písmeny, N8 (licence třetích stran, včetně licencí palet pěti motivů (MIT), z nichž vychází Levandulová noc, Neonový soumrak, Břidlice, Teplé retro a Půlnoční modrá; původní názvy těch motivů smí být jen v souboru licencí, nikdy v UI, nápovědě, README mimo sekci licencí, Store listingu ani na webu), N9 („Copyright (c) 2026 Arcly Studio“, první commit je z 2026-05-18; úprava `CLAUDE.md` a `test_version.py`), N10 (kontakt v O aplikaci). |
| **N1.8** | N5 a N7 v repu: `PRIVACY.md` a pravdivé texty o šifrování, včetně toho, že obrázky šifrované nejsou (N1.4). |
| **N1.9** | Balení: přepínač edice, složka dat, manifest, ikony, `build-msix.ps1` (viz níže). |
| **N1.10** | Verze 1.1.0 a CHANGELOG, včetně `cryptography` 50.0.2 z N1.2. Do CHANGELOGu dále: při prvním startu 1.1.0 se smažou `corrupt-*` a `pre-import` zipy starší než 30 dní (jen pokud jsou v datech poznámky); u starého formátu v2 může špatné heslo otevřít krátkou poznámku jako nesmysl, před odebráním zámku zkontroluj text; obrázky trvale smazané poznámky zůstávají v `pre-import` zipech do vypršení limitu; formátování a odkazy zamčených poznámek se nově šifrují, převod při prvním odemčení; po návratu na 1.0.x se zamčená poznámka otevře bez formátování a odkazů a její uložení nebo odebrání zámku je ve starší verzi natrvalo zahodí. |
| **N1.11** | Instalace, odinstalace, upgrade a WACK na druhém lokálním účtu Windows. Testovací certifikát s adminem až po výslovném „ano“ uživatele v tu chvíli. Bez Windows 10 VM. Podle výsledku dopřesnit Privacy. |
| **N1.12** | Listing EN/CS a `store/questionnaire.md`: podklady k šifrování (jaké, z jaké knihovny, veřejně dostupný kód) bez právních závěrů. Otázku na ECCN ověří uživatel v Partner Center. |
| **N1.13** | Screenshoty pro Store EN/CS s demo daty, až po přejmenování motivů. |
| **N1.14** | Demo video aspoň 1280 px a hero screenshoty 2× pro web. |

### N1.9: identita a data

Identita MSIX z Partner Center (do kódu až v této fázi):

| Pole | Hodnota |
|---|---|
| Name | `krystof02.NoirPad` |
| Publisher | `CN=7A230D16-A4F0-44D2-9725-8DF77823543E` |
| PublisherDisplayName | `Arcly Studio` |
| PFN | `krystof02.NoirPad_dj1cwq44hn4j8` |

Data ve Store edici jsou v `%USERPROFILE%\NoirPad`. Jednorázový import z GitHub edice (`%LOCALAPPDATA%\NoirPad`) je kopie, ne přesun, a kontroluje zámek běžící GitHub edice. Privacy a README řeknou, že odinstalace ze Storu poznámky nesmaže, a jak je smazat ručně.

**Kopie při importu (návrh rozhodnutí je součást N1.9):** datová složka GitHub edice může obsahovat čitelné kopie. Jednorázový import z `%LOCALAPPDATA%\NoirPad` buď nekopíruje `backups/` a `corrupt-*` soubory, nebo je po kopii vyčistí stejným mechanismem (`noirpad/scrub.py`). Import musí zachovat čas souborů kopií (`shutil.copy2` nebo ekvivalent) a mít na to test: čištění podle něj pozná kopii novější než zamčení (čas souboru proti času ve Fernet tokenu obálky), s novým časem by ji přepsalo.

### N1.11: ruční checklist

- [ ] Zamknout poznámku se značkovým textem, zavřít aplikaci, prohledat celou datovou složku včetně `webview/` a obsahu zipů v `backups/`: text se nesmí najít. Totéž pro značkovou URL odkazu v té poznámce.

### Podmínky před odesláním do Storu

- Webové části N5, N6 a N13 dělá session webu a musí být nasazené.
- Závazné pořadí: build → test → úprava Privacy → nasazení webu → odeslání do Storu.

## 1.0.3

- `:closeall` v příkazové liště – doplnit `NP.tabs.closeAll` (dnes příkaz nic neudělá).
- Písmo a velikost z nastavení (`font_family`, `font_size`) použít v editoru hned po startu.
- Ctrl+F hledat i ve zdroji Markdownu, nejen v rich-text editoru.
- CI: job `build` ať čeká na `test` a testy neběží dvakrát.

## Později

- Plné šifrování obrázků zamčených poznámek (přesunuto z 1.1.0).
- Úklid: mrtvé DOM prvky v `index.html`, nepoužitý `cursor.js`, zastaralé komentáře, jednotné `?v=` u skriptů.
- Drobnosti: parametr `log_file` v `desktop._run`, úklid dočasné složky v `conftest.py`, `take_screenshots.py --only` do `BUILD.md`.
