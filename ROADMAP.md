# Roadmap

## 1.0.2

- **Store edice** (hlavní novinka): MSIX balíček pro Microsoft Store, fáze S1 – zadání v `..\NOIRPAD-STORE-EDICE.md`.
- winget: dotáhnout schválení `ArclyStudio.NoirPad` (PR `microsoft/winget-pkgs#456673`) a po vydání přidat novou verzi.

## 1.0.3

- `:closeall` v příkazové liště – doplnit `NP.tabs.closeAll` (dnes příkaz nic neudělá).
- Písmo a velikost z nastavení (`font_family`, `font_size`) použít v editoru hned po startu.
- Ctrl+F hledat i ve zdroji Markdownu, nejen v rich-text editoru.
- CI: job `build` ať čeká na `test` a testy neběží dvakrát.

## Později

- Úklid: mrtvé DOM prvky v `index.html`, nepoužitý `cursor.js`, zastaralé komentáře, jednotné `?v=` u skriptů.
- Drobnosti: parametr `log_file` v `desktop._run`, úklid dočasné složky v `conftest.py`, `take_screenshots.py --only` do `BUILD.md`.
