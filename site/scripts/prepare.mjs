// Runs before dev/build. Output is generated – git-ignored (site/.gitignore).
//  1. Small Czech subsets of the latin-ext fonts (č, ř, ž …), so a Czech page does not wait for the whole
//     latin-ext files (Inter 85 kB).
//  2. Favicons from the app icon in docs/brand (originals stay untouched – tests/test_brand.py checks them):
//     favicon.svg = the small icon without its metadata block (C2PA, ~8 kB), favicon.ico = one 32 px PNG
//     (PNG-in-ICO, valid in all current browsers – same as the studio website), apple-touch-icon and the
//     manifest icons rendered from noirpad-1024.png by sharp.
import fs from "fs";
import sharp from "sharp";
import subsetFont from "subset-font";
import { fileURLToPath } from "url";

const CS_CHARS = "ČčĎďĚěŇňŘřŠšŤťŮůŽž";
const nm = (p) => fileURLToPath(new URL(`../node_modules/@fontsource-variable/${p}`, import.meta.url));
const pub = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));
const brand = (p) => fileURLToPath(new URL(`../../docs/brand/${p}`, import.meta.url));
fs.mkdirSync(pub("fonts"), { recursive: true });
for (const [name, src] of [
  ["inter-cs.woff2", "inter/files/inter-latin-ext-wght-normal.woff2"],
  ["mono-cs.woff2", "jetbrains-mono/files/jetbrains-mono-latin-ext-wght-normal.woff2"],
]) {
  fs.writeFileSync(pub(`fonts/${name}`), await subsetFont(fs.readFileSync(nm(src)), CS_CHARS, { targetFormat: "woff2" }));
}

// favicon.svg: drop <metadata>…</metadata> and the namespace it needs; refuse anything unexpected.
const svg = fs
  .readFileSync(brand("noirpad-icon-small.svg"), "utf8")
  .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
  .replace(/\s+xmlns:c2pa="[^"]*"/g, "");
if (/<metadata|c2pa|<script|<foreignObject/i.test(svg)) throw new Error("prepare: unexpected content in noirpad-icon-small.svg");
fs.writeFileSync(pub("favicon.svg"), svg);

const icon = brand("noirpad-1024.png");
const BG = "#0e0e10"; // page background (theme-color)
const ico32 = await sharp(icon).resize(32, 32).png().toBuffer();
const head = Buffer.alloc(22);
head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // reserved, type icon, 1 image
head.writeUInt8(32, 6); head.writeUInt8(32, 7); head.writeUInt8(0, 8); head.writeUInt8(0, 9);
head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12); head.writeUInt32LE(ico32.length, 14); head.writeUInt32LE(22, 18);
fs.writeFileSync(pub("favicon.ico"), Buffer.concat([head, ico32]));
// Apple touch icon must not be transparent.
await sharp(icon).resize(180, 180).flatten({ background: BG }).png().toFile(pub("apple-touch-icon.png"));
await sharp(icon).resize(192, 192).png().toFile(pub("icon-192.png"));
await sharp(icon).resize(512, 512).png().toFile(pub("icon-512.png"));
// Maskable: full-bleed background, the icon at 70 % (inside the 80 % safe zone).
await sharp({ create: { width: 512, height: 512, channels: 4, background: BG } })
  .composite([{ input: await sharp(icon).resize(360, 360).png().toBuffer(), gravity: "center" }])
  .png()
  .toFile(pub("icon-maskable-512.png"));

console.log("prepare: fonts/inter-cs.woff2, fonts/mono-cs.woff2, favicon.svg/.ico, apple-touch-icon.png, icon-192/512.png, icon-maskable-512.png");
