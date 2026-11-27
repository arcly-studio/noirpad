// No horizontal scrolling on phones: every built page (dist/, served under the base /noirpad/) is opened at
// 320 and 390 px in mobile emulation and the document must not be wider than the window. Uses the installed Chrome
// (playwright-core, channel "chrome"). Usage: npm run check:overflow (after the build)
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { chromium } from "playwright-core";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const BASE = (process.env.BASE_PATH || "/noirpad").replace(/\/$/, "") + "/";
const WIDTHS = [320, 390];
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2", ".ico": "image/x-icon", ".mp4": "video/mp4",
  ".webm": "video/webm", ".json": "application/json", ".webmanifest": "application/manifest+json", ".xml": "application/xml" };

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : e.name.endsWith(".html") ? [p] : [];
});
const urls = walk(dist).map((f) => BASE + path.relative(dist, f).replace(/\\/g, "/").replace(/(^|\/)index\.html$/, "$1"));

// Minimal static server for dist/ under the base path (no directory listing, no traversal).
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (!u.startsWith(BASE) || u.includes("..")) { res.writeHead(404); return res.end(); }
  let file = path.join(dist, u.slice(BASE.length));
  if (u.endsWith("/")) file = path.join(file, "index.html");
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: "chrome" });
let errors = 0;
try {
  for (const url of urls.sort()) for (const WIDTH of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: WIDTH, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    await page.goto(origin + url, { waitUntil: "load" });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    if (width > WIDTH) { console.error(`check-overflow: ${url} is ${width} px wide at ${WIDTH} px`); errors++; }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (errors) process.exit(1);
console.log(`check-overflow: ${urls.length} pages at ${WIDTHS.join(" and ")} px without horizontal scrolling`);
