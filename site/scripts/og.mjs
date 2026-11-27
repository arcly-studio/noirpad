// Open Graph images (1200×630, EN + CS) in the NoirPad terminal look: the app icon, the wordmark in Orbitron,
// the tagline and a command line. Rendered with the installed Chrome (playwright-core, channel "chrome") from
// HTML using the self-hosted fonts, and stored as static files in public/ (committed) – the build and CI do
// not need Chrome. Re-run by hand after changing the texts or the icon: npm run og
// Texts follow src/i18n/texts.ts (no names of third-party products, encryption = "lock a note").
import fs from "fs";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const b64 = (rel) => fs.readFileSync(p(rel)).toString("base64");
const font = (pkg, file) => b64(`../node_modules/@fontsource-variable/${pkg}/files/${file}`);
const fonts = {
  orbitron: font("orbitron", "orbitron-latin-wght-normal.woff2"),
  mono: font("jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2"),
  monoExt: font("jetbrains-mono", "jetbrains-mono-latin-ext-wght-normal.woff2"),
  inter: font("inter", "inter-latin-wght-normal.woff2"),
  interExt: font("inter", "inter-latin-ext-wght-normal.woff2"),
};
const icon = b64("../../docs/brand/noirpad-1024.png");

const TEXTS = {
  en: {
    tagline: "Markdown notes you can lock with a password.",
    sub: "For Windows · no account · no cloud · no telemetry",
    cmd: ":encrypt",
    by: "by Arcly Studio",
  },
  cs: {
    tagline: "Poznámky v Markdownu, které můžete zamknout heslem.",
    sub: "Pro Windows · bez účtu · bez cloudu · bez telemetrie",
    cmd: ":encrypt",
    by: "od Arcly Studio",
  },
};

const LATIN_EXT = "U+0100-024F";
const face = (family, data, range) =>
  `@font-face { font-family: "${family}"; font-weight: 100 900; src: url(data:font/woff2;base64,${data}) format("woff2");${range ? ` unicode-range: ${range};` : ""} }`;

const html = (t) => `<!doctype html><html><head><meta charset="utf-8"><style>
${face("Orbitron", fonts.orbitron)}
${face("Mono", fonts.monoExt, LATIN_EXT)}
${face("Mono", fonts.mono)}
${face("Inter", fonts.interExt, LATIN_EXT)}
${face("Inter", fonts.inter)}
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: 630px; }
body {
  position: relative; overflow: hidden; color: #e6ede8; font-family: Inter, sans-serif;
  background:
    radial-gradient(640px 380px at 24% 30%, rgba(0, 255, 65, 0.13), transparent 70%),
    linear-gradient(rgba(0, 255, 65, 0.04) 1px, transparent 1px) 0 0 / 40px 40px,
    linear-gradient(90deg, rgba(0, 255, 65, 0.04) 1px, transparent 1px) 0 0 / 40px 40px,
    #0e0e10;
}
body::after { content: ""; position: absolute; inset: 0; background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.18) 0 1px, transparent 1px 3px); }
.wrap { position: absolute; inset: 0 84px; display: flex; align-items: center; gap: 60px; }
img { width: 232px; height: 232px; flex-shrink: 0; filter: drop-shadow(0 18px 40px rgba(0, 0, 0, 0.6)); }
h1 { font-family: Orbitron, monospace; font-weight: 800; font-size: 96px; letter-spacing: 0.06em; line-height: 1; color: #00ff41;
  text-shadow: 0 0 22px rgba(0, 255, 65, 0.45); }
h1 span { display: inline-block; width: 0.5em; height: 0.82em; margin-left: 0.14em; background: #00ff41; vertical-align: -0.04em; }
.tag { margin-top: 26px; font-size: 36px; line-height: 1.25; font-weight: 600; max-width: 760px; }
.cmd { margin-top: 26px; font: 600 24px/1 Mono, monospace; color: #3ddc6a; }
.cmd::before { content: "> "; color: #00ff41; }
.sub { margin-top: 18px; font-size: 24px; color: #a3b5a9; }
.by { position: absolute; right: 0; bottom: 40px; font: 500 20px/1 Mono, monospace; color: #7f9186; }
</style></head><body><div class="wrap">
<img src="data:image/png;base64,${icon}" alt="">
<div><h1>NOIRPAD<span></span></h1><p class="tag">${t.tagline}</p><p class="cmd">${t.cmd}</p><p class="sub">${t.sub}</p></div>
<p class="by">${t.by}</p>
</div></body></html>`;

const browser = await chromium.launch({ channel: "chrome" });
try {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const tab = await ctx.newPage();
  for (const [lang, t] of Object.entries(TEXTS)) {
    await tab.setContent(html(t), { waitUntil: "load" });
    await tab.evaluate(() => document.fonts.ready);
    const out = p(`../public/og-${lang}.png`);
    await tab.screenshot({ path: out, type: "png" });
    console.log(`og: public/og-${lang}.png (${Math.round(fs.statSync(out).size / 1024)} kB)`);
  }
} finally {
  await browser.close();
}
