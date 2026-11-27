// Turns docs/demo.gif into the demo video for the website (run by hand after the GIF changes; needs ffmpeg).
// Output is committed: public/media/noirpad-demo.webm (VP9) + .mp4 (H.264, fallback) and the poster frame
// src/assets/demo-poster.png (optimised to AVIF/WebP by astro:assets at build time). No audio track.
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const p = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const gif = p("../../docs/demo.gif");
const run = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", "-i", gif, ...args], { stdio: "inherit" });

run(["-an", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-deadline", "good", "-pix_fmt", "yuv420p", p("../public/media/noirpad-demo.webm")]);
run(["-an", "-c:v", "libx264", "-crf", "22", "-preset", "veryslow", "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart", p("../public/media/noirpad-demo.mp4")]);
// Poster: the frame at 9 s (Markdown source and live preview side by side).
execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", "9", "-i", gif, "-frames:v", "1", p("../src/assets/demo-poster.png")], { stdio: "inherit" });
console.log("make-media: public/media/noirpad-demo.webm, noirpad-demo.mp4, src/assets/demo-poster.png");
