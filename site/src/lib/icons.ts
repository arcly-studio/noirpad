// Lucide icons as inline SVG – rendered at build time, no JS (same approach as the Dirwise site).
import * as lucide from "lucide";

type IconNode = [tag: string, attrs: Record<string, string | number>][];

export function icon(name: keyof typeof lucide, size = 16): string {
  const node = lucide[name] as unknown as IconNode;
  if (!Array.isArray(node)) throw new Error(`lucide: icon ${String(name)} does not exist`);
  const children = node
    .map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${children}</svg>`;
}

/** "Ctrl+Shift+N / F2" → key caps; " / " separates alternatives. Input is our own static text. */
export function keycaps(keys: string): string {
  return keys
    .split(" / ")
    .map((combo) => combo.split("+").map((k) => `<kbd>${k}</kbd>`).join('<span class="plus">+</span>'))
    .join('<span class="alt">/</span>');
}
