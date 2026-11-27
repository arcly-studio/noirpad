// After the build: title/description lengths, and the HTML must not contain names of third-party products (Microsoft Store policy 10.1,
// same rule as the Dirwise site) – file managers / OS features, other notes apps and third-party names behind theme names. URLs are not checked.
// "Windows", "Microsoft Store" and "WebView2" are allowed (platform and requirement).
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const FORBIDDEN =
  /finder|macos|\bmac\b|quick\s*look|explorer|průzkumník|obsidian|notion|evernote|onenote|joplin|typora|simplenote|logseq|bear\s*notes|standard\s*notes|tokyo\s*night|(?<!\btype=")\bmatrix\b/gi;
// "matrix" as a word (theme/effect name from a film); only the SVG filter attribute type="matrix" is skipped.

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".html")) files.push(p);
  }
};
walk(dist);
if (files.length === 0) throw new Error("check-words: no HTML in dist/");

let errors = 0;
for (const file of files) {
  const rel = path.relative(dist, file).replace(/\\/g, "/");
  const html = fs.readFileSync(file, "utf8").replace(/https?:\/\/[^\s"'<>)]+/g, "");
  for (const m of html.matchAll(FORBIDDEN)) {
    const ctx = html.slice(Math.max(0, m.index - 40), m.index + 40).replace(/\s+/g, " ");
    console.error(`${rel}: forbidden word "${m[0]}" … ${ctx}`);
    errors++;
  }
}
// Search snippets: title ≤ 65 and description 70–160 characters on every page.
for (const file of files) {
  const rel = path.relative(dist, file).replace(/\\/g, "/");
  const html = fs.readFileSync(file, "utf8");
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
  const desc = html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? "";
  const len = (s) => s.replace(/&amp;/g, "&").replace(/&#39;|&quot;/g, "'").length;
  if (!title || len(title) > 65) { console.error(`${rel}: title length ${len(title)} (max 65)`); errors++; }
  if (len(desc) < 70 || len(desc) > 160) { console.error(`${rel}: description length ${len(desc)} (70–160)`); errors++; }
}
if (errors > 0) process.exit(1);
console.log(`check-words: ${files.length} HTML files without forbidden words, title and description lengths OK`);
