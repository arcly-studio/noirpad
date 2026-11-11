# Zásady ochrany soukromí NoirPadu

**Čeština** · [English](PRIVACY.md)

Poslední změna: 2026-11-11. Platí pro NoirPad 1.1.0 a novější.

## Stručně

NoirPad ukládá poznámky jen ve vašem počítači. Sám nikam neposílá žádná data. Nemá účet ani
telemetrii.

## Co NoirPad ukládá a kam

- **Edice z GitHubu:** `%LOCALAPPDATA%\NoirPad`
- **Edice z Microsoft Storu:** *Zástupný text: složka dat Store edice se potvrdí po testu (N1.11).*

V té složce:

| Co | Obsah |
|---|---|
| `notes_data.json` | poznámky, složky, štítky, oblíbené, nastavení |
| `images\` | obrázky vložené do poznámek |
| `backups\` | automatické kopie `notes_data.json` (posledních 7), kopie před každým importem a poškozené soubory (obojí se maže po 30 dnech) |
| `logs\` | `noirpad.log`, nejvýš 1 MB × 3 soubory |
| `webview\` | data komponenty okna (mezipaměť, její nastavení) |

## Co je šifrované

Šifruje se jen text a formátování (včetně odkazů) zamčených poznámek (Fernet, klíč odvozený
z hesla; heslo se nikam neukládá). Když heslo zapomenete, text nejde obnovit – ani námi.

Nešifrované jsou názvy poznámek, štítky, složky, **obrázky (i v zamčených poznámkách)**, oblíbené
a nastavení a každá nezamčená poznámka. Kdo má přístup k vašemu účtu ve Windows, může je
přečíst. Zámek aplikace brání v otevření NoirPadu, ale nic nešifruje.

U zamčených poznámek z verzí před 1.1.0 zůstává formátování a odkazy čitelné, dokud je jednou
neodemknete heslem.

NoirPad smaže čitelný text i ze svých automatických kopií, ale Windows nebo disk si můžou starší
verzi souboru ještě nějakou dobu držet.

## Log

Log obsahuje údaje o spuštění, porty, verze a chyby. Nikdy v něm není obsah poznámek, jejich
názvy ani hesla. Vaše uživatelská složka se zapisuje jako `~`.

## Síť

NoirPad sám nic po síti neposílá ani nestahuje. Písma, vykreslování Markdownu a zvýrazňování kódu
jsou součástí aplikace a její malý vestavěný server poslouchá jen v tomto počítači (127.0.0.1).
Odkazy, na které kliknete, se otevřou ve webovém prohlížeči.

NoirPad se zobrazuje přes **Microsoft WebView2**, systémovou komponentu Windows, kterou spravuje
a aktualizuje Windows podle
[prohlášení Microsoftu o zásadách ochrany osobních údajů](https://privacy.microsoft.com/cs-cz/privacystatement).

Když WebView2 chybí, instalátor edice z GitHubu nabídne jeho stažení od Microsoftu. Tichá
instalace (např. winget) ho nainstaluje bez ptaní.

## Edice z Microsoft Storu

Stažení, instalaci a aktualizace Store edice zajišťuje Microsoft Store podle pravidel Microsoftu
a jeho prohlášení o zásadách ochrany osobních údajů. Podle nastavení diagnostických dat ve Windows
nám Microsoft může v Partner Center ukázat statistiky stažení a hlášení o pádech (Windows Error
Reporting). NoirPad sám nic neposílá.

Při prvním spuštění Store edice zkopíruje poznámky a obrázky GitHub edice ze složky
`%LOCALAPPDATA%\NoirPad` do své složky, pokud tam nějaké jsou. Je to kopie: složka GitHub edice
zůstane, jak je. Automatické kopie (zálohy) se nekopírují.

## Odinstalace a smazání dat

- **Edice z GitHubu:** odinstalace smaže složku programu a zeptá se, jestli smazat i poznámky
  (výchozí volba je Ne). Později je smažete odstraněním složky `%LOCALAPPDATA%\NoirPad`.
- **Edice z Microsoft Storu:** *Zástupný text: finální znění po testu (N1.11).*

Zálohy, které jste si sami stáhli, zůstanou tam, kam jste je uložili.

## Vlastní server

Když NoirPad provozujete jako webový server, data zůstávají na tom serveru a odpovídáte za ně vy.

## Kontakt

Arcly Studio, [arclystudio.dev@gmail.com](mailto:arclystudio.dev@gmail.com).
Bezpečnostní chyby: viz [SECURITY.md](SECURITY.md).

## Změny

Změny těchto zásad jsou zaznamenané v historii tohoto souboru na GitHubu.
