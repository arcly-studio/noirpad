// All website copy, English and Czech (Czech uses the formal "vy", like the app).
// Only claims verified in the app's code and README (sources are listed next to each block).
// Encryption (1.1.0): only the text and formatting (incl. links) of a locked note – never say "encrypted notes" in general.
// No names of third-party products (scripts/check-words.mjs enforces it on the built HTML).
// Privacy and Support: titles here, the page text in src/pages/{,cs/}{privacy,support}.astro.

export type Lang = "en" | "cs";
export type FeatureKey = "write" | "lock" | "themes" | "command" | "tabs" | "tags" | "search" | "export" | "backup";
/** A shortcut: keys as groups ("Ctrl+S" or "Ctrl+Tab / Ctrl+W"), action text. */
export type Shortcut = { keys: string; action: string };

export const texts = {
  en: {
    htmlLang: "en",
    title: "NoirPad – Markdown notes you can lock with a password",
    description:
      "Notes for Windows in a terminal look: Markdown with live preview, rich text with images and a password lock for any note. No account, no cloud, no telemetry.",
    ogLocale: "en_US",
    ogAlt: "NoirPad – Markdown notes you can lock with a password. For Windows, no account, no cloud, no telemetry.",
    skip: "Skip to content",
    langSwitch: "Language",
    nav: { home: "NoirPad – home", features: "Features", install: "Install", faq: "FAQ", github: "NoirPad on GitHub", menu: "Menu" },
    hero: {
      tagline: "Markdown notes you can lock with a password.",
      sub: "Notes stay in a folder on your PC. No account, no cloud, no telemetry.",
      smartscreen: { before: "Windows may show a SmartScreen warning – see ", link: "how to install" },
      meta: ["Windows 10/11", "x64", "Free", "MIT license"],
      // Decorative typing line (aria-hidden): a real command bar command (static/js/command-bar.js) and the title of
      // the dialog it opens, word for word (static/locales/en.json → encryption.lockTitle, static/js/encryption.js).
      typed: [":encrypt", "Lock note with a password"],
      shotAlt: "NoirPad with a rich-text note: a large heading, a picture and a short packing list; folders and tags on the left",
    },
    features: {
      eyebrow: "features",
      title: "Everything a note needs. Nothing it doesn't.",
      lead: "Rich text or Markdown, tabs, folders and tags – in a dark, keyboard-friendly window.",
      // README → Features (Writing, Markdown & code, Encryption, Themes, Organize, Export & backup).
      cards: {
        write: {
          title: "Rich text or Markdown",
          text: "Each note is rich text with images, or Markdown with a live preview next to the source: tables, task lists and syntax-highlighted code.",
          alt: "Markdown source on the left and its live preview on the right: a table, highlighted code and a task list",
        },
        lock: {
          title: "Lock a note with a password",
          text: "Ctrl+Shift+L locks a note with its own password and encrypts its text (from version 1.1.0 also its formatting and links). A forgotten password cannot be recovered.",
          alt: "The dialog for locking a note: the password twice and a warning that a forgotten password cannot be recovered",
        },
        themes: {
          title: "17 themes",
          text: "From terminal green to a dark blue theme. Glow, CRT scanlines and falling-code rain are optional – off by default.",
          alt: "The same note in four themes: green, dark blue, amber and purple",
        },
        command: {
          title: "Command bar",
          text: "Ctrl+Shift+P opens the command bar – type :theme, :tag, :export or :encrypt instead of looking for a menu.",
          alt: "The command bar with commands for locking and exporting a note",
        },
        tabs: { title: "Tabs and folders", text: "Open notes in tabs and sort them into folders with drag and drop. Focus mode hides the rest." },
        tags: { title: "Tags and favorites", text: "Filter by tag in the side panel, pin favorites to the top. Deleted notes wait in the trash." },
        search: { title: "Search everything", text: "Ctrl+F finds text in the note, Ctrl+Shift+K searches all your notes at once." },
        export: { title: "Export", text: "A note as TXT, HTML or PDF; all unlocked notes as Markdown files or HTML pages in one ZIP." },
        backup: { title: "Backups", text: "One ZIP with all notes and images, plus automatic snapshots: the last 7, at most one per 10 minutes." },
      },
    },
    demo: {
      eyebrow: "demo",
      title: "From an empty note to a locked one",
      lead: "A new note, Markdown with live preview, a theme from the command bar and a password lock – in 15 seconds.",
      label: "Demo video without sound: creating a note, writing Markdown, switching the theme and locking the note",
      play: "Play the video",
      pause: "Pause the video",
    },
    privacy: {
      eyebrow: "privacy",
      title: "Your notes stay on your PC",
      // README → Install ("Your data"), Security & privacy; kontext §8; server_auth.py (connect-src 'self').
      points: [
        { title: "Stored locally", text: "Notes, images and backups are in one folder on your PC: %LOCALAPPDATA%\\NoirPad (Microsoft Store version, from version 1.1.0: %USERPROFILE%\\NoirPad)." },
        { title: "No account, no cloud", text: "Nothing to sign up for and nothing to sync. No telemetry, no ads." },
        { title: "No network requests", text: "Fonts, the Markdown renderer and the code highlighter are bundled; there is no update check. Only links you click leave the app." },
      ],
      lockTitle: "What a locked note protects",
      lockLead: "Locking encrypts the text of that one note – from version 1.1.0 also its formatting and links – with Fernet (AES) and a key derived from your password via PBKDF2 (480,000 iterations, a random salt per note).",
      encrypted: "Encrypted",
      notEncrypted: "Not encrypted",
      encryptedItems: ["the note's text", "its formatting and links (from version 1.1.0)"],
      notEncryptedItems: ["the note's name, tags and folder", "images in the note", "favorites and settings"],
      warning: "A forgotten note password cannot be recovered – there is no reset and no back door.",
      more: "Read the privacy policy",
    },
    install: {
      eyebrow: "install",
      title: "Install",
      lead: "NoirPad is free. The Microsoft Store version is on its way.",
      // README → Install; BUILD.md; installer.iss (PrivilegesRequired=lowest).
      reqTitle: "Requirements",
      req: ["Windows 10 or 11, 64-bit (x64)", "No admin rights needed – installs for your user only", "Microsoft Edge WebView2 Runtime (Windows 11 has it; on Windows 10 the installer offers it)"],
      latest: "Latest release on GitHub",
      smartscreen:
        "The installer from GitHub is not code-signed, so Windows may show a SmartScreen warning – choose “More info” → “Run anyway”.",
    },
    shortcuts: {
      eyebrow: "keyboard",
      title: "Keyboard shortcuts",
      lead: "The most used ones. Every shortcut can be remapped in Settings.",
      all: "All shortcuts",
      keyCol: "Shortcut",
      actionCol: "Action",
      // static/js/shortcuts.js (defaults), help.js (F1), README → Keyboard shortcuts.
      main: [
        { keys: "Ctrl+Shift+N", action: "New note" },
        { keys: "Ctrl+S", action: "Save" },
        { keys: "Ctrl+M", action: "Switch between rich text and Markdown" },
        { keys: "Ctrl+Shift+K", action: "Search all notes" },
        { keys: "Ctrl+Shift+P", action: "Command bar" },
        { keys: "Ctrl+Shift+L", action: "Lock or unlock the note" },
      ] as Shortcut[],
      rest: [
        { keys: "Ctrl+Shift+F", action: "New folder" },
        { keys: "Ctrl+F / F3 / Shift+F3", action: "Find in the note, next / previous match" },
        { keys: "Ctrl+D", action: "Add to / remove from favorites" },
        { keys: "F2 / Delete", action: "Rename / move to trash" },
        { keys: "Ctrl+B / Ctrl+I / Ctrl+K", action: "Bold / italic / link (from version 1.1.0 also in rich text; in 1.0.2 only in the Markdown editor)" },
        { keys: "Ctrl+Shift+B", action: "Focus mode, hides the side panel (from version 1.1.0; in 1.0.2 it is Ctrl+B outside the Markdown editor)" },
        { keys: "Ctrl+Shift+V / Ctrl+Space", action: "Paste as plain text / clear formatting of the selection" },
        { keys: "Ctrl+Tab / Ctrl+W", action: "Next tab / close tab" },
        { keys: "Ctrl+, / F1", action: "Settings / help" },
      ] as Shortcut[],
    },
    faq: {
      eyebrow: "faq",
      title: "Questions and answers",
      // README → Security & privacy, Install, Export & backup; routes/backup.py; LICENSE.
      items: [
        {
          q: "I forgot the password of a locked note. Can I get it back?",
          a: "No. The password is not stored anywhere and there is no reset or back door – without it, the text of that note cannot be decrypted. Choose a password you will remember.",
        },
        {
          q: "What exactly is encrypted?",
          a: "The text of a locked note – from version 1.1.0 also its formatting and links (in 1.0.2 they are not encrypted). Its name, tags and folder, the images in it, favorites and settings are not encrypted. Notes you don't lock are stored as plain text. The optional app lock asks for a password when NoirPad starts and after a period of inactivity – it does not encrypt anything.",
        },
        {
          q: "Where are my notes stored?",
          a: "On your computer, in %LOCALAPPDATA%\\NoirPad (Microsoft Store version, from version 1.1.0: %USERPROFILE%\\NoirPad): notes_data.json with notes and settings, the images folder, automatic backups and logs (never with note content). Uninstalling keeps your notes unless you choose to delete them too.",
        },
        {
          q: "How do I back up my notes or move them to another PC?",
          a: "Choose Download backup (.zip) in the ⋯ menu (or :backup in the command bar) – it saves one ZIP with all notes and images. On the other PC, choose Import backup in Settings (or :import in the command bar). Importing replaces the notes there; NoirPad first saves a safety copy of them. Locked notes stay locked and still need their password.",
        },
        {
          q: "Is NoirPad free? Is it open source?",
          a: "Yes to both. NoirPad is free, without ads or in-app purchases, and its source code is on GitHub under the MIT license.",
        },
      ],
    },
    privacyPage: {
      title: "Privacy Policy – NoirPad",
      description: "NoirPad collects no personal data: no account, no telemetry, no network requests. What is stored on your PC, what a locked note encrypts, and this website.",
      heading: "Privacy Policy",
      lead: "NoirPad is a notes app that runs on your computer. It collects no personal data and sends nothing anywhere.",
    },
    supportPage: {
      title: "Help and support – NoirPad",
      description: "Help with NoirPad: e-mail, bug reports and ideas on GitHub, a forgotten password, where your notes are, backups, SmartScreen and WebView2.",
      heading: "Support",
      lead: "A question, a bug or an idea? Here is where to go.",
    },
    updated: "Last updated:",
    footer: {
      nav: "Links",
      github: "GitHub",
      changelog: "Changelog",
      privacy: "Privacy",
      support: "Support",
      note: "NoirPad is free software under the MIT license.",
      by: "by Arcly Studio",
      more: "also from the studio:",
      socials: "NoirPad on social networks",
    },
  },
  cs: {
    htmlLang: "cs",
    title: "NoirPad – poznámky v Markdownu, které můžete zamknout heslem",
    description:
      "Poznámky pro Windows s terminálovým vzhledem: Markdown s živým náhledem, obrázky a zámek heslem pro každou poznámku. Bez účtu, cloudu a telemetrie.",
    ogLocale: "cs_CZ",
    ogAlt: "NoirPad – poznámky v Markdownu, které můžete zamknout heslem. Pro Windows, bez účtu, cloudu a telemetrie.",
    skip: "Přeskočit na obsah",
    langSwitch: "Jazyk",
    nav: { home: "NoirPad – úvod", features: "Funkce", install: "Instalace", faq: "Otázky", github: "NoirPad na GitHubu", menu: "Nabídka" },
    hero: {
      tagline: "Poznámky v Markdownu, které můžete zamknout heslem.",
      sub: "Poznámky zůstávají ve složce v počítači. Bez účtu, bez cloudu, bez telemetrie.",
      smartscreen: { before: "Windows může zobrazit upozornění SmartScreen – viz ", link: "Instalace" },
      meta: ["Windows 10/11", "x64", "Zdarma", "Licence MIT"],
      typed: [":encrypt", "Zamknout poznámku heslem"],
      shotAlt: "NoirPad s formátovanou poznámkou: velký nadpis, obrázek a krátký seznam věcí na cestu; vlevo složky a štítky",
    },
    features: {
      eyebrow: "funkce",
      title: "Všechno, co poznámka potřebuje. Nic navíc.",
      lead: "Formátovaný text nebo Markdown, karty, složky a štítky – v tmavém okně, které se dobře ovládá z klávesnice.",
      cards: {
        write: {
          title: "Formátovaný text nebo Markdown",
          text: "Každá poznámka je formátovaný text s obrázky, nebo Markdown s živým náhledem vedle zdroje: tabulky, úkoly a zvýrazněný kód.",
          alt: "Vlevo zdroj v Markdownu, vpravo jeho živý náhled: tabulka, zvýrazněný kód a seznam úkolů",
        },
        lock: {
          title: "Zámek heslem",
          text: "Ctrl+Shift+L zamkne poznámku vlastním heslem a zašifruje její text (od verze 1.1.0 i formátování a odkazy). Zapomenuté heslo nejde obnovit.",
          alt: "Okno pro zamčení poznámky: heslo dvakrát a upozornění, že zapomenuté heslo nejde obnovit",
        },
        themes: {
          title: "17 motivů",
          text: "Od zelené terminálové po tmavě modrý motiv. Záře, CRT scanlines a déšť padajícího kódu jsou volitelné – ve výchozím stavu vypnuté.",
          alt: "Stejná poznámka ve čtyřech motivech: zelený, tmavě modrý, jantarový a fialový",
        },
        command: {
          title: "Příkazová lišta",
          text: "Ctrl+Shift+P otevře příkazovou lištu – napíšete :theme, :tag, :export nebo :encrypt a nemusíte hledat v nabídce.",
          alt: "Příkazová lišta s příkazy pro zamčení a export poznámky",
        },
        tabs: { title: "Karty a složky", text: "Poznámky otevřené v kartách, třídění do složek přetažením. Režim soustředění skryje vše ostatní." },
        tags: { title: "Štítky a oblíbené", text: "Filtr podle štítku v postranním panelu, oblíbené nahoře. Smazané poznámky čekají v koši." },
        search: { title: "Hledání ve všem", text: "Ctrl+F hledá v poznámce, Ctrl+Shift+K ve všech poznámkách najednou." },
        export: { title: "Export", text: "Poznámka jako TXT, HTML nebo PDF; všechny odemčené poznámky jako soubory Markdownu nebo stránky HTML v jednom ZIPu." },
        backup: { title: "Zálohy", text: "Jeden ZIP se všemi poznámkami a obrázky a k tomu automatické zálohy: posledních 7, nejvýš jedna za 10 minut." },
      },
    },
    demo: {
      eyebrow: "ukázka",
      title: "Od prázdné poznámky k zamčené",
      lead: "Nová poznámka, Markdown s živým náhledem, motiv z příkazové lišty a zámek heslem – za 15 sekund.",
      label: "Ukázkové video bez zvuku: nová poznámka, psaní v Markdownu, změna motivu a zamčení poznámky",
      play: "Přehrát video",
      pause: "Pozastavit video",
    },
    privacy: {
      eyebrow: "soukromí",
      title: "Poznámky zůstávají ve vašem počítači",
      points: [
        { title: "Uloženo v počítači", text: "Poznámky, obrázky i zálohy jsou v jedné složce v počítači: %LOCALAPPDATA%\\NoirPad (verze z Microsoft Storu, od verze 1.1.0: %USERPROFILE%\\NoirPad)." },
        { title: "Bez účtu a cloudu", text: "Nic se nezakládá a nic se nesynchronizuje. Žádná telemetrie, žádné reklamy." },
        { title: "Žádné síťové požadavky", text: "Písma, vykreslování Markdownu i zvýrazňování kódu jsou součástí aplikace; aktualizace se nekontrolují. Ven vedou jen odkazy, na které kliknete." },
      ],
      lockTitle: "Co zámek poznámky chrání",
      lockLead: "Zamčení zašifruje text té jedné poznámky – od verze 1.1.0 i formátování a odkazy – algoritmem Fernet (AES) a klíčem odvozeným z vašeho hesla přes PBKDF2 (480 000 iterací, náhodná sůl pro každou poznámku).",
      encrypted: "Šifrované",
      notEncrypted: "Nešifrované",
      encryptedItems: ["text poznámky", "její formátování a odkazy (od verze 1.1.0)"],
      notEncryptedItems: ["název, štítky a složka poznámky", "obrázky v poznámce", "oblíbené a nastavení"],
      warning: "Zapomenuté heslo poznámky nejde obnovit – neexistuje žádný reset ani zadní vrátka.",
      more: "Zásady ochrany soukromí",
    },
    install: {
      eyebrow: "instalace",
      title: "Instalace",
      lead: "NoirPad je zdarma. Verze pro Microsoft Store je na cestě.",
      reqTitle: "Požadavky",
      req: ["Windows 10 nebo 11, 64bitové (x64)", "Bez práv správce – instaluje se jen pro vašeho uživatele", "Microsoft Edge WebView2 Runtime (Windows 11 ho mají, na Windows 10 ho nabídne instalátor)"],
      latest: "Nejnovější verze na GitHubu",
      smartscreen:
        "Instalátor z GitHubu není podepsaný, takže Windows může ukázat varování SmartScreen – zvolte „Další informace“ → „Přesto spustit“.",
    },
    shortcuts: {
      eyebrow: "klávesnice",
      title: "Klávesové zkratky",
      lead: "Ty nejpoužívanější. Každou zkratku můžete v Nastavení přemapovat.",
      all: "Všechny zkratky",
      keyCol: "Zkratka",
      actionCol: "Akce",
      main: [
        { keys: "Ctrl+Shift+N", action: "Nová poznámka" },
        { keys: "Ctrl+S", action: "Uložit" },
        { keys: "Ctrl+M", action: "Přepnout mezi formátovaným textem a Markdownem" },
        { keys: "Ctrl+Shift+K", action: "Hledat ve všech poznámkách" },
        { keys: "Ctrl+Shift+P", action: "Příkazová lišta" },
        { keys: "Ctrl+Shift+L", action: "Zamknout nebo odemknout poznámku" },
      ] as Shortcut[],
      rest: [
        { keys: "Ctrl+Shift+F", action: "Nová složka" },
        { keys: "Ctrl+F / F3 / Shift+F3", action: "Hledat v poznámce, další / předchozí výskyt" },
        { keys: "Ctrl+D", action: "Přidat do oblíbených / odebrat" },
        { keys: "F2 / Delete", action: "Přejmenovat / přesunout do koše" },
        { keys: "Ctrl+B / Ctrl+I / Ctrl+K", action: "Tučně / kurzíva / odkaz (od verze 1.1.0 i ve formátovaném textu; ve verzi 1.0.2 jen v editoru Markdownu)" },
        { keys: "Ctrl+Shift+B", action: "Režim soustředění, skryje postranní panel (od verze 1.1.0; ve verzi 1.0.2 je to Ctrl+B mimo editor Markdownu)" },
        { keys: "Ctrl+Shift+V / Ctrl+Mezerník", action: "Vložit jako prostý text / vymazat formátování označeného textu" },
        { keys: "Ctrl+Tab / Ctrl+W", action: "Další karta / zavřít kartu" },
        { keys: "Ctrl+, / F1", action: "Nastavení / nápověda" },
      ] as Shortcut[],
    },
    faq: {
      eyebrow: "otázky",
      title: "Otázky a odpovědi",
      items: [
        {
          q: "Zapomněli jste heslo zamčené poznámky? Dá se obnovit?",
          a: "Ne. Heslo se nikam neukládá a neexistuje žádný reset ani zadní vrátka – bez něj text té poznámky rozšifrovat nejde. Zvolte heslo, které si zapamatujete.",
        },
        {
          q: "Co přesně se šifruje?",
          a: "Text zamčené poznámky – od verze 1.1.0 i její formátování a odkazy (ve verzi 1.0.2 šifrované nejsou). Její název, štítky a složka, obrázky v ní, oblíbené a nastavení šifrované nejsou. Poznámky, které nezamknete, se ukládají jako běžný text. Volitelný zámek aplikace chce heslo při spuštění NoirPadu a po delší nečinnosti – nic nešifruje.",
        },
        {
          q: "Kde jsou moje poznámky uložené?",
          a: "V počítači ve složce %LOCALAPPDATA%\\NoirPad (verze z Microsoft Storu, od verze 1.1.0: %USERPROFILE%\\NoirPad): notes_data.json s poznámkami a nastavením, složka s obrázky, automatické zálohy a logy (nikdy s obsahem poznámek). Odinstalace poznámky nesmaže, pokud to sami nezvolíte.",
        },
        {
          q: "Jak poznámky zálohovat nebo přenést do jiného počítače?",
          a: "V nabídce ⋯ zvolte Stáhnout zálohu (.zip) (nebo v příkazové liště :backup) – uloží se jeden ZIP se všemi poznámkami a obrázky. V druhém počítači zvolte v Nastavení Importovat zálohu (nebo v příkazové liště :import). Import nahradí tamní poznámky; NoirPad je předtím uloží do bezpečnostní kopie. Zamčené poznámky zůstanou zamčené a dál potřebují své heslo.",
        },
        {
          q: "Je NoirPad zdarma? Je open source?",
          a: "Ano i ano. NoirPad je zdarma, bez reklam a nákupů v aplikaci, a jeho zdrojový kód je na GitHubu pod licencí MIT.",
        },
      ],
    },
    privacyPage: {
      title: "Zásady ochrany soukromí – NoirPad",
      description: "NoirPad nesbírá žádné osobní údaje: bez účtu, telemetrie a síťových požadavků. Co se ukládá v počítači, co zámek poznámky šifruje a jak je to s webem.",
      heading: "Zásady ochrany soukromí",
      lead: "NoirPad je aplikace na poznámky, která běží ve vašem počítači. Nesbírá žádné osobní údaje a nic nikam neodesílá.",
    },
    supportPage: {
      title: "Pomoc a podpora – NoirPad",
      description: "Pomoc s NoirPadem: e-mail, chyby a nápady na GitHubu, zapomenuté heslo, kde jsou poznámky, zálohy, SmartScreen a WebView2.",
      heading: "Podpora",
      lead: "Máte otázku, chybu nebo nápad? Tady je, kam se obrátit.",
    },
    updated: "Naposledy upraveno:",
    footer: {
      nav: "Odkazy",
      github: "GitHub",
      changelog: "Seznam změn",
      privacy: "Soukromí",
      support: "Podpora",
      note: "NoirPad je svobodný software pod licencí MIT.",
      by: "od Arcly Studio",
      more: "také od studia:",
      socials: "NoirPad na sociálních sítích",
    },
  },
} as const;
