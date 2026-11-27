// SEO checks of the built NoirPad website (dist/, served at https://arcly-studio.github.io/noirpad/):
// every page has title, description, one absolute canonical, reciprocal hreflang (en, cs, x-default → en),
// Open Graph + Twitter card with a 1200×630 image, theme-color, icons and manifest, valid JSON-LD
// (SoftwareApplication on the home pages, WebPage elsewhere, publisher = the Arcly Studio organization,
// no ratings/reviews); the sitemap lists exactly these pages with the same alternates; no robots.txt
// (the studio's robots.txt at the host root governs /noirpad/). Usage: npm run check:seo (after the build)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "node-html-parser";
import sharp from "sharp";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const SITE = (process.env.SITE_URL || "https://arcly-studio.github.io").replace(/\/$/, "");
const BASE = (process.env.BASE_PATH || "/noirpad").replace(/\/$/, "");
const ROOT = `${SITE}${BASE}/`;
// The studio defines its Organization with this @id (arcly-studio/web, src/components/Home.astro).
const ORG_ID = "https://arcly-studio.github.io/#organization";
// Defined on the home pages (src/lib/jsonld.ts), referenced from the other pages.
const APP_ID = `${ROOT}#app`;
const SITE_ID = `${ROOT}#website`;

let errors = 0;
const fail = (where, msg) => { console.error(`check-seo: ${where}: ${msg}`); errors++; };
const ok = (cond, where, msg) => { if (!cond) fail(where, msg); };
/** dist file for an absolute URL under this site (null otherwise). */
const fileFor = (url) => {
  if (typeof url !== "string" || !url.startsWith(ROOT)) return null;
  const rel = decodeURIComponent(url.slice(ROOT.length).split(/[?#]/)[0]);
  return path.join(dist, rel === "" || rel.endsWith("/") ? `${rel}index.html` : rel);
};
const exists = (url) => { const f = fileFor(url); return !!f && fs.existsSync(f); };

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith(".html") ? [p] : [];
});
const pages = new Map();
const meta = (doc, attr, name) => doc.querySelector(`meta[${attr}="${name}"]`)?.getAttribute("content")?.trim() ?? "";
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');

for (const file of walk(dist)) {
  const rel = path.relative(dist, file).replace(/\\/g, "/");
  const url = `${ROOT}${rel.replace(/index\.html$/, "")}`;
  const doc = parse(fs.readFileSync(file, "utf8"));
  const lang = doc.querySelector("html")?.getAttribute("lang");
  const title = decode(doc.querySelector("title")?.text.trim() ?? "");
  const description = decode(meta(doc, "name", "description"));
  const canonical = doc.querySelectorAll('link[rel="canonical"]').map((l) => l.getAttribute("href"));
  const alternates = Object.fromEntries(doc.querySelectorAll('link[rel="alternate"][hreflang]').map((l) => [l.getAttribute("hreflang"), l.getAttribute("href")]));

  ok(lang === "en" || lang === "cs", rel, `<html lang> is "${lang}"`);
  ok(title.length >= 20 && title.length <= 65, rel, `title length ${title.length} (20–65)`);
  ok(description.length >= 70 && description.length <= 160, rel, `description length ${description.length} (70–160)`);
  ok(!/noindex/.test(meta(doc, "name", "robots")), rel, "page is noindex");
  ok(meta(doc, "name", "theme-color") === "#0e0e10", rel, "theme-color must be #0e0e10");
  ok(canonical.length === 1 && canonical[0] === url, rel, `canonical ${canonical.join(", ")} ≠ ${url}`);
  for (const l of ["en", "cs", "x-default"]) ok(alternates[l]?.startsWith(ROOT), rel, `missing/relative hreflang ${l}`);
  ok(alternates["x-default"] === alternates.en, rel, "x-default should point to the English page");
  ok(alternates[lang] === url, rel, "hreflang of the page's own language is not the page itself");

  // Icons and manifest (links resolve to files in dist)
  for (const sel of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]', 'link[rel="manifest"]']) {
    const links = doc.querySelectorAll(sel);
    ok(links.length > 0, rel, `missing ${sel}`);
    for (const l of links) ok(exists(new URL(l.getAttribute("href"), url).href), rel, `${sel} → ${l.getAttribute("href")} not in dist`);
  }

  // Open Graph + Twitter
  const og = (p) => decode(meta(doc, "property", `og:${p}`));
  for (const p of ["type", "site_name", "title", "description", "url", "locale", "locale:alternate", "image", "image:width", "image:height", "image:alt"]) ok(og(p), rel, `missing og:${p}`);
  ok(og("url") === url, rel, "og:url ≠ canonical");
  ok(og("title") === title && og("description") === description, rel, "og:title/description differ from title/description");
  ok(og("locale") === (lang === "cs" ? "cs_CZ" : "en_US") && og("locale:alternate") === (lang === "cs" ? "en_US" : "cs_CZ"), rel, "og:locale / og:locale:alternate do not match the language");
  ok(og("image") === `${ROOT}og-${lang}.png`, rel, `og:image ${og("image")} is not og-${lang}.png`);
  ok(meta(doc, "name", "twitter:card") === "summary_large_image", rel, "twitter:card must be summary_large_image");
  ok(meta(doc, "name", "twitter:image") === og("image"), rel, "twitter:image ≠ og:image");
  if (!exists(og("image"))) fail(rel, `og:image not in dist: ${og("image")}`);
  else {
    const m = await sharp(fileFor(og("image"))).metadata();
    ok(m.width === 1200 && m.height === 630, rel, `og:image is ${m.width}×${m.height}, expected 1200×630`);
    ok(String(m.width) === og("image:width") && String(m.height) === og("image:height"), rel, "og:image:width/height do not match the file");
  }

  // JSON-LD
  const ld = doc.querySelectorAll('script[type="application/ld+json"]');
  ok(ld.length === 1, rel, `expected one JSON-LD block, found ${ld.length}`);
  for (const s of ld) {
    try {
      ok(!/<\/script/i.test(s.text), rel, "JSON-LD contains </script");
      const nodes = JSON.parse(s.text)["@graph"] ?? [];
      const types = nodes.map((n) => n["@type"]);
      const json = JSON.stringify(nodes);
      ok(!/aggregateRating|"review"/i.test(json), rel, "JSON-LD must not contain ratings or reviews");
      const isHome = rel === "index.html" || rel === "cs/index.html";
      if (isHome) {
        const app = nodes.find((n) => n["@type"] === "SoftwareApplication");
        ok(app && types.includes("WebSite"), rel, `JSON-LD types ${types.join(", ")} – expected SoftwareApplication + WebSite`);
        const web = nodes.find((n) => n["@type"] === "WebSite");
        ok(web?.["@id"] === SITE_ID && web?.publisher?.["@id"] === ORG_ID, rel, `WebSite @id must be ${SITE_ID}, publisher the organization`);
        if (app) {
          ok(app["@id"] === APP_ID, rel, `SoftwareApplication @id must be ${APP_ID}`);
          ok(app.url === url, rel, "SoftwareApplication.url must be this page (its language)");
          ok(app.name === "NoirPad", rel, "SoftwareApplication.name");
          ok(/Windows 10/.test(app.operatingSystem) && /Windows 11/.test(app.operatingSystem), rel, "operatingSystem must name Windows 10 and 11");
          ok(typeof app.applicationCategory === "string" && app.applicationCategory.endsWith("Application"), rel, "applicationCategory");
          ok(app.offers?.price === "0" && app.offers?.priceCurrency, rel, "offers must be price 0 with a currency");
          ok(/LICENSE|MIT/i.test(app.license ?? ""), rel, "license (MIT) missing");
          for (const k of ["author", "publisher"]) ok(app[k]?.["@id"] === ORG_ID && app[k]?.name === "Arcly Studio" && app[k]?.url === "https://arcly-studio.github.io/", rel, `${k} must be the Arcly Studio organization`);
          ok(typeof app.downloadUrl === "string" && app.downloadUrl.startsWith("https://"), rel, "downloadUrl");
          ok(app.image === og("image"), rel, "SoftwareApplication.image ≠ og:image");
        }
      } else {
        const page = nodes.find((n) => n["@type"] === "WebPage");
        ok(page && page.url === url && page.publisher?.["@id"] === ORG_ID, rel, "expected a WebPage with url = canonical and publisher = Arcly Studio");
        ok(page?.isPartOf?.["@id"] === SITE_ID && page?.about?.["@id"] === APP_ID, rel, `WebPage isPartOf/about must point to ${SITE_ID} / ${APP_ID}`);
      }
    } catch (e) {
      fail(rel, `JSON-LD does not parse: ${e.message}`);
    }
  }
  pages.set(url, { rel, alternates });
}

// hreflang reciprocity
for (const { rel, alternates } of pages.values()) {
  for (const [l, href] of Object.entries(alternates)) {
    const target = pages.get(href);
    if (!target) fail(rel, `hreflang ${l} → ${href} is not a page of this build`);
    else ok(JSON.stringify(target.alternates) === JSON.stringify(alternates), rel, `hreflang set differs on ${target.rel}`);
  }
}

// Sitemap: exactly the pages, with the same en/cs alternates
const locs = (s) => [...s.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const sitemapUrls = [];
const indexFile = path.join(dist, "sitemap-index.xml");
if (!fs.existsSync(indexFile)) fail("sitemap-index.xml", "missing");
else for (const sm of locs(fs.readFileSync(indexFile, "utf8"))) {
  if (!exists(sm)) { fail("sitemap-index.xml", `${sm} missing`); continue; }
  for (const block of fs.readFileSync(fileFor(sm), "utf8").split("<url>").slice(1)) {
    const loc = locs(block)[0];
    sitemapUrls.push(loc);
    const alt = Object.fromEntries([...block.matchAll(/hreflang="([^"]+)" href="([^"]+)"/g)].map((m) => [m[1], m[2]]));
    const own = pages.get(loc)?.alternates ?? {};
    ok(alt.en && alt.cs && alt.en === own.en && alt.cs === own.cs, "sitemap", `${loc}: en/cs alternates do not match the page`);
  }
}
ok(sitemapUrls.length === pages.size && sitemapUrls.every((u) => pages.has(u)), "sitemap", `URLs ${sitemapUrls.join(", ")} ≠ pages ${[...pages.keys()].join(", ")}`);
ok(!fs.existsSync(path.join(dist, "robots.txt")), "robots.txt", "must not exist – the studio's robots.txt at the host root applies");

// Manifest and icon sizes
try {
  const man = JSON.parse(fs.readFileSync(path.join(dist, "site.webmanifest"), "utf8"));
  ok(man.name === "NoirPad" && man.start_url === `${BASE}/` && man.icons?.some((i) => i.purpose === "maskable"), "site.webmanifest", "needs name, start_url under the base and a maskable icon");
  for (const i of man.icons ?? []) {
    const f = fileFor(`${SITE}${i.src}`);
    if (!f || !fs.existsSync(f)) { fail("site.webmanifest", `icon ${i.src} missing`); continue; }
    const m = await sharp(f).metadata();
    ok(`${m.width}x${m.height}` === i.sizes, "site.webmanifest", `${i.src} is ${m.width}x${m.height}, manifest says ${i.sizes}`);
  }
} catch (e) {
  fail("site.webmanifest", e.message);
}
const apple = await sharp(path.join(dist, "apple-touch-icon.png")).metadata();
ok(apple.width === 180 && apple.height === 180 && !apple.hasAlpha, "apple-touch-icon.png", "must be 180×180 without transparency");
const ico = fs.readFileSync(path.join(dist, "favicon.ico"));
ok(ico.readUInt16LE(2) === 1 && ico.readUInt16LE(4) === 1 && ico[6] === 32 && ico.readUInt32LE(14) + 22 === ico.length, "favicon.ico", "not a single complete 32×32 icon");
ok(!/<metadata|c2pa/i.test(fs.readFileSync(path.join(dist, "favicon.svg"), "utf8")), "favicon.svg", "still contains metadata");

if (errors) process.exit(1);
console.log(`check-seo: OK – ${pages.size} pages, sitemap (${sitemapUrls.length} URLs), OG images, JSON-LD, icons, manifest, no robots.txt`);
